// sample-and-hold with a fractional hold counter, then uniform bit-depth quantisation

import { clamp, sanitize } from './math';

/** Bit crusher: bit-depth reduction plus sample-and-hold rate reduction. */
export class Crusher {
  #step = 2 / 2 ** 16;
  #factor = 1;
  #held = 0;
  #count = 0;
  #primed = false;
  #towardZero = false;

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

  /**
   * Rounding mode. Off (the default): each value goes to the nearest step. On: toward zero.
   * Use "on" inside a feedback loop. Rounding to nearest can round a quiet echo back up to the
   * level it came from on every pass, so the tail never dies; rounding toward zero can only
   * shrink it.
   */
  setTruncate(on: boolean): void {
    this.#towardZero = on === true;
  }

  /** Processes one sample. Non-finite input is treated as 0. */
  process(x: number): number {
    if (!this.#primed) {
      this.#primed = true;
      this.#count = 0;
      this.#held = this.#quantise(sanitize(x));
    } else {
      this.#count += 1;
      if (this.#count >= this.#factor) {
        this.#count -= this.#factor;
        this.#held = this.#quantise(sanitize(x));
      }
    }
    return this.#held;
  }

  /** Moves a value onto the step grid. The `+ 0` turns a negative zero into a normal zero. */
  #quantise(v: number): number {
    const steps = v / this.#step;
    return (this.#towardZero ? Math.trunc(steps) : Math.round(steps)) * this.#step + 0;
  }

  /** Clears the held value and the hold counter. Settings are kept. */
  reset(): void {
    this.#held = 0;
    this.#count = 0;
    this.#primed = false;
  }
}
