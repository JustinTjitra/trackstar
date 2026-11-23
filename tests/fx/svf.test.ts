import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { Svf } from '../../src/fx/dsp/svf';
import { allFinite, noise, peak, rms, sine, toDb } from '../fixtures/synthAudio';

const RATES = [44100, 48000];
const Q = 0.7071;

type Out = 'lp' | 'bp' | 'hp';

/** Level in dB of one output for a 1 s sine at `freq`, relative to the input, over the second half. */
function gainDb(f: Svf, out: Out, freq: number, sampleRate: number): number {
  f.reset();
  const input = sine(freq, 1, sampleRate);
  const result = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    f.process(input[i]);
    result[i] = f[out];
  }
  const half = input.length >> 1;
  return toDb(rms(result, half, input.length) / rms(input, half, input.length));
}

/** Runs `input` and returns the three outputs in double precision. */
function runAll(f: Svf, input: ArrayLike<number>): { lp: number[]; bp: number[]; hp: number[] } {
  const lp: number[] = [];
  const bp: number[] = [];
  const hp: number[] = [];
  for (let i = 0; i < input.length; i++) {
    f.process(input[i]);
    lp.push(f.lp);
    bp.push(f.bp);
    hp.push(f.hp);
  }
  return { lp, bp, hp };
}

function make(sr: number, freq: number, q: number): Svf {
  const f = new Svf(sr);
  f.set(freq, q);
  return f;
}

describe.each(RATES)('Svf levels at %i Hz', (sr) => {
  it('low-pass 1000 Hz, q 0.7071', () => {
    const f = make(sr, 1000, Q);
    expect(Math.abs(gainDb(f, 'lp', 100, sr))).toBeLessThan(0.5);
    expect(Math.abs(gainDb(f, 'lp', 1000, sr) + 3.01)).toBeLessThan(0.3);
    expect(gainDb(f, 'lp', 8000, sr)).toBeLessThan(-30);
  });

  it('high-pass 1000 Hz, q 0.7071', () => {
    const f = make(sr, 1000, Q);
    expect(Math.abs(gainDb(f, 'hp', 8000, sr))).toBeLessThan(0.5);
    expect(Math.abs(gainDb(f, 'hp', 1000, sr) + 3.01)).toBeLessThan(0.3);
    expect(gainDb(f, 'hp', 100, sr)).toBeLessThan(-30);
  });

  it('band-pass 1000 Hz, q 2 peaks at 0 dB', () => {
    const f = make(sr, 1000, 2);
    expect(Math.abs(gainDb(f, 'bp', 1000, sr))).toBeLessThan(0.5);
    expect(gainDb(f, 'bp', 250, sr)).toBeLessThan(-10);
    expect(gainDb(f, 'bp', 4000, sr)).toBeLessThan(-10);
  });

  it('high q gives a resonant peak of 20*log10(q)', () => {
    const f = make(sr, 1000, 4);
    expect(Math.abs(gainDb(f, 'lp', 1000, sr) - 12.04)).toBeLessThan(0.5);
  });
});

describe('Svf structure', () => {
  it.each([Q, 5])('lp + bp + hp equals the input at q %f', (q) => {
    const f = make(48000, 1500, q);
    const input = noise(4800, 21);
    let worst = 0;
    for (let i = 0; i < input.length; i++) {
      f.process(input[i]);
      worst = Math.max(worst, Math.abs(f.lp + f.bp + f.hp - input[i]));
    }
    expect(worst).toBeLessThan(1e-12);
  });
});

describe('Svf against the biquad', () => {
  const sr = 48000;
  const input = noise(512, 17);

  function maxDiff(freq: number, q: number): number {
    const svf = make(sr, freq, q);
    const got = runAll(svf, input);
    const lp = new Biquad();
    const hp = new Biquad();
    const bp = new Biquad();
    lp.setLowpass(freq, q, sr);
    hp.setHighpass(freq, q, sr);
    bp.setBandpass(freq, q, sr);
    let worst = 0;
    for (let i = 0; i < input.length; i++) {
      worst = Math.max(
        worst,
        Math.abs(got.lp[i] - lp.process(input[i])),
        Math.abs(got.hp[i] - hp.process(input[i])),
        Math.abs(got.bp[i] - bp.process(input[i])),
      );
    }
    return worst;
  }

  it('matches at 1000 Hz, q 0.7071', () => {
    expect(maxDiff(1000, Q)).toBeLessThan(1e-9);
  });

  it('matches at 5000 Hz, q 3', () => {
    expect(maxDiff(5000, 3)).toBeLessThan(1e-9);
  });
});

describe('Svf defaults', () => {
  it('a fresh filter equals one set to 1000 Hz, q 0.7071', () => {
    const input = noise(2000, 4);
    const a = runAll(new Svf(48000), input);
    const b = runAll(make(48000, 1000, 0.7071), input);
    expect(a).toEqual(b);
    expect(a.lp.some((v) => v !== 0)).toBe(true);
  });

  it('starts with all outputs at 0', () => {
    const f = new Svf(48000);
    expect([f.lp, f.bp, f.hp]).toEqual([0, 0, 0]);
  });
});

