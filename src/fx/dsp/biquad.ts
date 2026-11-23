// biquad filter, transposed direct form II: Audio EQ Cookbook by Robert Bristow-Johnson

import { clamp, sanitize } from './math';

type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'allpass';

/** Second-order IIR filter (biquad), Audio EQ Cookbook coefficients, transposed direct form II. */
export class Biquad {
  #b0 = 1;
  #b1 = 0;
  #b2 = 0;
  #a1 = 0;
  #a2 = 0;
  #z1 = 0;
  #z2 = 0;

  /** Second-order low-pass. */
  setLowpass(freq: number, q: number, sampleRate: number): void {
    this.#design('lowpass', freq, q, sampleRate);
  }

  /** Second-order high-pass. */
  setHighpass(freq: number, q: number, sampleRate: number): void {
    this.#design('highpass', freq, q, sampleRate);
  }

  /** Band-pass with 0 dB gain at the centre frequency. */
  setBandpass(freq: number, q: number, sampleRate: number): void {
    this.#design('bandpass', freq, q, sampleRate);
  }

  /** All-pass: flat level, frequency-dependent phase. */
  setAllpass(freq: number, q: number, sampleRate: number): void {
    this.#design('allpass', freq, q, sampleRate);
  }

  /** Filters one sample. Non-finite input is treated as 0. */
  process(x: number): number {
    const v = sanitize(x);
    const y = this.#b0 * v + this.#z1;
    this.#z1 = this.#b1 * v - this.#a1 * y + this.#z2;
    this.#z2 = this.#b2 * v - this.#a2 * y;
    return y;
  }

  /** Clears the filter memory. Coefficients are kept. */
  reset(): void {
    this.#z1 = 0;
    this.#z2 = 0;
  }

  /** Computes and stores normalised coefficients. Leaves the filter memory untouched. */
  #design(type: BiquadType, freq: number, q: number, sampleRate: number): void {
    const f = clamp(freq, 10, 0.45 * sampleRate);
    const qq = clamp(q, 0.1, 30);
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * qq);
    let b0: number;
    let b1: number;
    let b2: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cosw) / 2;
        b1 = 1 - cosw;
        b2 = b0;
        break;
      case 'highpass':
        b0 = (1 + cosw) / 2;
        b1 = -(1 + cosw);
        b2 = b0;
        break;
      case 'bandpass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        break;
      default:
        b0 = 1 - alpha;
        b1 = -2 * cosw;
        b2 = 1 + alpha;
        break;
    }
    const a0 = 1 + alpha;
    this.#b0 = b0 / a0;
    this.#b1 = b1 / a0;
    this.#b2 = b2 / a0;
    this.#a1 = (-2 * cosw) / a0;
    this.#a2 = (1 - alpha) / a0;
  }
}
