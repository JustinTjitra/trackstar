import type { HandFrame } from './types';

/**
 * Dev tool, enabled with ?record in the URL. Records tracked landmarks so real
 * hand sequences can become test fixtures alongside the synthetic ones.
 */
export class Recorder {
  private frames: { t: number; hands: HandFrame[] }[] = [];
  private recording = false;
  private url: string | null = null;

  constructor(private readonly root: HTMLElement) {
    root.hidden = false;
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-rec]')) this.toggle();
    });
    this.render();
  }

  push(t: number, hands: HandFrame[]): void {
    if (!this.recording) return;
    this.frames.push({ t, hands });
    if (this.frames.length % 15 === 0) this.render();
  }

  private toggle(): void {
    this.recording = !this.recording;
    if (this.recording) {
      this.frames = [];
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = null;
    } else {
      const blob = new Blob([JSON.stringify({ version: 1, frames: this.frames })], { type: 'application/json' });
      this.url = URL.createObjectURL(blob);
    }
    this.render();
  }

  private render(): void {
    const name = `trackstar-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    this.root.innerHTML = `
      <button class="btn" type="button" data-rec>${this.recording ? 'Stop' : 'Record'}</button>
      <span>${this.frames.length} frames</span>
      ${this.url ? `<a href="${this.url}" download="${name}">Download</a>` : ''}`;
  }
}
