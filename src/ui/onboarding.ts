import { computeClutchThresholds } from '../config/calibration';
import type { MidiIO } from '../midi/io';

export interface SheetAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface SheetContent {
  step?: string;
  title: string;
  /** Trusted HTML written by this app only. */
  body: string;
  error?: string;
  actions?: SheetAction[];
  docked?: boolean;
  /** Show a progress meter (0..1); update with setMeter. */
  meter?: boolean;
}

/** The centred panel used for first-run steps and blocking errors. */
export class Sheet {
  constructor(private readonly root: HTMLElement) {}

  show(c: SheetContent): void {
    this.root.className = `sheet${c.docked ? ' docked' : ''}`;
    this.root.innerHTML = `
      ${c.step ? `<div class="step">${c.step}</div>` : ''}
      <h2>${c.title}</h2>
      ${c.body}
      ${c.meter ? '<div class="meter"><i></i></div>' : ''}
      ${c.error ? `<p class="error">${c.error}</p>` : ''}
      <div class="actions"></div>`;
    const actions = this.root.querySelector('.actions')!;
    (c.actions ?? []).forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${a.primary ? ' primary' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      actions.appendChild(b);
      if (i === 0) queueMicrotask(() => b.focus());
    });
    this.root.hidden = false;
  }

  setMeter(k: number): void {
    const bar = this.root.querySelector<HTMLElement>('.meter > i');
    if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, k)) * 100)}%`;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Lets the user pick the virtual MIDI port. Resolves with its name. */
export function choosePort(sheet: Sheet, midi: MidiIO, current: string | null): Promise<string> {
  return new Promise((resolve) => {
    const render = () => {
      const outs = midi.outputs();
      if (outs.length === 0) {
        sheet.show({
          step: 'SETUP · MIDI PORT',
          title: 'No MIDI ports found',
          body: `<p>Create a virtual MIDI port, then refresh.</p>
            <p><b>macOS:</b> open Audio MIDI Setup, Window, Show MIDI Studio, double-click IAC Driver and tick <i>Device is online</i>.<br>
            <b>Windows:</b> install loopMIDI and add a port.</p>`,
          actions: [{ label: 'Refresh', primary: true, onClick: render }],
        });
        return;
      }
      const preferred = current && outs.includes(current) ? current : outs.find((n) => /iac|loopmidi|touchless/i.test(n)) ?? outs[0];
      sheet.show({
        step: 'SETUP · MIDI PORT',
        title: 'Which port should Trackstar use?',
        body: `<p>Pick the virtual port rekordbox listens to. Do not pick the FLX2 itself.</p>
          <div class="field"><label for="port-pick">MIDI port</label>
          <select id="port-pick">${outs.map((n) => `<option${n === preferred ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`,
        actions: [
          {
            label: 'Use this port',
            primary: true,
            onClick: () => resolve((document.getElementById('port-pick') as HTMLSelectElement).value),
          },
          { label: 'Refresh list', onClick: render },
        ],
      });
    };
    render();
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function capture(sheet: Sheet, sample: () => number | null, ms: number): Promise<number[]> {
  const values: number[] = [];
  const start = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const k = (performance.now() - start) / ms;
      sheet.setMeter(k);
      const v = sample();
      if (v !== null && Number.isFinite(v)) values.push(v);
      if (k >= 1) resolve(values);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export interface CalibrationOutcome {
  on: number;
  off: number;
}

/**
 * Two short captures of the clutch ratio: thumb pressed, then thumb away.
 * Resolves with thresholds, or null if the user skipped.
 */
export function calibrate(sheet: Sheet, sample: () => number | null): Promise<CalibrationOutcome | null> {
  return new Promise((resolve) => {
    const intro = (error?: string) =>
      sheet.show({
        step: 'SETUP · THUMB CLUTCH',
        title: 'Calibrate the thumb clutch',
        body: `<p>The clutch is how you arm a hand: make a fist and press your thumb against the side of your index finger, near the knuckle. Nothing fires unless it is held.</p>
          <p>Two quick captures of about 1.5 seconds each. Keep one hand clearly in view.</p>`,
        error,
        docked: true,
        actions: [
          { label: 'Start', primary: true, onClick: () => void run() },
          { label: 'Skip for now', onClick: () => resolve(null) },
        ],
      });

    const run = async () => {
      sheet.show({
        step: 'CAPTURE 1 OF 2',
        title: 'Fist, thumb pressed to your index knuckle',
        body: '<p>Get ready...</p>',
        docked: true,
        meter: true,
      });
      await wait(1000);
      sheet.show({ step: 'CAPTURE 1 OF 2', title: 'Fist, thumb pressed to your index knuckle', body: '<p>Hold it.</p>', docked: true, meter: true });
      const engaged = await capture(sheet, sample, 1500);

      sheet.show({ step: 'CAPTURE 2 OF 2', title: 'Keep the fist, move your thumb away', body: '<p>Get ready...</p>', docked: true, meter: true });
      await wait(1000);
      sheet.show({ step: 'CAPTURE 2 OF 2', title: 'Keep the fist, move your thumb away', body: '<p>Hold it.</p>', docked: true, meter: true });
      const relaxed = await capture(sheet, sample, 1500);

      const result = computeClutchThresholds(engaged, relaxed);
      if (!result.ok) {
        intro(result.reason);
        return;
      }
      sheet.show({
        step: 'SETUP · THUMB CLUTCH',
        title: 'Clutch calibrated',
        body: '<p>Try it: press your thumb in and the ring around your hand turns solid white. You can recalibrate any time from Settings.</p>',
        docked: true,
        actions: [{ label: 'Done', primary: true, onClick: () => resolve({ on: result.on, off: result.off }) }],
      });
    };

    intro();
  });
}