describe('Svf modulation stability', () => {
  const sr = 48000;
  const n = 2 * sr;

  it('survives a slow geometric sweep with set on every sample', () => {
    const input = noise(n, 31);
    const f = new Svf(sr);
    const lp = new Float32Array(n);
    const bp = new Float32Array(n);
    const hp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      f.set(200 * (8000 / 200) ** (i / (n - 1)), Q);
      f.process(input[i]);
      lp[i] = f.lp;
      bp[i] = f.bp;
      hp[i] = f.hp;
    }
    expect(allFinite(lp) && allFinite(bp) && allFinite(hp)).toBe(true);
    expect(peak(lp)).toBeLessThan(4);
  });

  it.each([Q, 8])('stays finite when the cutoff alternates every sample at q %f', (q) => {
    const input = noise(n, 32);
    const f = new Svf(sr);
    const lp = new Float32Array(n);
    const bp = new Float32Array(n);
    const hp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      f.set(i & 1 ? 8000 : 200, q);
      f.process(input[i]);
      lp[i] = f.lp;
      bp[i] = f.bp;
      hp[i] = f.hp;
    }
    expect(allFinite(lp) && allFinite(bp) && allFinite(hp)).toBe(true);
  });
});

describe('Svf clamping', () => {
  const sr = 48000;
  const input = noise(4800, 3);
  const run = (freq: number, q: number) => runAll(make(sr, freq, q), input);
  const finite = (r: ReturnType<typeof run>): boolean =>
    [r.lp, r.bp, r.hp].every((a) => a.every(Number.isFinite));

  it('clamps frequency', () => {
    const top = run(0.45 * sr, Q);
    const low = run(10, Q);
    expect(run(1e9, Q)).toEqual(top);
    expect(run(0, Q)).toEqual(low);
    expect(run(NaN, Q)).toEqual(low);
    expect(top).not.toEqual(low);
    expect(finite(top) && finite(low) && finite(run(1e9, Q)) && finite(run(NaN, Q))).toBe(true);
  });

  it('clamps q', () => {
    const lo = run(1000, 0.1);
    const hi = run(1000, 30);
    expect(run(1000, 0)).toEqual(lo);
    expect(run(1000, NaN)).toEqual(lo);
    expect(run(1000, 1000)).toEqual(hi);
    expect(lo).not.toEqual(hi);
    expect(finite(lo) && finite(hi)).toBe(true);
  });
});

describe('Svf state', () => {
  const sr = 48000;

  it('set does not clear the memory', () => {
    const f = make(sr, 1000, Q);
    runAll(f, noise(100, 9));
    f.set(3000, Q);
    f.process(0);
    expect(f.lp).not.toBe(0);
  });

  it('reset clears memory and outputs and keeps the cutoff', () => {
    const f = make(sr, 1000, Q);
    runAll(f, noise(500, 5));
    f.reset();
    expect([f.lp, f.bp, f.hp]).toEqual([0, 0, 0]);
    const tail = runAll(f, new Float32Array(100));
    expect([...tail.lp, ...tail.bp, ...tail.hp].every((v) => v === 0)).toBe(true);

    const impulse = new Float32Array(64);
    impulse[0] = 1;
    f.reset();
    const got = runAll(f, impulse);
    const want = runAll(make(sr, 1000, Q), impulse);
    expect(got).toEqual(want);
    expect(want.lp.some((v) => v !== 0)).toBe(true);
    // a 1000 Hz cutoff differs from the 1000 Hz default only if reset had moved it
    const other = runAll(make(sr, 4000, Q), impulse);
    expect(got).not.toEqual(other);
  });
});

describe('Svf robustness', () => {
  it('non-finite input behaves exactly like 0', () => {
    const input = Array.from(noise(300, 2));
    input[10] = NaN;
    input[50] = Infinity;
    input[51] = -Infinity;
    input[200] = NaN;
    const got = runAll(make(48000, 1000, Q), input);
    const cleaned = input.map((v) => (Number.isFinite(v) ? v : 0));
    const want = runAll(make(48000, 1000, Q), cleaned);
    expect(got).toEqual(want);
    expect([...got.lp, ...got.bp, ...got.hp].every(Number.isFinite)).toBe(true);
  });

  describe.each(RATES)('extreme settings at %i Hz', (sr) => {
    it.each([
      [10, 0.1],
      [10, 30],
      [0.45 * sr, 0.1],
      [0.45 * sr, 30],
    ])('freq %f, q %f stays finite', (freq, q) => {
      const input = noise(5 * sr, 11);
      const f = make(sr, freq, q);
      let ok = true;
      for (let i = 0; i < input.length; i++) {
        f.process(input[i]);
        if (!Number.isFinite(f.lp) || !Number.isFinite(f.bp) || !Number.isFinite(f.hp)) ok = false;
      }
      expect(ok).toBe(true);
    });
  });
});
