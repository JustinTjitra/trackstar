/** Full turn in radians (2 * PI). */
export const TAU: number = 2 * Math.PI;

/** Limits x to [lo, hi]; NaN returns lo. */
export function clamp(x: number, lo: number, hi: number): number {
  if (x !== x) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

/** Limits x to [0, 1]; NaN returns 0. */
export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Linear interpolation from a to b; t is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Geometric interpolation from a to b for positive values (frequencies); t is not clamped. */
export function expLerp(a: number, b: number, t: number): number {
  return a * (b / a) ** t;
}

/** Converts decibels to a linear gain factor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Converts a linear gain factor to decibels; returns -Infinity for gain <= 0. */
export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

/** Converts a length in beats to a (fractional) number of samples. */
export function beatsToSamples(beats: number, bpm: number, sampleRate: number): number {
  return (beats * 60 / bpm) * sampleRate;
}

/** Returns x when finite, otherwise 0. */
export function sanitize(x: number): number {
  return Number.isFinite(x) ? x : 0;
}
