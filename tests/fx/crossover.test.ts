import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { ThreeBand } from '../../src/fx/dsp/crossover';
import { allFinite, noise, peak, rms, sine, toDb } from '../fixtures/synthAudio';

const RATES = [44100, 48000];
const Q = Math.SQRT1_2;
const LR_DB = -6.02;

type Out = 'low' | 'mid' | 'high' | 'sum';

/** Level in dB of one output (or the sum of all three) for a 1 s sine, relative to the input, over the second half. */
function gainDb(c: ThreeBand, out: Out, freq: number, sampleRate: number): number {
  c.reset();
  const input = sine(freq, 1, sampleRate);
  const result = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    c.process(input[i]);
    result[i] = out === 'sum' ? c.low + c.mid + c.high : c[out];
  }
  const half = input.length >> 1;
  return toDb(rms(result, half, input.length) / rms(input, half, input.length));
}

/** Runs `input` and returns the three outputs in double precision. */
function runAll(c: ThreeBand, input: ArrayLike<number>): { low: number[]; mid: number[]; high: number[] } {
  const low: number[] = [];
  const mid: number[] = [];
  const high: number[] = [];
  for (let i = 0; i < input.length; i++) {
    c.process(input[i]);
    low.push(c.low);
    mid.push(c.mid);
    high.push(c.high);
  }
  return { low, mid, high };
}

describe.each(RATES)('ThreeBand levels at %i Hz', (sr) => {
  it.each([50, 300, 1000, 3000, 10000])('sum is flat at %i Hz', (freq) => {
    const c = new ThreeBand(sr);
    expect(Math.abs(gainDb(c, 'sum', freq, sr))).toBeLessThan(0.1);
  });

  it('separates the bands at 100 Hz', () => {
    const c = new ThreeBand(sr);
    expect(Math.abs(gainDb(c, 'low', 100, sr))).toBeLessThan(1);
    expect(gainDb(c, 'high', 100, sr)).toBeLessThan(-40);
  });

  it('separates the bands at 10000 Hz', () => {
    const c = new ThreeBand(sr);
    expect(Math.abs(gainDb(c, 'high', 10000, sr))).toBeLessThan(1);
    expect(gainDb(c, 'low', 10000, sr)).toBeLessThan(-40);
  });

  it('separates the bands at 1000 Hz', () => {
    const c = new ThreeBand(sr);
    expect(Math.abs(gainDb(c, 'mid', 1000, sr))).toBeLessThan(1);
    expect(gainDb(c, 'low', 1000, sr)).toBeLessThan(-35);
    expect(gainDb(c, 'high', 1000, sr)).toBeLessThan(-35);
  });

  it('is 6.02 dB down in both neighbouring bands at the crossover points', () => {
    const c = new ThreeBand(sr);
    expect(Math.abs(gainDb(c, 'low', 300, sr) - LR_DB)).toBeLessThan(0.3);
    expect(Math.abs(gainDb(c, 'mid', 300, sr) - LR_DB)).toBeLessThan(0.3);
    expect(Math.abs(gainDb(c, 'mid', 3000, sr) - LR_DB)).toBeLessThan(0.3);
    expect(Math.abs(gainDb(c, 'high', 3000, sr) - LR_DB)).toBeLessThan(0.3);
  });

  it('supports custom crossover frequencies', () => {
    const c = new ThreeBand(sr, 200, 5000);
    expect(Math.abs(gainDb(c, 'low', 200, sr) - LR_DB)).toBeLessThan(0.3);
    expect(Math.abs(gainDb(c, 'high', 5000, sr) - LR_DB)).toBeLessThan(0.3);
    for (const f of [200, 1000, 5000]) {
      expect(Math.abs(gainDb(c, 'sum', f, sr))).toBeLessThan(0.1);
    }
  });
});

