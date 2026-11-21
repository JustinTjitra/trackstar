import { describe, it, expect } from 'vitest';
import { Crusher } from '../../src/fx/dsp/crusher';
import { sine, noise, rms } from '../fixtures/synthAudio';

const SR = 48000;

/** Evenly spaced values from `from` to `to`, inclusive, as exact doubles. */
function ramp(n: number, from = -1, to = 1): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = from + ((to - from) * i) / (n - 1);
  return out;
}

/** Feeds every input sample through the crusher and collects the outputs. */
function run(c: Crusher, input: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) out.push(c.process(input[i]));
  return out;
}

/** Reference bit-depth quantiser, written out independently of the implementation. */
function quantise(v: number, bits: number): number {
  const step = 2 / 2 ** bits;
  return Math.round(v / step) * step + 0;
}

/** Largest absolute difference between two equal-length sequences. */
function maxError(out: ArrayLike<number>, input: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const e = Math.abs(out[i] - input[i]);
    if (e > max) max = e;
  }
  return max;
}

/** Root mean square of (out - input). */
function errorRms(out: ArrayLike<number>, input: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < out.length; i++) {
    const e = out[i] - input[i];
    sum += e * e;
  }
  return Math.sqrt(sum / out.length);
}

/** Distinct values in ascending order. */
function distinctSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

