// Smoke test: serves the production build and loads it in Chromium with a fake
// camera and a fake virtual MIDI port (headless Chromium refuses real Web MIDI).
// Walks the first-run flow, then checks rekordbox-style feedback reaches the
// console, all without page errors.
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

    // rekordbox feedback: deck A loop 2 on (channel 3), deck B drums muted (channel 4).
    // An echo of the app's own command on channel 1 must be ignored.
    await page.evaluate(() => {
      window.__midi.emit([0x90, 65, 127]);
      window.__midi.emit([0x92, 63, 127]);
      window.__midi.emit([0x93, 70, 127]);
      window.__midi.emit([0x93, 71, 0]);
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
