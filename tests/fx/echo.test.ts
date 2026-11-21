import { describe, expect, it } from 'vitest';
import { expLerp } from '../../src/fx/dsp/math';
import { Svf } from '../../src/fx/dsp/svf';
import { FilterEcho } from '../../src/fx/effects/echo';
import type { EchoFilter } from '../../src/fx/effects/echo';
import { allFinite, impulse, noise, peak, rms, runBlocks, silence, sine } from '../fixtures/synthAudio';

const SR = 48000;
const FILTERS: EchoFilter[] = ['none', 'bpf', 'hpf', 'lpf'];

/** Processes `seconds` of silence on both channels. */
function settle(echo: FilterEcho, seconds: number): void {
  const n = Math.round(seconds * SR);
  echo.process(silence(n), silence(n), n);
}

/** Processes whole buffers in place. */
function run(echo: FilterEcho, l: Float32Array, r: Float32Array): void {
  echo.process(l, r, l.length);
}

function expectEqual(a: Float32Array, b: Float32Array): void {
  expect(a.length).toBe(b.length);
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diff = i;
      break;
    }
  }
  expect(diff).toBe(-1);
}

/** Indices of all non-zero samples. */
function nonZero(x: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== 0) out.push(i);
  return out;
}

/**
 * Index of the first non-zero sample after `after`, or -1. Exact on purpose: once a glide of
 * the delay length has ended, the delay is a whole number of samples and nothing leaks into
 * the neighbouring sample.
 */
function firstAfter(x: Float32Array, after: number): number {
  for (let i = after + 1; i < x.length; i++) if (x[i] !== 0) return i;
  return -1;
}

/**
 * Echo with the amount settled, then a left impulse at 1000 in a buffer of 60000 samples.
 * A glide of the delay length takes about 1 s to land exactly on its target, so the settling time is 2 s.
 */
function impulseResponse(echo: FilterEcho, amount = 0.5): { l: Float32Array; r: Float32Array } {
  echo.setAmount(amount);
  settle(echo, 2);
  const l = impulse(60000, 1000);
  const r = silence(60000);
  run(echo, l, r);
  return { l, r };
}

/** 10 s of amplitude 1 noise at amount 1 (set before processing). */
function longNoise(filter: EchoFilter): { inL: Float32Array; l: Float32Array; r: Float32Array } {
  const echo = new FilterEcho(SR, { filter });
  echo.setAmount(1);
  const inL = noise(10 * SR, 3);
  const l = inL.slice();
  const r = noise(10 * SR, 4);
  run(echo, l, r);
  return { inL, l, r };
}

