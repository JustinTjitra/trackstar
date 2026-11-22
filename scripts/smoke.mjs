// Smoke test: serves the production build and loads it in Chromium with a fake
// camera and a fake virtual MIDI port (headless Chromium refuses real Web MIDI).
// Walks the first-run flow, then checks rekordbox-style feedback reaches the
// console, all without page errors. A second page load (?fxtest) runs the effects
// self-test: an offline render through the AudioWorklet node, checked for bit-exact
// bypass, an audible effect, state messages and no processor errors; that page stays
// open as a second copy of the app. Last, the deck screen page (display.html) is opened
// in the same browser: it must go live and show the first page's chips while ignoring
// the second copy, say that two copies are open, follow new feedback, take over the
// second copy when the first page closes, and go stale once that one closes too.
//
//   npm run build && npm run smoke            (add --shot=path.png for a screenshot)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const file = path || 'index.html';
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/${process.argv.includes('--record') ? '?record' : ''}`;

const shot = process.argv.find((a) => a.startsWith('--shot='))?.slice(7);
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(['camera', 'midi'], { origin: url });
  await context.addInitScript(() => {
    const sent = [];
    const out = { name: 'IAC Driver Touchless', state: 'connected', send: (d, ts) => sent.push([Array.from(d), ts]) };
    const inp = { name: 'IAC Driver Touchless', state: 'connected', onmidimessage: null };
    const access = { outputs: new Map([['o', out]]), inputs: new Map([['i', inp]]), onstatechange: null, sysexEnabled: false };
    Object.defineProperty(window, '__midi', { value: { sent, emit: (b) => inp.onmidimessage?.({ data: new Uint8Array(b) }) } });
    navigator.requestMIDIAccess = async () => access;
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(url);

  const heading = () => page.locator('#sheet h2').textContent({ timeout: 1000 }).catch(() => null);
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name} failed (screen: "${await heading()}"): ${e.message.split('\n')[0]}`);
      throw e;
    }
  };

  try {
    // Camera, hand tracking and MIDI all have to start before the port picker appears.
    await step('boot to port picker', () =>
      page.getByRole('heading', { name: 'Which port should Trackstar use?' }).waitFor({ timeout: 45_000 }),
    );
    await step('pick port', () => page.getByRole('button', { name: 'Use this port' }).click());
    await step('calibration intro', () => page.getByRole('heading', { name: 'Calibrate the thumb clutch' }).waitFor());
    await step('skip calibration', () => page.getByRole('button', { name: 'Skip for now' }).click());
    await step('main view', () => page.locator('#sheet').waitFor({ state: 'hidden' }));

    const chips = await page.locator('.chip').count();
    if (chips !== 12) errors.push(`expected 12 console chips, found ${chips}`);
    const unknown = await page.locator('.chip.unknown').count();
    if (unknown !== 12) errors.push(`expected all chips unknown before feedback, found ${unknown}`);

    // rekordbox feedback: deck A loop 2 on (channel 3); deck B drums light off = muted,
    // vocals light on = playing (ActiveStem lights while a stem plays). An echo of the
    // app's own command on channel 1 must be ignored.
    await page.evaluate(() => {
      window.__midi.emit([0x90, 65, 127]);
      window.__midi.emit([0x92, 63, 127]);
      window.__midi.emit([0x93, 70, 0]);
      window.__midi.emit([0x93, 71, 127]);
    });
    const cls = (deck, action) => page.locator(`.chip[data-deck="${deck}"][data-action="${action}"]`).getAttribute('class');
    const checks = [
      ['A', 'loop2', 'chip on'],
      ['A', 'loop4', 'chip unknown'],
      ['B', 'drums', 'chip muted'],
      ['B', 'vocals', 'chip on'],
    ];
    for (const [deck, action, want] of checks) {
      const got = await cls(deck, action);
      if (got !== want) errors.push(`deck ${deck} ${action}: expected "${want}", got "${got}"`);
    }

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trackstar.config.v1') ?? '{}').outPort);
    if (saved !== 'IAC Driver Touchless') errors.push(`port choice not saved (got ${saved})`);

    await step('settings drawer', async () => {
      await page.keyboard.press('s');
      await page.getByRole('heading', { name: 'Settings' }).waitFor();
      if (shot) await page.screenshot({ path: shot.replace(/\.png$/, '-settings.png') });
      await page.keyboard.press('Escape');
      await page.locator('#settings').waitFor({ state: 'hidden' });
    });
    await page.waitForTimeout(600); // let the status pill refresh
  } catch {
    // Recorded by step().
  }
  if (shot) await page.screenshot({ path: shot });
  console.log(`last screen: ${(await heading()) ?? 'main view'}`);

  // Effects self-test: its own page, so it does not depend on the first-run flow above.
  let fxPage;
  try {
    const fxUrl = `http://127.0.0.1:${server.address().port}/?fxtest`;
    fxPage = await context.newPage();
    fxPage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    fxPage.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await fxPage.goto(fxUrl);
    await fxPage.waitForFunction(() => typeof window.__trackstarFxSelfTest === 'function', null, { timeout: 15_000 });
    const fx = await fxPage.evaluate(() => window.__trackstarFxSelfTest());
    if (!(fx.bypassMaxDiff < 1e-6)) errors.push(`fx bypass not bit-exact: max diff ${fx.bypassMaxDiff}`);
    if (!(fx.effectRmsDiff > 0.01)) errors.push(`fx effect not audible: rms diff ${fx.effectRmsDiff}`);
    if (fx.errors !== 0) errors.push(`fx processor reported ${fx.errors} errors`);
    if (!(fx.stateMessages >= 5)) errors.push(`fx too few state messages: ${fx.stateMessages}`);
    console.log(`fx self-test: bypass ${fx.bypassMaxDiff}, effect ${fx.effectRmsDiff.toFixed(4)}, ${fx.stateMessages} state messages`);
  } catch (e) {
    errors.push(`fx self-test failed: ${String(e.message ?? e).split('\n')[0]}`);
  }

  // Deck screen, while the second copy of the app (fxPage) is still open: it must ignore that copy (the main page is
  // older, so it wins) and say that two copies are open. Then it follows feedback, takes over the remaining copy when
  // the main page closes, and goes stale when that one closes too.
  try {
    const dsUrl = `http://127.0.0.1:${server.address().port}/display.html`;
    const ds = await context.newPage();
    await ds.setViewportSize({ width: 1920, height: 480 });
    ds.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    ds.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await ds.goto(dsUrl);
    await ds.locator('#display.d-live').waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('deck screen did not go live within 5 s');
    });
    const rootCls = await ds.locator('#display').getAttribute('class');
    if (!rootCls.split(' ').includes('d-wide')) errors.push(`deck screen layout: expected d-wide, got "${rootCls}"`);
    const dsChips = async () => ds.locator('#display .chip').count();
    const n = await dsChips();
    if (n !== 12) errors.push(`deck screen: expected 12 chips, found ${n}`);
    // The second copy's first message may arrive before the main page's: wait until the main page's state is shown.
    await ds
      .waitForFunction(
        () => document.querySelector('#display .chip[data-deck="A"][data-action="loop2"]')?.classList.contains('on'),
        null,
        { timeout: 5000 },
      )
      .catch(() => errors.push('deck screen did not show the main page feedback while a second copy is open'));
    const dsCls = (deck, action) => ds.locator(`#display .chip[data-deck="${deck}"][data-action="${action}"]`).getAttribute('class');
    const dsChecks = [
      ['A', 'loop2', 'chip on'],
      ['A', 'loop4', 'chip unknown'],
      ['B', 'drums', 'chip muted'],
      ['B', 'vocals', 'chip on'],
    ];
    for (const [deck, action, want] of dsChecks) {
      const got = await dsCls(deck, action);
      if (got !== want) errors.push(`deck screen ${deck} ${action}: expected "${want}", got "${got}"`);
    }

    // The notice: two copies are sending.
    await ds
      .waitForFunction(() => document.querySelector('#display .d-notice')?.textContent?.includes('two tabs'), null, { timeout: 5000 })
      .catch(() => {
        throw new Error('deck screen did not report two open copies');
      });

    // No flicker: both copies publish about once a second, so watch the main page's chip for 2.5 s (a window that
    // proves an absence cannot be a wait for a condition). Any sample that is not "on" means the other copy leaked in.
    const flicker = await ds.evaluate(
      () =>
        new Promise((resolve) => {
          let bad = 0;
          const t0 = Date.now();
          const id = setInterval(() => {
            const el = document.querySelector('#display .chip[data-deck="A"][data-action="loop2"]');
            if (el?.className !== 'chip on') bad += 1;
            if (Date.now() - t0 >= 2500) {
              clearInterval(id);
              resolve(bad);
            }
          }, 20);
        }),
    );
    if (flicker > 0) errors.push(`deck screen flickered: the second copy was shown in ${flicker} samples`);

    // Live update: new feedback on the app page shows up on the deck screen.
    await page.evaluate(() => window.__midi.emit([0x92, 65, 127]));
    await ds
      .waitForFunction(
        () => document.querySelector('#display .chip[data-deck="A"][data-action="loop4"]')?.classList.contains('on'),
        null,
        { timeout: 3000 },
      )
      .catch(() => errors.push('deck screen did not follow new feedback'));

    // Take-over: the main page goes away, so the deck screen follows the second copy (all controls unknown).
    await page.close();
    await ds
      .waitForFunction(
        () => document.querySelector('#display .chip[data-deck="A"][data-action="loop2"]')?.className === 'chip unknown',
        null,
        { timeout: 8000 },
      )
      .catch(() => {
        throw new Error('deck screen did not take over the remaining copy');
      });
    await ds
      .waitForFunction(() => !document.querySelector('#display .d-notice'), null, { timeout: 5000 })
      .catch(() => {
        throw new Error('deck screen still reports two copies');
      });
    const liveCls = await ds.locator('#display').getAttribute('class');
    if (!liveCls.split(' ').includes('d-live')) errors.push(`deck screen after take-over: expected d-live, got "${liveCls}"`);

    // Going stale: the last copy goes away, so nothing is sent any more.
    await fxPage?.close().catch(() => {});
    const wentStale = await ds
      .locator('#display.d-stale')
      .waitFor({ timeout: 8000 })
      .then(() => true, () => false);
    if (!wentStale) {
      errors.push('deck screen did not go stale after the app closed');
    } else {
      const n2 = await dsChips();
      if (n2 !== 12) errors.push(`deck screen: expected 12 chips when stale, found ${n2}`);
      const msg = (await ds.locator('#display .d-message').textContent({ timeout: 1000 }).catch(() => null)) ?? '';
      if (!msg.includes('stopped sending')) errors.push(`deck screen stale message: got "${msg}"`);
    }
    console.log('deck screen: live at 1920x480, 12 chips, ignores a second copy and says so, follows feedback, takes over, goes stale');
  } catch (e) {
    errors.push(`deck screen failed: ${String(e.message ?? e).split('\n')[0]}`);
  }
  await fxPage?.close().catch(() => {});
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('SMOKE FAILED');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('smoke ok');
