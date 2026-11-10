import type { Config } from '../config/config';
import { ACTIONS, ACTION_POSES, type Action, type ActionPose } from '../types';
import { actionLabel } from './labels';

const POSE_NAMES: Record<ActionPose, string> = {
  index: 'Index',
  index_middle: 'Index + middle',
  index_middle_ring: 'Index + middle + ring',
  all_four: 'All four fingers',
  pinky: 'Pinky',
  index_pinky: 'Index + pinky',
};

export interface SettingsDeps {
  root: HTMLElement;
  getConfig: () => Config;
  setConfig: (next: Config) => void;
  outputs: () => string[];
  inputs: () => string[];
  recalibrate: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class SettingsDrawer {
  constructor(private readonly deps: SettingsDeps) {
    deps.root.addEventListener('change', (e) => this.onChange(e));
    deps.root.addEventListener('input', (e) => this.onInput(e));
    deps.root.addEventListener('click', (e) => this.onClick(e));
  }

  get open(): boolean {
    return !this.deps.root.hidden;
  }

  toggle(force?: boolean): void {
    const show = force ?? !this.open;
    if (show) this.render();
    this.deps.root.hidden = !show;
  }

  /** Re-render when ports come and go while open. */
  refresh(): void {
    if (this.open) this.render();
  }

  private render(): void {
    const c = this.deps.getConfig();
    const outs = this.deps.outputs();
    const ins = this.deps.inputs();
    const opt = (value: string, label: string, selected: boolean) =>
      `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
    const missingOut = c.outPort && !outs.includes(c.outPort) ? opt(c.outPort, `${c.outPort} (not connected)`, true) : '';
    const missingIn = c.inPort && !ins.includes(c.inPort) ? opt(c.inPort, `${c.inPort} (not connected)`, true) : '';
    const actionOptions = (selected: Action | null) =>
      opt('', 'Nothing', selected === null) + ACTIONS.map((a) => opt(a, actionLabel(a), a === selected)).join('');

    this.deps.root.innerHTML = `
      <header><h2>Settings</h2><button class="btn" data-act="close" type="button">Close</button></header>

      <section>
        <h3>MIDI</h3>
        <div class="field"><label for="set-out">Send to</label>
          <select id="set-out" data-key="outPort">${opt('', 'No port', !c.outPort)}${missingOut}${outs.map((n) => opt(n, n, n === c.outPort)).join('')}</select></div>
        <div class="field"><label for="set-in">Read feedback from</label>
          <select id="set-in" data-key="inPort">${opt('', 'Same port as above', !c.inPort)}${missingIn}${ins.map((n) => opt(n, n, n === c.inPort)).join('')}</select></div>
        <label class="check"><input type="checkbox" id="set-fb" data-key="feedbackEnabled"${c.feedbackEnabled ? ' checked' : ''}> Use rekordbox feedback</label>
        <p class="help">Commands go out on channels 1 (deck A) and 2 (deck B). Map rekordbox's MIDI OUT for each control to channel 3 (deck A) or 4 (deck B) on the same note.</p>
      </section>

      <section>
        <h3>GESTURES</h3>
        <div class="field"><span class="lbl">Hold time <span class="value" data-show="holdMs">${c.holdMs} ms</span></span>
          <input type="range" id="set-hold" data-key="holdMs" min="40" max="250" step="10" value="${c.holdMs}"></div>
        <div class="field"><span class="lbl">Motion limit <span class="value" data-show="speedGate">${c.speedGate.toFixed(1)}</span></span>
          <input type="range" id="set-speed" data-key="speedGate" min="1" max="8" step="0.5" value="${c.speedGate}">
          <p class="help">Nothing fires while your hand moves faster than this, in hand lengths per second.</p></div>
        <div class="field"><span class="lbl">Thumb clutch ${c.calibrated ? 'calibrated' : 'not calibrated (using defaults)'}</span>
          <button class="btn" type="button" data-act="recalibrate">Recalibrate clutch</button></div>
        <div class="field"><span class="lbl">Pose map (with the clutch held)</span>
          <div class="grid-table" style="grid-template-columns: 1fr 1fr">
            ${ACTION_POSES.map(
              (p) => `<label for="pose-${p}">${POSE_NAMES[p]}</label><select id="pose-${p}" data-pose="${p}">${actionOptions(c.poseMap[p])}</select>`,
            ).join('')}
          </div></div>
      </section>

      <section>
        <h3>CONTROLS</h3>
        <div class="grid-table">
          <span class="hd">CONTROL</span><span class="hd">BLIND</span><span class="hd">INVERT</span>
          ${ACTIONS.map(
            (a) => `<span>${actionLabel(a)}</span>
              <input type="checkbox" aria-label="${actionLabel(a)} blind" id="blind-${a}" data-blind="${a}"${c.blind[a] ? ' checked' : ''}>
              <input type="checkbox" aria-label="${actionLabel(a)} invert" id="invert-${a}" data-invert="${a}"${c.invert[a] ? ' checked' : ''}>`,
          ).join('')}
        </div>
        <p class="help">Blind: rekordbox gives no feedback for this control, so the display flips when you gesture. Invert: rekordbox's light means the opposite (for example lit while a stem is playing).</p>
      </section>

      <section>
        <h3>DISPLAY</h3>
        <label class="check"><input type="checkbox" id="set-skel" data-key="showSkeleton"${c.showSkeleton ? ' checked' : ''}> Show hand skeleton</label>
        <div class="field"><span class="lbl">Camera dimming <span class="value" data-show="cameraDim">${Math.round(c.cameraDim * 100)}%</span></span>
          <input type="range" id="set-dim" data-key="cameraDim" min="0" max="0.8" step="0.05" value="${c.cameraDim}"></div>
      </section>`;
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.type !== 'range') return;
    this.apply(el);
  }

  private onChange(e: Event): void {
    this.apply(e.target as HTMLInputElement | HTMLSelectElement);
  }

  private apply(el: HTMLInputElement | HTMLSelectElement): void {
    const c = structuredClone(this.deps.getConfig());
    const key = el.dataset.key as keyof Config | undefined;
    if (key) {
      if (el instanceof HTMLInputElement && el.type === 'checkbox') (c[key] as boolean) = el.checked;
      else if (el instanceof HTMLInputElement && el.type === 'range') (c[key] as number) = Number(el.value);
      else (c[key] as string | null) = el.value || null;
      const show = this.deps.root.querySelector<HTMLElement>(`[data-show="${key}"]`);
      if (show) {
        if (key === 'holdMs') show.textContent = `${c.holdMs} ms`;
        if (key === 'speedGate') show.textContent = c.speedGate.toFixed(1);
        if (key === 'cameraDim') show.textContent = `${Math.round(c.cameraDim * 100)}%`;
      }
    } else if (el.dataset.pose) {
      c.poseMap[el.dataset.pose as ActionPose] = (el.value || null) as Action | null;
    } else if (el.dataset.blind) {
      c.blind[el.dataset.blind as Action] = (el as HTMLInputElement).checked;
    } else if (el.dataset.invert) {
      c.invert[el.dataset.invert as Action] = (el as HTMLInputElement).checked;
    } else {
      return;
    }
    this.deps.setConfig(c);
  }

  private onClick(e: Event): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') this.toggle(false);
    if (act === 'recalibrate') {
      this.toggle(false);
      this.deps.recalibrate();
    }
  }
}
