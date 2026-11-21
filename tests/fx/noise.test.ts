import { describe, expect, it } from 'vitest';
import { NoiseSource } from '../../src/fx/dsp/noise';
import { Biquad } from '../../src/fx/dsp/biquad';
import { allFinite, peak, rms, toDb } from '../fixtures/synthAudio';

const SR = 48000;
const N = 480000; // 10 seconds at 48 kHz

/** Fills a Float32Array by calling `fn` n times. */
function collect(fn: () => number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn();
  return out;
}

/** Level in dB of `signal` through a band-pass at `centreHz`, skipping the first 4800 samples. */
function bandLevelDb(signal: Float32Array, centreHz: number): number {
  const bp = new Biquad();
  bp.setBandpass(centreHz, 1.414, SR);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = bp.process(signal[i]);
  return toDb(rms(out, 4800));
}

/** Fraction of the signal's RMS that remains below 200 Hz (low-pass, Q 0.7071). */
function lowFraction(signal: Float32Array): number {
  const lp = new Biquad();
  lp.setLowpass(200, 0.7071, SR);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = lp.process(signal[i]);
  return rms(out) / rms(signal);
}

function mean(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  return sum / x.length;
}

function lag1Autocorrelation(x: Float32Array): number {
  let cross = 0;
  let energy = 0;
  for (let i = 1; i < x.length; i++) {
    cross += x[i] * x[i - 1];
    energy += x[i] * x[i];
  }
  return cross / energy;
}

describe('NoiseSource determinism and seeding', () => {
  it('two instances with the same seed give identical white sequences', () => {
    const a = new NoiseSource(42);
    const b = new NoiseSource(42);
    for (let i = 0; i < 1000; i++) expect(a.white()).toBe(b.white());
  });

  it('two instances with the same seed give identical pink sequences', () => {
    const a = new NoiseSource(42);
    const b = new NoiseSource(42);
    for (let i = 0; i < 1000; i++) expect(a.pink()).toBe(b.pink());
  });

  it('different seeds give different sequences', () => {
    const a = new NoiseSource(1);
    const b = new NoiseSource(2);
    const xa = collect(() => a.white(), 100);
    const xb = collect(() => b.white(), 100);
    const allEqual = xa.every((v) => v === xa[0]);
    expect(allEqual).toBe(false);
    expect(xa).not.toEqual(xb);
  });

  it('the default seed is 1', () => {
    const a = new NoiseSource();
    const b = new NoiseSource(1);
    for (let i = 0; i < 1000; i++) expect(a.white()).toBe(b.white());
  });

  it('reseed restarts the white sequence exactly', () => {
    const a = new NoiseSource(7);
    for (let i = 0; i < 500; i++) a.white();
    a.reseed(42);
    const fresh = new NoiseSource(42);
    for (let i = 0; i < 1000; i++) expect(a.white()).toBe(fresh.white());
  });

  it('reseed clears the pink filter memory so the pink sequence restarts exactly', () => {
    const a = new NoiseSource(7);
    for (let i = 0; i < 1000; i++) a.pink();
    a.reseed(42);
    const fresh = new NoiseSource(42);
    for (let i = 0; i < 1000; i++) expect(a.pink()).toBe(fresh.pink());
  });

  it('seeds 0, large, negative and fractional values give finite output', () => {
    for (const seed of [0, 4294967295, -7, 3.9]) {
      const src = new NoiseSource(seed);
      for (let i = 0; i < 1000; i++) {
        expect(Number.isFinite(src.white())).toBe(true);
        expect(Number.isFinite(src.pink())).toBe(true);
      }
    }
  });

  it('a fractional seed is truncated like >>> 0 (3.9 behaves as 3)', () => {
    const a = new NoiseSource(3.9);
    const b = new NoiseSource(3);
    for (let i = 0; i < 1000; i++) expect(a.white()).toBe(b.white());
    const c = new NoiseSource(3.9);
    const d = new NoiseSource(3);
    for (let i = 0; i < 1000; i++) expect(c.pink()).toBe(d.pink());
  });
});

describe('white noise', () => {
  // Raw return values, not Float32 samples: float32 rounding can turn a value just below 1 into 1.
  it('every sample is in [-1, 1)', () => {
    const src = new NoiseSource(1);
    for (let i = 0; i < N; i++) {
      const v = src.white();
      if (!(v >= -1 && v < 1)) throw new Error(`sample ${i} out of range: ${v}`);
    }
  });

  it('has mean near 0 and RMS near 1/sqrt(3)', () => {
    const src = new NoiseSource(1);
    const s = collect(() => src.white(), N);
    expect(Math.abs(mean(s))).toBeLessThan(0.01);
    expect(Math.abs(rms(s) - 1 / Math.sqrt(3)) / (1 / Math.sqrt(3))).toBeLessThan(0.02);
  });

  it('is uncorrelated from sample to sample', () => {
    const src = new NoiseSource(1);
    const s = collect(() => src.white(), N);
    expect(Math.abs(lag1Autocorrelation(s))).toBeLessThan(0.01);
  });

  it('rises 3 dB per octave in octave-wide bands', () => {
    const src = new NoiseSource(1);
    const s = collect(() => src.white(), N);
    const levels = [500, 1000, 2000, 4000].map((f) => bandLevelDb(s, f));
    for (let i = 0; i < levels.length - 1; i++) {
      const step = levels[i + 1] - levels[i];
      expect(step).toBeGreaterThanOrEqual(2);
      expect(step).toBeLessThanOrEqual(4);
    }
  });
});

describe('pink noise', () => {
  // The range starts at 62.5 Hz because the slowest of the three filter stages shapes the
  // bass: without it the 62.5 Hz band drops about 5 dB while 250 Hz and up barely move.
  it('is flat per octave across 62.5 Hz to 8 kHz', () => {
    const src = new NoiseSource(1);
    const s = collect(() => src.pink(), N);
    const levels = [62.5, 125, 250, 500, 1000, 2000, 4000, 8000].map((f) => bandLevelDb(s, f));
    const spread = Math.max(...levels) - Math.min(...levels);
    expect(spread).toBeLessThan(2);
  });

  it('has far more low-frequency energy than white noise', () => {
    const w = new NoiseSource(1);
    const p = new NoiseSource(1);
    const white = collect(() => w.white(), N);
    const pink = collect(() => p.pink(), N);
    expect(lowFraction(pink)).toBeGreaterThanOrEqual(3 * lowFraction(white));
  });

  it('has a sensible level: RMS 0.15 to 0.40, mean near 0, peak below 1.5, all finite', () => {
    const src = new NoiseSource(1);
    const s = collect(() => src.pink(), N);
    expect(allFinite(s)).toBe(true);
    const r = rms(s);
    expect(r).toBeGreaterThanOrEqual(0.15);
    expect(r).toBeLessThanOrEqual(0.4);
    expect(Math.abs(mean(s))).toBeLessThan(0.05);
    expect(peak(s)).toBeLessThan(1.5);
  });
});
