import './ui/styles.css';
import { loadConfig, saveConfig, type Config } from './config/config';
import { GesturePipeline, type PipelineConfig } from './gestures/pipeline';
import { HandTracker } from './tracking/handTracker';
import { MidiIO, midiSupported, requestMidi, type MidiAccessLike } from './midi/io';
import { DEFAULT_MAPPING, type MidiMapping } from './midi/mapping';
import { DeckStore } from './state/deckStore';
import { ACTIONS, DECKS, type Action, type Deck, type HandFrame } from './types';
import { renderConsole } from './ui/console';
import { actionLabel, firedLabel } from './ui/labels';
import { calibrate, choosePort, Sheet } from './ui/onboarding';
import { drawOverlay, type OverlayOptions } from './ui/overlay';
import { SettingsDrawer } from './ui/settings';
import { renderStatus, showBanner } from './ui/status';
import { Recorder } from './record';

const CONFIRM_MS = 300;
const DEAD_BAND = 0.04;
const FIRED_MS = 250;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function pipelineConfig(c: Config): PipelineConfig {
  return {
    clutchOn: c.clutchOn,
    clutchOff: c.clutchOff,
    holdMs: c.holdMs,
    firedMs: FIRED_MS,
    speedGate: c.speedGate,
    poseMap: c.poseMap,
    deadBand: DEAD_BAND,
  };
}

function mappingFor(c: Config): MidiMapping {
  return { ...DEFAULT_MAPPING, invert: { ...c.invert } };
}

/** Shows a blocking message with a retry button and resolves once `attempt` succeeds. */
async function untilOk<T>(sheet: Sheet, attempt: () => Promise<T>, explain: (err: unknown) => { title: string; body: string }): Promise<T> {
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      const { title, body } = explain(err);
      await new Promise<void>((resolve) => sheet.show({ title, body, actions: [{ label: 'Try again', primary: true, onClick: () => resolve() }] }));
    }
  }
}

function cameraError(err: unknown): { title: string; body: string } {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError')
    return {
      title: 'Camera access is blocked',
      body: '<p>Allow the camera for this site (the camera icon in the address bar), then try again.</p>',
    };
  if (name === 'NotFoundError') return { title: 'No camera found', body: '<p>Connect a webcam, then try again.</p>' };
  if (name === 'NotReadableError')
    return { title: 'The camera is busy', body: '<p>Another app is using the camera. Close it (Zoom, OBS, FaceTime), then try again.</p>' };
  return { title: 'The camera could not start', body: `<p>${String((err as Error)?.message ?? err)}</p>` };
}

async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

