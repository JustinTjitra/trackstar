import type { MidiStatus } from '../midi/io';

export interface StatusInfo {
  midi: MidiStatus | null;
  feedbackEnabled: boolean;
  fps: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderStatus(el: HTMLElement, info: StatusInfo): void {
  const m = info.midi;
  const out = !m?.outName
    ? `<span><span class="dot bad"></span>No MIDI port</span>`
    : `<span><span class="dot ${m.outConnected ? 'ok' : 'bad'}"></span>OUT ${esc(m.outName)}</span>`;
  let fb: string;
  if (!info.feedbackEnabled) fb = `<span><span class="dot warn"></span>Feedback off</span>`;
  else if (!m?.inConnected) fb = `<span><span class="dot bad"></span>No feedback port</span>`;
  else if (!m.feedbackSeen) fb = `<span><span class="dot warn"></span>Waiting for rekordbox</span>`;
  else fb = `<span><span class="dot ok"></span>Feedback OK</span>`;
  const html = `${out}${fb}<span>${Math.round(info.fps)} fps</span>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

export function showBanner(el: HTMLElement, text: string | null): void {
  if (text === null) {
    el.hidden = true;
    return;
  }
  el.textContent = text;
  el.hidden = false;
}
