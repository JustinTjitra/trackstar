/**
 * Deterministic synthetic audio helpers for DSP unit tests. No randomness: noise uses a
 * seeded PRNG, so the same arguments always produce the same samples.
 */

/** A sine of `freq` Hz lasting `seconds`, with peak amplitude `amp`. */
export function sine(freq: number, seconds: number, sampleRate: number, amp = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let n = 0; n < out.length; n++) out[n] = amp * Math.sin(w * n);
  return out;
}

/** All zeros except a 1 at index `at`. Out-of-range `at` leaves the buffer all zeros. */
export function impulse(length: number, at = 0): Float32Array {
  const out = new Float32Array(length);
  if (at >= 0 && at < length) out[at] = 1;
  return out;
}

/** A buffer of `length` zeros. */
export function silence(length: number): Float32Array {
  return new Float32Array(length);
}

/** Mulberry32 PRNG: returns a function producing floats in [0, 1) from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform white noise in [-amp, amp]. The same seed always gives the same output. */
export function noise(length: number, seed = 1, amp = 1): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(length);
  for (let n = 0; n < length; n++) out[n] = (rand() * 2 - 1) * amp;
  return out;
}

/**
 * A click track: a decaying burst of `clickMs` (default 5) with peak `amp` (default 1) at
 * each beat. Beat k starts at Math.round(k * 60 / bpm * sampleRate). The burst is a 1 kHz
 * cosine under an exponential decay, so its first sample is exactly `amp`. Everything
 * between clicks is exactly 0.
 */
export function clickTrack(
  bpm: number,
  seconds: number,
  sampleRate: number,
  opts: { clickMs?: number; amp?: number } = {},
): Float32Array {
  if (!(bpm > 0)) throw new Error('clickTrack: bpm must be positive');
  const clickMs = opts.clickMs ?? 5;
  const amp = opts.amp ?? 1;
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const clickLen = Math.max(1, Math.round((clickMs * sampleRate) / 1000));
  const w = (2 * Math.PI * 1000) / sampleRate;
  for (let k = 0; ; k++) {
    const start = Math.round(((k * 60) / bpm) * sampleRate);
    if (start >= out.length) break;
    const end = Math.min(out.length, start + clickLen);
    for (let n = start; n < end; n++) {
      const i = n - start;
      out[n] = amp * Math.exp((-6 * i) / clickLen) * Math.cos(w * i);
    }
  }
  return out;
}

/** Root mean square over [from, to). Returns 0 for an empty range. */
export function rms(x: Float32Array, from = 0, to = x.length): number {
  const start = Math.max(0, from);
  const end = Math.min(x.length, to);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / (end - start));
}

/** Maximum absolute sample value. Returns 0 for an empty array. */
export function peak(x: Float32Array): number {
  let max = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > max) max = a;
  }
  return max;
}

/** Converts a linear amplitude to decibels. Returns -200 for values <= 0. */
export function toDb(linear: number): number {
  if (linear <= 0) return -200;
  return 20 * Math.log10(linear);
}

/**
 * Amplitude of the `freq` component, estimated with the Goertzel algorithm and normalised
 * so a full-scale sine at `freq` over a whole number of cycles reads about 1.
 */
export function magnitudeAt(x: Float32Array, freq: number, sampleRate: number): number {
  if (x.length === 0) return 0;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let n = 0; n < x.length; n++) {
    const s0 = x[n] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(power, 0))) / x.length;
}

/** True when every sample is a finite number (no NaN or Infinity). */
export function allFinite(x: Float32Array): boolean {
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) return false;
  }
  return true;
}

/**
 * Calls `fn` on consecutive blocks of `block` frames, using subarray views so in-place
 * processing writes through to `l` and `r`. The last call gets the remainder. Every sample
 * is visited exactly once.
 */
export function runBlocks(
  fn: (l: Float32Array, r: Float32Array, frames: number) => void,
  l: Float32Array,
  r: Float32Array,
  block = 128,
): void {
  if (l.length !== r.length) throw new Error('runBlocks: l and r must have equal length');
  if (!(block >= 1)) throw new Error('runBlocks: block must be at least 1');
  for (let i = 0; i < l.length; i += block) {
    const frames = Math.min(block, l.length - i);
    fn(l.subarray(i, i + frames), r.subarray(i, i + frames), frames);
  }
}
