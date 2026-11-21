import { describe, expect, it } from 'vitest';
import { BpmDetector } from '../../src/fx/tempo/bpmDetector';
import { OnsetDetector } from '../../src/fx/tempo/onset';
import { clickTrack, noise } from '../fixtures/synthAudio';

const SR = 48000;
const HOP_RATE = 93.75;

interface Opts {
  windowSeconds?: number;
  minBpm?: number;
  maxBpm?: number;
}

/** The onset strength values of x, as the detector produces them. */
function onsets(x: Float32Array, sampleRate = SR): number[] {
  const out: number[] = [];
  new OnsetDetector(sampleRate).process(x, x.length, (v) => {
    out.push(v);
  });
  return out;
}

/** Pushes every value. */
function feed(det: BpmDetector, values: number[]): void {
  for (const v of values) det.push(v);
}

/** Sum of two equally long buffers. */
function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i] + b[i];
  return out;
}

/** Onsets of a click track of the given length. */
function clicks(bpm: number, seconds = 8.5, sampleRate = SR): number[] {
  return onsets(clickTrack(bpm, seconds, sampleRate), sampleRate);
}

/** Onsets of a click track plus seeded noise. */
function noisyClicks(bpm: number, seconds: number, seed: number, amp: number): number[] {
  const n = Math.round(seconds * SR);
  return onsets(mix(clickTrack(bpm, seconds, SR), noise(n, seed, amp)));
}

/** Reads the current estimate as a plain copy, or null. */
function read(det: BpmDetector): { bpm: number; confidence: number } | null {
  const e = det.estimate();
  return e === null ? null : { bpm: e.bpm, confidence: e.confidence };
}

/** Runs a fresh detector over the values and reads the estimate. */
function run(values: number[], hopRate = HOP_RATE, opts?: Opts): { bpm: number; confidence: number } | null {
  const det = new BpmDetector(hopRate, opts);
  feed(det, values);
  return read(det);
}

/** The expected result, written out with plain variables. */
function reference(
  values: number[],
  hopRate: number,
  opts: Opts = {},
): { bpm: number; confidence: number } | null {
  const w = typeof opts.windowSeconds === 'number' && Number.isFinite(opts.windowSeconds) && opts.windowSeconds > 0
    ? Math.min(30, Math.max(2, opts.windowSeconds))
    : 8;
  let minBpm = 70;
  let maxBpm = 180;
  const a0 = opts.minBpm;
  const b0 = opts.maxBpm;
  if (
    typeof a0 === 'number' && typeof b0 === 'number' &&
    Number.isFinite(a0) && Number.isFinite(b0) && a0 > 0 && b0 > 0 && b0 >= 2 * a0
  ) {
    minBpm = a0;
    maxBpm = b0;
  }
  const N = Math.max(8, Math.round(w * hopRate));
  const lo = Math.max(1, Math.floor((hopRate * 60) / maxBpm));
  const hiFull = Math.ceil((2 * hopRate * 60) / minBpm);
  const Lmax = Math.min(N - 1, 2 * hiFull + 4);

  const a = values.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0)).slice(-N);
  const M = a.length;
  if (M < Math.ceil(N / 2)) return null;
  const z = a.map((v, i) => (i >= 1 && i <= M - 2 ? 0.25 * a[i - 1] + 0.5 * v + 0.25 * a[i + 1] : v));
  const mean = z.reduce((s, v) => s + v, 0) / M;
  for (let i = 0; i < M; i++) z[i] -= mean;

  const L = Math.min(M - 1, Lmax);
  const hi = Math.min(hiFull, L - 1);
  if (lo > hi) return null;
  const r: number[] = [];
  for (let l = 0; l <= L; l++) {
    let s = 0;
    for (let i = 0; i + l < M; i++) s += z[i] * z[i + l];
    r.push(s);
  }
  if (!(r[0] > M * 1e-12)) return null;

  let g = -Infinity;
  let gi = lo;
  for (let l = lo; l <= hi; l++) {
    if (r[l] > g) {
      g = r[l];
      gi = l;
    }
  }
  if (!(g > 0)) return null;
  let pk = gi;
  for (let l = lo; l <= hi; l++) {
    if (r[l] >= 0.8 * g && r[l] >= r[l - 1] && r[l] >= r[l + 1]) {
      pk = l;
      break;
    }
  }
  const refine = (c: number): number => {
    let sw = 0;
    let sl = 0;
    for (let l = Math.max(0, c - 2); l <= Math.min(L, c + 2); l++) {
      const wt = Math.max(0, r[l]);
      sw += wt;
      sl += wt * l;
    }
    return sw > 0 ? sl / sw : c;
  };
  let lag = refine(pk);
  for (let k = 2; k <= 4; k++) {
    const c0 = Math.round(k * lag);
    if (c0 + 2 > L) break;
    let c = c0 - 2;
    for (let l = c0 - 2; l <= c0 + 2; l++) if (r[l] > r[c]) c = l;
    if (r[c] < 0.5 * r[pk]) break;
    lag = refine(c) / k;
  }
  let bpm = (60 * hopRate) / lag;
  while (bpm < minBpm) bpm *= 2;
  while (bpm > maxBpm) bpm /= 2;
  return { bpm, confidence: Math.min(1, Math.max(0, r[pk] / r[0])) };
}

