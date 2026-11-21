// state variable filter, trapezoidal (TPT) integration: Vadim Zavalishin (The Art of VA Filter Design), Andrew Simper (Cytomic)

import { clamp, sanitize } from './math';

/** Trapezoidal (TPT) state variable filter with simultaneous low-pass, band-pass and high-pass outputs. */
export class Svf {
  /** Low-pass output of the most recent `process` call. */
  lp = 0;
  /** Band-pass output, normalised to 0 dB at the centre frequency. */
  bp = 0;
  /** High-pass output. */
  hp = 0;

  #sampleRate: number;
  #k = 0;
  #a1 = 0;
  #a2 = 0;
  #a3 = 0;
  #ic1eq = 0;
  #ic2eq = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.set(1000, 0.7071);
  }

  /** Sets cutoff (Hz) and resonance. Cheap enough to call on every sample. Does not clear the filter memory. */
  set(freq: number, q: number): void {
    const f = clamp(freq, 10, 0.45 * this.#sampleRate);
    const qq = clamp(q, 0.1, 30);
    const g = Math.tan((Math.PI * f) / this.#sampleRate);
    const k = 1 / qq;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    this.#k = k;
    this.#a1 = a1;
    this.#a2 = a2;
    this.#a3 = g * a2;
  }

  /** Filters one sample and updates `lp`, `bp` and `hp`. Non-finite input is treated as 0. */
  process(x: number): void {
    const v0 = sanitize(x);
    const ic1eq = this.#ic1eq;
    const ic2eq = this.#ic2eq;
    const v3 = v0 - ic2eq;
    const v1 = this.#a1 * ic1eq + this.#a2 * v3;
    const v2 = ic2eq + this.#a2 * ic1eq + this.#a3 * v3;
    this.#ic1eq = 2 * v1 - ic1eq;
    this.#ic2eq = 2 * v2 - ic2eq;
    this.lp = v2;
    this.bp = this.#k * v1;
    this.hp = v0 - this.#k * v1 - v2;
  }

  /** Clears the filter memory and the three outputs. Cutoff and resonance are kept. */
  reset(): void {
    this.#ic1eq = 0;
    this.#ic2eq = 0;
    this.lp = 0;
    this.bp = 0;
    this.hp = 0;
  }
}
