// sample-and-hold with a fractional hold counter, then uniform bit-depth quantisation

import { clamp, sanitize } from './math';

/** Bit crusher: bit-depth reduction plus sample-and-hold rate reduction. */
export class Crusher {
  #step = 2 / 2 ** 16;
  #factor = 1;
  #held = 0;
  #count = 0;
  #primed = false;

  /** Bit depth, clamped to 1..16; fractional values allowed. Non-finite values are ignored. Default 16. */
  setBits(bits: number): void {
    if (!Number.isFinite(bits)) return;
    this.#step = 2 / 2 ** clamp(bits, 1, 16);
  }

  /** Hold length in samples, clamped to 1..64; fractional values allowed. Non-finite values are ignored. Default 1. */
  setDownsample(factor: number): void {
    if (!Number.isFinite(factor)) return;
    this.#factor = clamp(factor, 1, 64);
  }

  /** Processes one sample. Non-finite input is treated as 0. */
  process(x: number): number {
    if (!this.#primed) {
      this.#primed = true;
      this.#count = 0;
      this.#held = Math.round(sanitize(x) / this.#step) * this.#step + 0;
    } else {
      this.#count += 1;
      if (this.#count >= this.#factor) {
        this.#count -= this.#factor;
        this.#held = Math.round(sanitize(x) / this.#step) * this.#step + 0;
      }
    }
    return this.#held;
  }

  /** Clears the held value and the hold counter. Settings are kept. */
  reset(): void {
    this.#held = 0;
    this.#count = 0;
    this.#primed = false;
  }
}
