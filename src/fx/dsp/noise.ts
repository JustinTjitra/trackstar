// seeded noise: mulberry32 PRNG; pink noise via Paul Kellett's economy pink noise filter

/** Brings the pink filter output to roughly -1..1. */
const PINK_SCALE = 0.15;

/** Deterministic noise generator: uniform white noise and pink (1/f) noise from a seeded PRNG. */
export class NoiseSource {
  #state = 0;
  #b0 = 0;
  #b1 = 0;
  #b2 = 0;

  constructor(seed = 1) {
    this.#state = seed >>> 0;
  }

  /** Next white noise sample, uniform in [-1, 1). */
  white(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return u * 2 - 1;
  }

  /** Next pink noise sample (equal energy per octave), scaled so it mostly stays within -1..1. */
  pink(): number {
    const w = this.white();
    this.#b0 = 0.99765 * this.#b0 + w * 0.099046;
    this.#b1 = 0.963 * this.#b1 + w * 0.2965164;
    this.#b2 = 0.57 * this.#b2 + w * 1.0526913;
    return (this.#b0 + this.#b1 + this.#b2 + w * 0.1848) * PINK_SCALE;
  }

  /** Restarts the generator from `seed` and clears the pink filter memory, so the sequence repeats exactly. */
  reseed(seed: number): void {
    this.#state = seed >>> 0;
    this.#b0 = 0;
    this.#b1 = 0;
    this.#b2 = 0;
  }
}
