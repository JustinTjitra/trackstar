// circular buffer with power-of-two mask wrap and linear-interpolated fractional reads

import { clamp, sanitize } from './math';

/**
 * Circular buffer delay line with linear-interpolated fractional reads.
 *
 * Usage: `line.write(x); line.read(d)` gives a delay of `d >= 0` samples relative to the
 * current sample (`read(0)` is `x` itself). `const y = line.read(d - 1); line.write(x);`
 * gives a delay of `d >= 1` samples relative to the sample about to be written, because
 * before the write `read(0)` is still the previous sample.
 */
export class DelayLine {
  #buf: Float32Array;
  #mask: number;
  #pos = 0;
  #max: number;

  /** `maxDelaySamples` is the longest delay that can be read. Throws RangeError if it is not a finite number >= 1. */
  constructor(maxDelaySamples: number) {
    if (!Number.isFinite(maxDelaySamples) || maxDelaySamples < 1) {
      throw new RangeError('DelayLine: maxDelaySamples must be a finite number >= 1');
    }
    this.#max = Math.ceil(maxDelaySamples);
    // room for delays 0..max plus the interpolation neighbour at max + 1
    let size = 1;
    while (size < this.#max + 2) size *= 2;
    this.#buf = new Float32Array(size);
    this.#mask = size - 1;
  }

  /** Stores one sample. Non-finite input (NaN, Infinity) is stored as 0. */
  write(x: number): void {
    this.#buf[this.#pos] = sanitize(x);
    this.#pos = (this.#pos + 1) & this.#mask;
  }

  /** Returns the sample written `delaySamples` writes ago: 0 is the newest sample. Clamped to [0, maxDelay]; NaN reads as 0. */
  read(delaySamples: number): number {
    const d = clamp(delaySamples, 0, this.#max);
    const i = Math.floor(d);
    const frac = d - i;
    const buf = this.#buf;
    const mask = this.#mask;
    // newest sample sits at pos - 1; delay i sits i slots further back
    const base = this.#pos - 1 - i;
    const a = buf[base & mask];
    const b = buf[(base - 1) & mask];
    return a + (b - a) * frac;
  }

  /** Zeroes the buffer. */
  clear(): void {
    this.#buf.fill(0);
  }

  /** The longest readable delay, in samples (an integer). */
  get maxDelay(): number {
    return this.#max;
  }
}