describe.each(RATES)('ThreeBand structure at %i Hz', (sr) => {
  it('low + mid + high equals two all-passes in series', () => {
    const c = new ThreeBand(sr);
    const ap1 = new Biquad();
    const ap2 = new Biquad();
    ap1.setAllpass(300, Q, sr);
    ap2.setAllpass(3000, Q, sr);
    const input = noise(2048, 7);
    let worst = 0;
    let energy = 0;
    for (let i = 0; i < input.length; i++) {
      c.process(input[i]);
      const want = ap2.process(ap1.process(input[i]));
      worst = Math.max(worst, Math.abs(c.low + c.mid + c.high - want));
      energy += want * want;
    }
    expect(energy).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('ThreeBand state', () => {
  const sr = 48000;

  it('starts with all outputs at 0', () => {
    const c = new ThreeBand(sr);
    expect([c.low, c.mid, c.high]).toEqual([0, 0, 0]);
  });

  it('reset clears memory and outputs', () => {
    const c = new ThreeBand(sr);
    runAll(c, noise(500, 5));
    expect(c.low !== 0 || c.mid !== 0 || c.high !== 0).toBe(true);
    c.reset();
    expect([c.low, c.mid, c.high]).toEqual([0, 0, 0]);
    const tail = runAll(c, new Float32Array(200));
    expect([...tail.low, ...tail.mid, ...tail.high].every((v) => v === 0)).toBe(true);
  });

  it('behaves like a fresh crossover after reset', () => {
    const input = noise(1000, 6);
    const used = new ThreeBand(sr);
    runAll(used, noise(700, 8));
    used.reset();
    const got = runAll(used, input);
    const want = runAll(new ThreeBand(sr), input);
    expect(got).toEqual(want);
    expect(want.low.some((v) => v !== 0)).toBe(true);
    expect(want.mid.some((v) => v !== 0)).toBe(true);
    expect(want.high.some((v) => v !== 0)).toBe(true);
  });
});

describe('ThreeBand robustness', () => {
  it('non-finite input behaves exactly like 0', () => {
    const input = Array.from(noise(300, 2));
    input[10] = NaN;
    input[50] = Infinity;
    input[51] = -Infinity;
    input[200] = NaN;
    const got = runAll(new ThreeBand(48000), input);
    const cleaned = input.map((v) => (Number.isFinite(v) ? v : 0));
    const want = runAll(new ThreeBand(48000), cleaned);
    expect(got).toEqual(want);
    expect([...got.low, ...got.mid, ...got.high].every(Number.isFinite)).toBe(true);
  });

  it.each(RATES)('stays finite on 5 s of full-scale noise at %i Hz', (sr) => {
    const input = noise(5 * sr, 11);
    const c = new ThreeBand(sr);
    const low = new Float32Array(input.length);
    const mid = new Float32Array(input.length);
    const high = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      c.process(input[i]);
      low[i] = c.low;
      mid[i] = c.mid;
      high[i] = c.high;
    }
    expect(allFinite(low) && allFinite(mid) && allFinite(high)).toBe(true);
    expect(peak(low)).toBeLessThan(4);
    expect(peak(mid)).toBeLessThan(4);
    expect(peak(high)).toBeLessThan(4);
  });
});

describe('ThreeBand constructor', () => {
  it.each([
    ['lowHz equal to highHz', 48000, 1000, 1000],
    ['lowHz above highHz', 48000, 3000, 300],
    ['lowHz zero', 48000, 0, 3000],
    ['lowHz negative', 48000, -10, 3000],
    ['lowHz NaN', 48000, NaN, 3000],
    ['highHz NaN', 48000, 300, NaN],
    ['highHz Infinity', 48000, 300, Infinity],
    ['lowHz Infinity', 48000, Infinity, Infinity],
    ['sample rate zero', 0, 300, 3000],
    ['sample rate negative', -48000, 300, 3000],
    ['sample rate NaN', NaN, 300, 3000],
    ['sample rate Infinity', Infinity, 300, 3000],
  ])('throws RangeError for %s', (_name, sr, lo, hi) => {
    expect(() => new ThreeBand(sr, lo, hi)).toThrow(RangeError);
  });

  it('accepts valid settings', () => {
    expect(() => new ThreeBand(48000)).not.toThrow();
    expect(() => new ThreeBand(44100, 100, 8000)).not.toThrow();
  });
});