/** Asserts a result is not null and returns it. */
function some(e: { bpm: number; confidence: number } | null): { bpm: number; confidence: number } {
  expect(e).not.toBeNull();
  return e as { bpm: number; confidence: number };
}

describe('BpmDetector construction', () => {
  it('throws RangeError for a bad hopRate', () => {
    for (const h of [0, -1, NaN, Infinity]) expect(() => new BpmDetector(h)).toThrow(RangeError);
  });

  it('has no estimate before any push', () => {
    expect(new BpmDetector(HOP_RATE).estimate()).toBeNull();
  });
});

describe('BpmDetector against the reference', () => {
  it('matches the reference for noisy clicks at several lengths (ring wrapping)', () => {
    const all = noisyClicks(128, 20, 5, 0.1);
    expect(all.length).toBeGreaterThan(1700);
    for (const n of [400, 750, 751, 1000, 1700]) {
      const values = all.slice(0, n);
      const got = some(run(values));
      const want = some(reference(values, HOP_RATE));
      expect(Math.abs(got.bpm - want.bpm)).toBeLessThan(1e-9);
      expect(Math.abs(got.confidence - want.confidence)).toBeLessThan(1e-9);
    }
  });

  it('matches the reference for 90 and 174 BPM clicks', () => {
    for (const bpm of [90, 174]) {
      const values = clicks(bpm);
      const got = some(run(values));
      const want = some(reference(values, HOP_RATE));
      expect(Math.abs(got.bpm - want.bpm)).toBeLessThan(1e-9);
      expect(Math.abs(got.confidence - want.confidence)).toBeLessThan(1e-9);
    }
  });
});

describe('BpmDetector short window', () => {
  it('refines the period by its centroid when no multiple fits, matching the reference', () => {
    // a 2 s window leaves room for the period only, so the centroid alone sets the answer
    for (const bpm of [100, 120, 140, 174]) {
      const values = clicks(bpm, 4);
      const got = some(run(values, HOP_RATE, { windowSeconds: 2 }));
      const want = some(reference(values, HOP_RATE, { windowSeconds: 2 }));
      expect(Math.abs(got.bpm - want.bpm)).toBeLessThan(1e-9);
      expect(Math.abs(got.confidence - want.confidence)).toBeLessThan(1e-9);
      expect(Math.abs(got.bpm - bpm)).toBeLessThan(2);
    }
    // 120 BPM is 46.875 values per beat: an integer lag could only say 119.68 or 121.28
    const e = some(run(clicks(120, 4), HOP_RATE, { windowSeconds: 2 }));
    expect(Math.abs(e.bpm - 119.68)).toBeGreaterThan(0.05);
  });
});