describe('Crusher', () => {
  it('is near-transparent by default but still quantises', () => {
    const input = sine(440, 0.1, SR);
    const out = run(new Crusher(), input);
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(out[i] - input[i])).toBeLessThan(1e-4);
    }
    expect(maxError(out, input)).toBeGreaterThan(0);
  });

  it('at 4 bits gives 17 levels that are multiples of 0.125 with error at most half a step', () => {
    const input = ramp(10001);
    const c = new Crusher();
    c.setBits(4);
    const out = run(c, input);
    expect(distinctSorted(out)).toHaveLength(17);
    for (const v of out) {
      expect(Math.abs(v / 0.125 - Math.round(v / 0.125))).toBeLessThan(1e-12);
    }
    expect(maxError(out, input)).toBeLessThanOrEqual(0.0625 + 1e-12);
  });

  it('at 1 bit outputs only -1, 0 and 1 on the ramp', () => {
    const c = new Crusher();
    c.setBits(1);
    const out = run(c, ramp(10001));
    expect(distinctSorted(out)).toEqual([-1, 0, 1]);
  });

  it('at 8 bits keeps error within half a step and shows real error', () => {
    const input = ramp(10001);
    const c = new Crusher();
    c.setBits(8);
    const out = run(c, input);
    const err = maxError(out, input);
    expect(err).toBeLessThanOrEqual(1 / 256 + 1e-12);
    expect(err).toBeGreaterThan(1 / 1024);
  });

  it('accepts fractional bit depths between the integer neighbours', () => {
    const c = new Crusher();
    c.setBits(4.5);
    const distinct = distinctSorted(run(c, ramp(10001))).length;
    expect(distinct).toBeGreaterThan(17);
    expect(distinct).toBeLessThan(33);
  });

  it('fewer bits give more RMS error on a sine', () => {
    const input = sine(440, 0.1, SR);
    const errs = [12, 8, 6, 4, 2].map((bits) => {
      const c = new Crusher();
      c.setBits(bits);
      return errorRms(run(c, input), input);
    });
    for (let i = 1; i < errs.length; i++) {
      expect(errs[i]).toBeGreaterThan(errs[i - 1]);
    }
  });

  it('factor 4 holds each captured value for exactly 4 samples', () => {
    const input = ramp(200, -0.9, 0.9);
    const c = new Crusher();
    c.setDownsample(4);
    const out = run(c, input);
    for (let n = 0; n < 64; n++) {
      expect(out[n]).toBe(quantise(input[Math.floor(n / 4) * 4], 16));
    }
  });

  it('factor 1 captures every sample', () => {
    const input = ramp(50, -0.9, 0.9);
    const c = new Crusher();
    c.setDownsample(1);
    const out = run(c, input);
    for (let n = 1; n < out.length; n++) {
      expect(out[n]).not.toBe(out[n - 1]);
    }
  });

  it('fractional factor 2.5 alternates hold lengths of 3 and 2 that average 2.5', () => {
    const input = ramp(1000, -1, 1);
    const c = new Crusher();
    c.setDownsample(2.5);
    const out = run(c, input);

    // split the output into runs of equal consecutive values
    const runs: number[] = [];
    let len = 1;
    for (let i = 1; i < out.length; i++) {
      if (out[i] === out[i - 1]) {
        len++;
      } else {
        runs.push(len);
        len = 1;
      }
    }
    runs.push(len);

    for (const r of runs) {
      expect(r === 2 || r === 3).toBe(true);
    }
    expect(Math.abs(out.length / runs.length - 2.5) / 2.5).toBeLessThan(0.02);
  });

  it('captures the very first sample whatever the factor', () => {
    const c = new Crusher();
    c.setDownsample(8);
    expect(c.process(0.5)).toBeCloseTo(0.5, 4);
  });

  it('clamps out-of-range settings to the nearest limit', () => {
    const input = sine(440, 0.05, SR, 0.9);
    const same = (set: (c: Crusher) => void, ref: (c: Crusher) => void): void => {
      const a = new Crusher();
      const b = new Crusher();
      set(a);
      ref(b);
      expect(run(a, input)).toEqual(run(b, input));
    };
    same((c) => c.setBits(40), (c) => c.setBits(16));
    same((c) => c.setBits(-3), (c) => c.setBits(1));
    same((c) => c.setBits(0), (c) => c.setBits(1));
    same((c) => c.setDownsample(0.2), (c) => c.setDownsample(1));
    same((c) => c.setDownsample(1000), (c) => c.setDownsample(64));
  });

  it('ignores non-finite settings and keeps the previous ones', () => {
    const input = sine(440, 0.05, SR, 0.9);

    const bitsRef = new Crusher();
    bitsRef.setBits(4);
    const bits = new Crusher();
    bits.setBits(4);
    bits.setBits(NaN);
    bits.setBits(Infinity);
    expect(run(bits, input)).toEqual(run(bitsRef, input));

    const downRef = new Crusher();
    downRef.setDownsample(4);
    const down = new Crusher();
    down.setDownsample(4);
    down.setDownsample(NaN);
    down.setDownsample(-Infinity);
    expect(run(down, input)).toEqual(run(downRef, input));
  });

  it('treats non-finite input samples as 0', () => {
    const fresh = new Crusher();
    expect(fresh.process(NaN)).toBe(0);
    const fresh2 = new Crusher();
    expect(fresh2.process(Infinity)).toBe(0);

    const input = sine(440, 0.01, SR, 0.5);
    input[50] = NaN;
    input[60] = Infinity;
    const out = run(new Crusher(), input);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('reset captures the next sample immediately and keeps the settings', () => {
    const c = new Crusher();
    c.setDownsample(8);
    run(c, ramp(20, -0.5, 0.5));
    c.reset();

    const input = new Float64Array(40);
    for (let j = 0; j < input.length; j++) input[j] = 0.25 + j * 0.01;
    const out = run(c, input);
    expect(out[0]).toBeCloseTo(0.25, 4);
    for (let j = 0; j < out.length; j++) {
      expect(out[j]).toBeCloseTo(0.25 + Math.floor(j / 8) * 0.08, 4);
    }
  });

  it('does not clip values beyond -1..1', () => {
    const c = new Crusher();
    c.setBits(4);
    expect(c.process(1.5)).toBeCloseTo(1.5, 10);
    expect(c.process(-2.3)).toBeCloseTo(-2.25, 10);
  });

  it('never returns negative zero', () => {
    const c = new Crusher();
    c.setBits(4);
    expect(Object.is(c.process(-0.01), 0)).toBe(true);
  });

  it('keeps the noise input finite and bounded by its quantiser', () => {
    // guards against a regression in the quantiser on non-sine material
    const input = noise(4096, 7, 1);
    const c = new Crusher();
    c.setBits(6);
    const out = run(c, input);
    expect(rms(Float32Array.from(out))).toBeGreaterThan(0.1);
    expect(maxError(out, input)).toBeLessThanOrEqual(1 / 64 + 1e-12);
  });
});