describe('FilterEcho identity', () => {
  it('leaves noise on both channels bit-identical at amount 0', () => {
    for (const filter of FILTERS) {
      const echo = new FilterEcho(SR, { filter });
      const inL = noise(5000, 1);
      const inR = noise(5000, 2);
      const l = inL.slice();
      const r = inR.slice();
      run(echo, l, r);
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
  });

  it('returns to bit-identical output after the amount goes back to 0', () => {
    for (const filter of FILTERS) {
      const echo = new FilterEcho(SR, { filter });
      echo.setAmount(0.8);
      run(echo, noise(SR, 1), noise(SR, 2));
      echo.setAmount(0);
      run(echo, noise(SR, 3), noise(SR, 4));
      const inL = noise(5000, 5);
      const inR = noise(5000, 6);
      const l = inL.slice();
      const r = inR.slice();
      run(echo, l, r);
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
  });
});

describe('FilterEcho timing and levels', () => {
  it('puts echoes at 18000 sample spacing with levels a, a*fb, a*fb^2 and nothing else', () => {
    const { l, r } = impulseResponse(new FilterEcho(SR, { filter: 'none' }));
    expect(nonZero(l)).toEqual([1000, 19000, 37000, 55000]);
    expect(l[1000]).toBeCloseTo(1, 6);
    expect(l[19000]).toBeCloseTo(0.5, 6);
    expect(l[37000]).toBeCloseTo(0.2125, 6);
    expect(l[55000]).toBeCloseTo(0.0903125, 6);
    expect(nonZero(r)).toEqual([]);
  });

  it('keeps an impulse on the right channel on the right channel', () => {
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setAmount(0.5);
    settle(echo, 2);
    const l = silence(60000);
    const r = impulse(60000, 1000);
    run(echo, l, r);
    expect(nonZero(r)).toEqual([1000, 19000, 37000, 55000]);
    expect(r[19000]).toBeCloseTo(0.5, 6);
    expect(r[37000]).toBeCloseTo(0.2125, 6);
    expect(nonZero(l)).toEqual([]);
  });

  it('follows the beats setting', () => {
    const cases: Array<[number, number]> = [
      [0.5, 12000],
      [0.25, 6000],
      [1, 24000],
    ];
    for (const [beats, samples] of cases) {
      const echo = new FilterEcho(SR, { filter: 'none' });
      echo.setBeats(beats);
      const { l } = impulseResponse(echo);
      expect(firstAfter(l, 1000)).toBe(1000 + samples);
      expect(l[1000 + samples]).toBeCloseTo(0.5, 6);
    }
  });

  it('follows the tempo', () => {
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setBpm(100);
    const { l } = impulseResponse(echo);
    expect(firstAfter(l, 1000)).toBe(1000 + 21600);
  });

  it('glides to a new tempo and settles on the exact delay', () => {
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setAmount(0.5);
    settle(echo, 0.5);
    echo.setBpm(150);
    settle(echo, 2);
    const l = impulse(30000, 1000);
    run(echo, l, silence(30000));
    expect(firstAfter(l, 1000)).toBe(1000 + 14400);
  });

  it('changes the delay without a click while the tempo glides', () => {
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setAmount(0.5);
    const input = sine(200, 3, SR, 0.5);
    const l = input.slice();
    const r = silence(l.length);
    echo.process(l, r, 2 * SR);
    // 133 BPM shifts the echo by a non-integer number of sine periods (150 would shift it by whole periods)
    echo.setBpm(133);
    echo.process(l.subarray(2 * SR), r.subarray(2 * SR), SR);
    // starts one sample early so the step into the first changed sample counts
    const after = l.subarray(2 * SR - 1, 2 * SR + 14400);
    let step = 0;
    for (let i = 1; i < after.length; i++) step = Math.max(step, Math.abs(after[i] - after[i - 1]));
    // an instant jump of the delay would step by about the echo amplitude (0.25), 20 times the sine's own step
    expect(step).toBeLessThan(0.1);
  });
});

describe('FilterEcho filters', () => {
  // A pure tone makes this exact. The k-th echo has been through the loop filter k times, so
  // with g the filter's gain at the tone's frequency: echo 1 = a * g and echo 2 = a * fb * g * g,
  // relative to the dry burst. g comes from a separate Svf set to the cutoff the echo should be
  // using, which also pins the cutoff ranges and q values.
  const TONE = 14400; // 0.3 s burst, shorter than the 18000 sample echo spacing

  /** Steady-state gain of one Svf output for a sine at `freq`. */
  function svfGain(kind: 'lp' | 'bp' | 'hp', cutoff: number, q: number, freq: number): number {
    const f = new Svf(SR);
    f.set(cutoff, q);
    const x = sine(freq, 0.5, SR);
    let sumIn = 0;
    let sumOut = 0;
    for (let i = 0; i < x.length; i++) {
      f.process(x[i]);
      if (i >= x.length / 2) {
        sumIn += x[i] * x[i];
        sumOut += f[kind] * f[kind];
      }
    }
    return Math.sqrt(sumOut / sumIn);
  }

  /** Levels of echo 1 and echo 2 of a tone burst, relative to the dry burst (middle 60% of each). */
  function echoLevels(filter: EchoFilter, amount: number, freq: number): [number, number] {
    const echo = new FilterEcho(SR, { filter });
    echo.setAmount(amount);
    settle(echo, 0.5);
    const l = silence(60000);
    l.set(sine(freq, TONE / SR, SR, 0.5));
    run(echo, l, silence(60000));
    const mid = (start: number): number => rms(l, start + TONE * 0.2, start + TONE * 0.8);
    return [mid(18000) / mid(0), mid(36000) / mid(0)];
  }

  const dbApart = (x: number, y: number): number => Math.abs(20 * Math.log10(x / y));

  const cases: Array<[EchoFilter, 'lp' | 'bp' | 'hp', number, number, number, number[]]> = [
    // filter, Svf output, cutoff at amount 0, cutoff at amount 1, q, tone frequencies
    ['lpf', 'lp', 8000, 600, 0.7071, [200, 2191, 8000]],
    ['hpf', 'hp', 200, 2500, 0.7071, [100, 707, 4000]],
    ['bpf', 'bp', 500, 3000, 1.2, [100, 1225, 10000]],
  ];

  for (const [filter, kind, from, to, q, freqs] of cases) {
    it.each(freqs)(`${filter}: echo 1 is filtered once and echo 2 twice (%i Hz tone)`, (freq) => {
      const a = 0.5;
      const fb = 0.85 * a;
      const g = svfGain(kind, expLerp(from, to, a), q, freq);
      const [e1, e2] = echoLevels(filter, a, freq);
      expect(dbApart(e1, a * g)).toBeLessThan(0.3);
      expect(dbApart(e2, a * fb * g * g)).toBeLessThan(0.5);
    });
  }

  it('the plain echo does not colour its repeats', () => {
    for (const freq of [100, 1000, 10000]) {
      const [e1, e2] = echoLevels('none', 0.5, freq);
      expect(dbApart(e1, 0.5)).toBeLessThan(0.05);
      expect(dbApart(e2, 0.5 * 0.425)).toBeLessThan(0.05);
    }
  });

  it('the filter is doing real work: stop bands are far below pass bands', () => {
    expect(echoLevels('lpf', 0.5, 8000)[0]).toBeLessThan(echoLevels('lpf', 0.5, 200)[0] * 0.1);
    expect(echoLevels('hpf', 0.5, 100)[0]).toBeLessThan(echoLevels('hpf', 0.5, 4000)[0] * 0.1);
    expect(echoLevels('bpf', 0.5, 100)[0]).toBeLessThan(echoLevels('bpf', 0.5, 1225)[0] * 0.2);
    expect(echoLevels('bpf', 0.5, 10000)[0]).toBeLessThan(echoLevels('bpf', 0.5, 1225)[0] * 0.2);
  });

  it.each([0.1, 0.3, 0.7, 0.9])('the cutoff follows the amount (lpf at amount %f, 4 kHz tone)', (a) => {
    const g = svfGain('lp', expLerp(8000, 600, a), 0.7071, 4000);
    const [e1] = echoLevels('lpf', a, 4000);
    expect(dbApart(e1, a * g)).toBeLessThan(0.3);
  });
});

describe('FilterEcho level and stability', () => {
  it('keeps the plain echo inside the geometric-series bound with the expected RMS', () => {
    const { inL, l, r } = longNoise('none');
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    const bound = 1 + 1 / (1 - 0.85) + 1e-3;
    expect(peak(l)).toBeLessThanOrEqual(bound);
    expect(peak(r)).toBeLessThanOrEqual(bound);
    const half = 5 * SR;
    const expected = Math.sqrt(1 + 1 / (1 - 0.85 ** 2)) * rms(inL, half, inL.length);
    const got = rms(l, half, l.length);
    expect(Math.abs(got / expected - 1)).toBeLessThan(0.1);
  });

  it('stays stable with each filter in the loop', () => {
    for (const filter of ['bpf', 'hpf', 'lpf'] as const) {
      const { l, r } = longNoise(filter);
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
      expect(peak(l)).toBeLessThan(10);
      expect(peak(r)).toBeLessThan(10);
    }
  });

  it('does not click when the amount jumps', () => {
    const echo = new FilterEcho(SR, { filter: 'none' });
    // 137 BPM makes the echo delay a non-integer number of sine periods, so the echo is out of phase
    echo.setBpm(137);
    const input = sine(200, 1.3, SR, 0.5);
    const out = input.slice();
    const r = silence(out.length);
    echo.process(out, r, SR);
    echo.setAmount(1);
    echo.process(out.subarray(SR), r.subarray(SR), out.length - SR);
    let inStep = 0;
    let outStep = 0;
    for (let i = SR; i < out.length; i++) {
      inStep = Math.max(inStep, Math.abs(input[i] - input[i - 1]));
      outStep = Math.max(outStep, Math.abs(out[i] - out[i - 1]));
    }
    expect(outStep).toBeLessThan(3 * inStep);
  });
});

describe('FilterEcho reset', () => {
  it('silences the tail, keeps the settings and ends the glide', () => {
    for (const filter of ['none', 'lpf'] as const) {
      const echo = new FilterEcho(SR, { filter });
      echo.setAmount(0.8);
      settle(echo, 0.5);
      // Noise on both channels right up to the reset: both delay lines are full and both loop
      // filters are still ringing, so a reset that forgets any one of them leaves sound behind.
      run(echo, noise(SR, 11), noise(SR, 12));
      echo.reset();
      const outL = silence(2 * SR);
      const outR = silence(2 * SR);
      run(echo, outL, outR);
      expect(nonZero(outL)).toEqual([]);
      expect(nonZero(outR)).toEqual([]);
    }
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setAmount(0.8);
    run(echo, impulse(SR / 2, 100), silence(SR / 2));
    echo.reset();
    const l = impulse(30000, 500);
    run(echo, l, silence(30000));
    expect(firstAfter(l, 500)).toBe(500 + 18000);
    expect(l[18500]).toBeCloseTo(0.8, 6);
  });

  // A tempo change normally glides the echo spacing for about a second. `reset` must end that
  // glide at once, or an impulse sent right afterwards would come back smeared and at the
  // wrong time.
  it('ends a pending glide of the echo spacing', () => {
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setAmount(0.5);
    settle(echo, 0.5);
    echo.setBpm(150); // spacing 18000 -> 14400 samples, glide pending
    echo.reset();
    const l = impulse(30000, 500);
    run(echo, l, silence(30000));
    expect(nonZero(l)).toEqual([500, 500 + 14400, 500 + 28800]);
    expect(l[500 + 14400]).toBeCloseTo(0.5, 6);
  });
});

describe('FilterEcho setters', () => {
  /** Runs 2 s of noise through an echo configured by `setup` and returns both channels. */
  function render(setup: (e: FilterEcho) => void): { l: Float32Array; r: Float32Array } {
    const echo = new FilterEcho(SR, { filter: 'lpf' });
    echo.setAmount(0.6);
    setup(echo);
    const l = noise(2 * SR, 1);
    const r = noise(2 * SR, 2);
    run(echo, l, r);
    return { l, r };
  }

  function same(a: (e: FilterEcho) => void, b: (e: FilterEcho) => void): void {
    const x = render(a);
    const y = render(b);
    expectEqual(x.l, y.l);
    expectEqual(x.r, y.r);
  }

  it('clamps the amount and ignores non-finite values', () => {
    same((e) => e.setAmount(5), (e) => e.setAmount(1));
    same((e) => e.setAmount(-1), (e) => e.setAmount(0));
    same((e) => e.setAmount(NaN), (e) => e.setAmount(0.6));
    same((e) => e.setAmount(Infinity), (e) => e.setAmount(0.6));
    same((e) => e.setAmount(-Infinity), (e) => e.setAmount(0.6));
    // the clamped values must differ from each other, so the comparisons above mean something
    const hi = render((e) => e.setAmount(1));
    const lo = render((e) => e.setAmount(0));
    expect(hi.l[SR]).not.toBe(lo.l[SR]);
  });

  it('clamps beats and ignores non-finite values', () => {
    same((e) => e.setBeats(9), (e) => e.setBeats(1));
    same((e) => e.setBeats(0.01), (e) => e.setBeats(0.125));
    same((e) => e.setBeats(NaN), (e) => e.setBeats(0.75));
    same((e) => e.setBeats(Infinity), (e) => e.setBeats(0.75));
    const echo = new FilterEcho(SR, { filter: 'none' });
    echo.setBeats(0.01);
    const { l } = impulseResponse(echo);
    expect(firstAfter(l, 1000)).toBe(1000 + 3000);
  });

  it('clamps the tempo and ignores non-finite values', () => {
    same((e) => e.setBpm(1000), (e) => e.setBpm(240));
    same((e) => e.setBpm(1), (e) => e.setBpm(40));
    same((e) => e.setBpm(NaN), (e) => e.setBpm(120));
    same((e) => e.setBpm(-Infinity), (e) => e.setBpm(120));
    const fast = new FilterEcho(SR, { filter: 'none' });
    fast.setBpm(1000);
    expect(firstAfter(impulseResponse(fast).l, 1000)).toBe(1000 + 0.75 * 0.25 * SR);
    const slow = new FilterEcho(SR, { filter: 'none' });
    slow.setBpm(1);
    expect(firstAfter(impulseResponse(slow).l, 1000)).toBe(1000 + 0.75 * 1.5 * SR);
  });
});

describe('FilterEcho buffers', () => {
  it('only touches the first `frames` samples', () => {
    const echo = new FilterEcho(SR, { filter: 'lpf' });
    echo.setAmount(0.5);
    run(echo, noise(SR, 1), noise(SR, 2));
    const inL = noise(200, 3);
    const inR = noise(200, 4);
    const l = inL.slice();
    const r = inR.slice();
    echo.process(l, r, 100);
    expectEqual(l.subarray(100), inL.subarray(100));
    expectEqual(r.subarray(100), inR.subarray(100));
    expect(l.subarray(0, 100)).not.toEqual(inL.subarray(0, 100));
  });

  it('floors fractional frames and ignores negative, NaN and oversize values safely', () => {
    const make = () => {
      const echo = new FilterEcho(SR, { filter: 'none' });
      echo.setAmount(0.5);
      run(echo, noise(SR, 1), noise(SR, 2));
      return echo;
    };
    const inL = noise(200, 3);
    const inR = noise(200, 4);

    const a = make();
    const la = inL.slice();
    const ra = inR.slice();
    a.process(la, ra, 100.9);
    const b = make();
    const lb = inL.slice();
    const rb = inR.slice();
    b.process(lb, rb, 100);
    expectEqual(la, lb);
    expectEqual(ra, rb);

    for (const bad of [-5, NaN, -Infinity]) {
      const echo = make();
      const l = inL.slice();
      const r = inR.slice();
      expect(() => echo.process(l, r, bad)).not.toThrow();
      expectEqual(l, inL);
      expectEqual(r, inR);
    }

    // oversize frames and unequal lengths: stops at the shorter buffer
    for (const big of [1e9, Infinity]) {
      const echo = make();
      const l = inL.slice();
      const r = inR.slice(0, 120);
      expect(() => echo.process(l, r, big)).not.toThrow();
      expect(l.length).toBe(200);
      expect(r.length).toBe(120);
      expectEqual(l.subarray(120), inL.subarray(120));
    }
  });

  it('treats NaN and Infinity input as 0', () => {
    const clean = noise(2 * SR, 1);
    const dirty = clean.slice();
    const bad = [NaN, Infinity, -Infinity];
    const positions = [10, 20, 30, 18010, 18020, 40000];
    positions.forEach((p, k) => {
      clean[p] = 0;
      dirty[p] = bad[k % 3];
    });
    const run1 = (input: Float32Array) => {
      const echo = new FilterEcho(SR, { filter: 'bpf' });
      echo.setAmount(0.7);
      const l = input.slice();
      const r = input.slice();
      run(echo, l, r);
      return { l, r };
    };
    const a = run1(dirty);
    const b = run1(clean);
    expect(allFinite(a.l)).toBe(true);
    expect(allFinite(a.r)).toBe(true);
    expectEqual(a.l, b.l);
    expectEqual(a.r, b.r);
  });

  it('gives the same output whatever the block size, also while the amount moves', () => {
    const B = 20000;
    const inL = noise(SR, 1);
    const inR = noise(SR, 2);
    const make = () => {
      const echo = new FilterEcho(SR, { filter: 'lpf' });
      echo.setAmount(0.3);
      return echo;
    };

    const a = make();
    const la = inL.slice();
    const ra = inR.slice();
    const callA = (l: Float32Array, r: Float32Array, f: number) => a.process(l, r, f);
    runBlocks(callA, la.subarray(0, B), ra.subarray(0, B), 128);
    a.setAmount(1);
    runBlocks(callA, la.subarray(B), ra.subarray(B), 128);

    const b = make();
    const lb = inL.slice();
    const rb = inR.slice();
    b.process(lb.subarray(0, B), rb.subarray(0, B), B);
    b.setAmount(1);
    b.process(lb.subarray(B), rb.subarray(B), SR - B);

    expectEqual(la, lb);
    expectEqual(ra, rb);
  });
});

describe('FilterEcho constructor', () => {
  it('rejects invalid sample rates', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => new FilterEcho(sr, { filter: 'none' })).toThrow(RangeError);
    }
  });
});