describe('BpmDetector accuracy', () => {
  /** 800 values with a hit of `strong` every 80 values and a hit of `weak` halfway between. */
  function pattern(strong: number, weak: number): number[] {
    const out = new Array<number>(800).fill(0);
    for (let i = 0; i < out.length; i += 80) {
      out[i] = strong;
      if (i + 40 < out.length) out[i + 40] = weak;
    }
    return out;
  }

  it('takes the shorter period only when it is nearly as strong as the strongest', () => {
    // period 80 values is 70.3 BPM, period 40 is 140.6 BPM
    const faint = run(pattern(1, 0.4));
    const clear = run(pattern(1, 0.7));
    expect(faint).not.toBeNull();
    expect(clear).not.toBeNull();
    // a faint off-beat (autocorrelation about 0.7 of the strongest) does not halve the period
    expect(Math.abs(faint!.bpm - 70.3125)).toBeLessThan(0.2);
    // a clear one (about 0.94 of the strongest) does
    expect(Math.abs(clear!.bpm - 140.625)).toBeLessThan(0.2);
    const refFaint = reference(pattern(1, 0.4), HOP_RATE);
    expect(Math.abs(faint!.bpm - refFaint!.bpm)).toBeLessThan(1e-9);
  });

  it('still reads a very quiet rhythm', () => {
    const quiet = clicks(128).map((v) => v * 0.01);
    const e = run(quiet);
    expect(e).not.toBeNull();
    expect(Math.abs(e!.bpm - 128)).toBeLessThan(0.3);
  });

  it('gives null for a single hit, which has no period', () => {
    const one = new Array<number>(750).fill(0);
    one[400] = 1;
    expect(run(one)).toBeNull();
  });

  it('reads click tracks within 0.3 BPM with high confidence', () => {
    for (const bpm of [75, 90, 100, 120, 128, 140, 150, 160, 174]) {
      const e = some(run(clicks(bpm)));
      expect(Math.abs(e.bpm - bpm)).toBeLessThan(0.3);
      expect(e.confidence).toBeGreaterThan(0.7);
    }
  });

  it('folds slow clicks up and fast clicks down', () => {
    expect(Math.abs(some(run(clicks(60))).bpm - 120)).toBeLessThan(0.3);
    expect(Math.abs(some(run(clicks(200))).bpm - 100)).toBeLessThan(0.3);
  });

  it('gives low confidence for noise alone', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const e = some(run(onsets(noise(Math.round(8.5 * SR), seed, 0.25))));
      expect(e.confidence).toBeLessThan(0.3);
    }
  });

  it('finds clicks in noise', () => {
    for (const seed of [5, 6, 7]) {
      const loud = some(run(noisyClicks(128, 8.5, seed, 0.25)));
      expect(Math.abs(loud.bpm - 128)).toBeLessThan(1.5);
      const quiet = some(run(noisyClicks(128, 8.5, seed, 0.1)));
      expect(Math.abs(quiet.bpm - 128)).toBeLessThan(0.3);
      expect(quiet.confidence).toBeGreaterThan(0.8);
    }
  });

  it('needs half a window of history', () => {
    const values = clicks(120);
    const det = new BpmDetector(HOP_RATE);
    for (let i = 0; i < 374; i++) det.push(values[i]);
    expect(det.estimate()).toBeNull();
    det.push(values[374]);
    const e = some(read(det));
    expect(Math.abs(e.bpm - 120)).toBeLessThan(0.5);
  });

  it('gives null for silence and for a constant input', () => {
    expect(run(new Array<number>(750).fill(0))).toBeNull();
    expect(run(new Array<number>(750).fill(0.3))).toBeNull();
  });

  it('follows a tempo change', () => {
    const x = new Float32Array(Math.round(14.5 * SR));
    x.set(clickTrack(100, 6, SR));
    x.set(clickTrack(140, 8.5, SR), Math.round(6 * SR));
    const e = some(run(onsets(x)));
    expect(Math.abs(e.bpm - 140)).toBeLessThan(0.3);
  });

  it('works at 44.1 kHz', () => {
    for (const bpm of [90, 128, 174]) {
      const e = some(run(clicks(bpm, 8.5, 44100), 44100 / 512));
      expect(Math.abs(e.bpm - bpm)).toBeLessThan(0.3);
    }
  });
});

