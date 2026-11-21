// one-pole exponential smoother: glides a value toward a target without clicks

import { sanitize } from './math';

/** Relative distance from the target at which the value snaps onto it. */
const SNAP = 1e-9;

/** One-pole exponential smoother: glides a value toward a target without clicks. */
export class Smoother {
  #coeff: number;
  #value: number;
  #target: number;

  constructor(sampleRate: number, timeMs: number, initial = 0) {
    const samples = timeMs * 0.001 * sampleRate;
    this.#coeff = Number.isFinite(samples) && samples > 0 ? Math.exp(-1 / samples) : 0;
    const start = sanitize(initial);
    this.#value = start;
    this.#target = start;
  }

  /** Sets the value to glide toward. Non-finite values (NaN, Infinity) are ignored. */
  setTarget(v: number): void {
    if (Number.isFinite(v)) this.#target = v;
  }

  /** Sets both the current value and the target immediately, with no glide. Non-finite values are ignored. */
  jump(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#value = v;
    this.#target = v;
  }

  /** Advances one sample and returns the new current value. */
  next(): number {
    const target = this.#target;
    let value = target + (this.#value - target) * this.#coeff;
    // Snap when close enough. The threshold scales with the target because a large value (a
    // delay of 24000 samples, say) otherwise stalls a few billionths short: each step becomes
    // smaller than the spacing between neighbouring floating point numbers and rounds away.
    if (Math.abs(value - target) < SNAP * Math.max(1, Math.abs(target))) value = target;
    this.#value = value;
    return value;
  }

  /** The current value, without advancing. */
  get value(): number {
    return this.#value;
  }

  /** The value being glided toward. */
  get target(): number {
    return this.#target;
  }

  /** True when the current value is within `eps` of the target. */
  isSettled(eps = 1e-4): boolean {
    return Math.abs(this.#value - this.#target) <= eps;
  }
}
