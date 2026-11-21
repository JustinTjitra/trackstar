// tanh soft knee, and a stereo-linked peak limiter with instant attack and one-pole exponential release

import { clamp, sanitize } from './math';

/** Magnitude up to which softClip is the identity; the soft knee starts here. */
const KNEE = 0.5;

/** Smooth saturation: unchanged up to 0.5 in magnitude, then a soft knee that never exceeds 1. */
export function softClip(x: number): number {
  if (x !== x) return 0;
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const y = KNEE + KNEE * Math.tanh((a - KNEE) / KNEE);
  return x < 0 ? -y : y;
}

/** Stereo-linked peak limiter: instant attack, exponential release, no lookahead. */
export class Limiter {
  #ceiling: number;
  #releaseCoeff: number;
  #g = 1;

  /** Throws RangeError unless sampleRate is finite and > 0. */
  constructor(sampleRate: number, ceiling = 0.98, releaseMs = 80) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('Limiter: sampleRate must be finite and > 0');
    }
    this.#ceiling = clamp(Number.isFinite(ceiling) ? ceiling : 0.98, 0.01, 1);
    const ms = clamp(Number.isFinite(releaseMs) ? releaseMs : 80, 1, 5000);
    this.#releaseCoeff = 1 - Math.exp(-1 / (ms * 0.001 * sampleRate));
  }

  /** Limits the first `frames` samples of both buffers in place. Samples beyond `frames` are not touched. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const ceiling = this.#ceiling;
    const coeff = this.#releaseCoeff;
    let g = this.#g;
    for (let i = 0; i < n; i++) {
      const a = sanitize(l[i]);
      const b = sanitize(r[i]);
      const peak = Math.max(Math.abs(a), Math.abs(b));

      // recover toward 1, snapping so a long-quiet limiter is exactly transparent
      g = g + (1 - g) * coeff;
      if (1 - g < 1e-9) g = 1;

      // instant attack: never let this sample exceed the ceiling
      if (peak * g > ceiling) g = ceiling / peak;

      l[i] = a * g;
      r[i] = b * g;
    }
    this.#g = g;
  }

  /** Current gain: 1 means no reduction, smaller means the limiter is holding the level down. */
  get gain(): number {
    return this.#g;
  }

  /** Sets the gain back to 1. */
  reset(): void {
    this.#g = 1;
  }
}