describe('BpmDetector options', () => {
  it('honours a custom tempo range', () => {
    const e = some(run(clicks(128), HOP_RATE, { minBpm: 60, maxBpm: 120 }));
    expect(Math.abs(e.bpm - 64)).toBeLessThan(0.3);
  });

  it('honours a custom window', () => {
    const values = clicks(120);
    const det = new BpmDetector(HOP_RATE, { windowSeconds: 4 });
    for (let i = 0; i < 187; i++) det.push(values[i]);
    expect(det.estimate()).toBeNull();
    det.push(values[187]);
    expect(det.estimate()).not.toBeNull();
    const e = some(run(values, HOP_RATE, { windowSeconds: 4 }));
    expect(Math.abs(e.bpm - 120)).toBeLessThan(0.5);
  });

  it('falls back to the default range for unusable bounds', () => {
    const values = clicks(60);
    const want = some(reference(values, HOP_RATE));
    expect(Math.abs(want.bpm - 120)).toBeLessThan(0.3);
    const bad: Opts[] = [
      { minBpm: 100, maxBpm: 150 },
      { minBpm: NaN, maxBpm: 120 },
      { minBpm: 60 },
      { maxBpm: -5, minBpm: 60 },
    ];
    for (const o of bad) {
      const got = some(run(values, HOP_RATE, o));
      expect(got.bpm).toBeCloseTo(want.bpm, 9);
      expect(got.confidence).toBeCloseTo(want.confidence, 9);
    }
    // sanity: the same clicks do read differently with a valid 60..120 range
    expect(Math.abs(some(run(values, HOP_RATE, { minBpm: 60, maxBpm: 120 })).bpm - 60)).toBeLessThan(0.3);
  });

  it('sanitises and clamps the window', () => {
    const values = clicks(120, 20);
    const need = (w: number): number => Math.ceil(Math.round(w * HOP_RATE) / 2);
    expect(need(8)).toBe(375);
    expect(need(2)).toBe(94);
    expect(need(30)).toBe(1407);
    for (const w of [NaN, 0, -1]) expect(firstAfterPushes(values, { windowSeconds: w }, 375)).toBe(true);
    expect(firstAfterPushes(values, { windowSeconds: 1 }, 94)).toBe(true);
    expect(firstAfterPushes(values, { windowSeconds: 100 }, 1407)).toBe(true);
  });
});

/** True when the estimate is null after n-1 pushes and not null after n. */
function firstAfterPushes(values: number[], o: Opts, n: number): boolean {
  const det = new BpmDetector(HOP_RATE, o);
  for (let i = 0; i < n - 1; i++) det.push(values[i]);
  if (det.estimate() !== null) return false;
  det.push(values[n - 1]);
  return det.estimate() !== null;
}

describe('BpmDetector input handling', () => {
  it('counts non-finite and negative values as 0', () => {
    const values = noisyClicks(128, 8.5, 5, 0.1).slice(0, 750);
    const bad = [NaN, Infinity, -Infinity, -1];
    const dirty = values.slice();
    const clean = values.slice();
    for (let k = 0; k < 40; k++) {
      const i = 20 + k * 17;
      dirty[i] = bad[k % 4];
      clean[i] = 0;
    }
    const a = some(run(dirty));
    const b = some(run(clean));
    expect(a.bpm).toBe(b.bpm);
    expect(a.confidence).toBe(b.confidence);
    // the substitution matters: leaving the original values gives another answer
    expect(some(run(values)).confidence).not.toBe(b.confidence);
  });

  it('reuses the result object', () => {
    const det = new BpmDetector(HOP_RATE);
    feed(det, clicks(128).slice(-750));
    const first = det.estimate();
    expect(first).not.toBeNull();
    const copy = { bpm: (first as { bpm: number }).bpm, confidence: (first as { confidence: number }).confidence };
    feed(det, clicks(90).slice(-750));
    const second = det.estimate();
    expect(second).toBe(first);
    expect(second?.bpm).not.toBe(copy.bpm);
    const fresh = some(run(clicks(90).slice(-750)));
    expect(second?.bpm).toBe(fresh.bpm);
    expect(second?.confidence).toBe(fresh.confidence);
  });
});

describe('BpmDetector reset', () => {
  it('forgets everything', () => {
    const det = new BpmDetector(HOP_RATE);
    feed(det, clicks(128));
    expect(det.estimate()).not.toBeNull();
    det.reset();
    expect(det.estimate()).toBeNull();
    feed(det, clicks(120).slice(0, 300));
    expect(det.estimate()).toBeNull();
    det.reset();
    const values = clicks(90);
    feed(det, values);
    const got = some(read(det));
    const want = some(run(values));
    expect(got.bpm).toBe(want.bpm);
    expect(got.confidence).toBe(want.confidence);
  });
});