async function boot(): Promise<void> {
  const video = el<HTMLVideoElement>('video');
  const canvas = el<HTMLCanvasElement>('stage');
  const consoleEl = el('console');
  const statusEl = el('status');
  const bannerEl = el('banner');
  const sheet = new Sheet(el('sheet'));

  if (!midiSupported()) {
    sheet.show({
      title: 'Trackstar needs Chrome or Edge',
      body: '<p>It talks to rekordbox over Web MIDI, which Safari and Firefox do not support. Open this page in Chrome or Edge.</p>',
    });
    return;
  }

  let cfg = loadConfig();
  const store = new DeckStore({ now: () => performance.now(), confirmMs: CONFIRM_MS });
  const pipeline = new GesturePipeline(pipelineConfig(cfg));
  const syncBlind = () => ACTIONS.forEach((a) => store.setBlind(a, !cfg.feedbackEnabled || !!cfg.blind[a]));
  syncBlind();

  renderConsole(consoleEl, store.snapshot());
  store.subscribe(() => renderConsole(consoleEl, store.snapshot()));

  sheet.show({ step: 'STARTING', title: 'Starting the camera', body: '<p>Your browser may ask for camera access.</p>' });
  const stream = await untilOk(sheet, () => startCamera(video), cameraError);
  stream.getVideoTracks()[0]?.addEventListener('ended', () =>
    showBanner(bannerEl, 'The camera disconnected. Reconnect it and reload the page.'),
  );

  sheet.show({ step: 'STARTING', title: 'Loading hand tracking', body: '<p>This takes a few seconds the first time.</p>' });
  const tracker = await untilOk(
    sheet,
    () => HandTracker.create(import.meta.env.BASE_URL),
    (err) => ({
      title: 'Hand tracking could not start',
      body: `<p>${String((err as Error)?.message ?? err)}</p><p>Reload the page. If it keeps happening, update Chrome or Edge.</p>`,
    }),
  );

  sheet.show({ step: 'STARTING', title: 'Connecting to MIDI', body: '<p>Your browser may ask to allow MIDI devices.</p>' });
  const access = await untilOk<MidiAccessLike>(
    sheet,
    async () => {
      const a = await requestMidi();
      if (!a) throw new Error('denied');
      return a;
    },
    () => ({
      title: 'MIDI access is blocked',
      body: '<p>Allow MIDI devices for this site (the icon in the address bar), then try again.</p>',
    }),
  );

  const midi = new MidiIO(access, mappingFor(cfg));
  midi.setFeedbackEnabled(cfg.feedbackEnabled);
  midi.select(cfg.outPort, cfg.inPort);
  midi.onFeedback((fb) => store.feedback(fb.deck, fb.action, fb.on));

  const update = (next: Config) => {
    const portsChanged = next.outPort !== cfg.outPort || next.inPort !== cfg.inPort || next.feedbackEnabled !== cfg.feedbackEnabled;
    cfg = next;
    saveConfig(cfg);
    pipeline.setConfig(pipelineConfig(cfg));
    midi.setMapping(mappingFor(cfg));
    if (portsChanged) {
      midi.setFeedbackEnabled(cfg.feedbackEnabled);
      midi.select(cfg.outPort, cfg.inPort);
    }
    syncBlind();
  };

  // Gestures are tracked during setup (calibration needs them) but never sent.
  let setupActive = true;
  let latestClutchRatio: number | null = null;

  const runCalibration = async () => {
    setupActive = true;
    const result = await calibrate(sheet, () => latestClutchRatio);
    if (result) update({ ...cfg, clutchOn: result.on, clutchOff: result.off, calibrated: true });
    sheet.hide();
    setupActive = false;
  };

  const settings = new SettingsDrawer({
    root: el('settings'),
    getConfig: () => cfg,
    setConfig: update,
    outputs: () => midi.outputs(),
    inputs: () => midi.inputs(),
    recalibrate: () => void runCalibration(),
  });
  el('settings-btn').addEventListener('click', () => settings.toggle());
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (e.key === 'Escape' && settings.open) settings.toggle(false);
    else if (!typing && !e.metaKey && !e.ctrlKey && (e.key === 's' || e.key === 'S') && !sheet.visible) settings.toggle();
  });

  midi.onStatus((s) => {
    if (cfg.outPort && !s.outConnected) showBanner(bannerEl, `MIDI port "${cfg.outPort}" is disconnected. Trackstar reconnects when it comes back.`);
    else showBanner(bannerEl, null);
    settings.refresh();
  });

  const recorder = new URLSearchParams(location.search).has('record') ? new Recorder(el('recorder')) : null;

  // Frame loop.
  const lastFire: Record<Deck, { action: Action | null; sent: boolean }> = {
    A: { action: null, sent: true },
    B: { action: null, sent: true },
  };
  let frames = 0;
  let fps = 0;
  let fpsSince = performance.now();

  const labelsFor = (decks: ReturnType<GesturePipeline['update']>['decks']): OverlayOptions['labels'] => {
    const out = { A: null, B: null } as OverlayOptions['labels'];
    for (const deck of DECKS) {
      const ring = decks[deck].ring;
      if (ring.phase === 'armed') out[deck] = { text: 'ARMED', warn: false };
      else if (ring.phase === 'rearm') out[deck] = { text: 'CLOSE HAND', warn: false };
      else if (ring.phase === 'forming' && ring.action) out[deck] = { text: actionLabel(ring.action), warn: false };
      else if (ring.phase === 'fired') {
        const f = lastFire[deck];
        if (setupActive || !f.action) out[deck] = { text: 'SETUP', warn: true };
        else {
          const text = firedLabel(f.action, store.get(deck, f.action), f.sent);
          out[deck] = { text, warn: text === 'NO MIDI' || text === 'NO REPLY' };
        }
      }
    }
    return out;
  };

  const frame = () => {
    const t = performance.now();
    let hands: HandFrame[] = [];
    if (video.readyState >= 2) {
      try {
        hands = tracker.detect(video, t);
      } catch {
        hands = [];
      }
    }
    recorder?.push(t, hands);

    const out = pipeline.update(hands, t);
    latestClutchRatio = out.decks.A.features?.clutchRatio ?? out.decks.B.features?.clutchRatio ?? null;

    if (!setupActive) {
      for (const a of out.actions) {
        const sent = midi.send(a.deck, a.action);
        if (sent) store.sent(a.deck, a.action);
        lastFire[a.deck] = { action: a.action, sent };
      }
    }
    store.tick();

    drawOverlay(canvas, video, out.decks, { dim: cfg.cameraDim, showSkeleton: cfg.showSkeleton, labels: labelsFor(out.decks) });

    frames++;
    if (t - fpsSince >= 500) {
      fps = (frames * 1000) / (t - fpsSince);
      frames = 0;
      fpsSince = t;
      renderStatus(statusEl, { midi: midi.status(), feedbackEnabled: cfg.feedbackEnabled, fps });
    }
    schedule();
  };

  const schedule = () => {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => frame());
    else requestAnimationFrame(frame);
  };
  schedule();
  renderStatus(statusEl, { midi: midi.status(), feedbackEnabled: cfg.feedbackEnabled, fps: 0 });

  // First-run steps, skipped once done.
  if (!cfg.outPort || !midi.outputs().includes(cfg.outPort)) {
    const port = await choosePort(sheet, midi, cfg.outPort);
    update({ ...cfg, outPort: port });
  }
  if (!cfg.calibrated) {
    await runCalibration();
  } else {
    sheet.hide();
    setupActive = false;
  }
}

void boot();
