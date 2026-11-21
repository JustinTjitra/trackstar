import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { allFinite, impulse, noise, rms, sine, toDb } from '../fixtures/synthAudio';

const RATES = [44100, 48000];
const Q = 0.7071;

function run(filter: Biquad, input: ArrayLike<number>): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = filter.process(input[i]);
  return out;
}

function runExact(filter: Biquad, input: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) out.push(filter.process(input[i]));
  return out;
}

/** Level change in dB of a 1 s sine at `freq`, measured over the second half. */
function gainDb(filter: Biquad, freq: number, sampleRate: number): number {
  filter.reset();
  const input = sine(freq, 1, sampleRate);
  const output = run(filter, input);
  const half = input.length >> 1;
  return toDb(rms(output, half, input.length) / rms(input, half, input.length));
}

type Kind = 'lowpass' | 'highpass' | 'bandpass' | 'allpass';

/** Independent cookbook coefficients, normalised by a0. */
function refCoeffs(kind: Kind, freq: number, q: number, sr: number) {
  const w0 = (2 * Math.PI * freq) / sr;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b: number[];
  if (kind === 'lowpass') b = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  else if (kind === 'highpass') b = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  else if (kind === 'bandpass') b = [alpha, 0, -alpha];
  else b = [1 - alpha, -2 * c, 1 + alpha];
  const a0 = 1 + alpha;
  return {
    b0: b[0] / a0,
    b1: b[1] / a0,
    b2: b[2] / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Direct-form I reference impulse response. */
function refImpulse(kind: Kind, freq: number, q: number, sr: number, n: number): number[] {
  const { b0, b1, b2, a1, a2 } = refCoeffs(kind, freq, q, sr);
  const x = Array.from(impulse(n));
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const x1 = i >= 1 ? x[i - 1] : 0;
    const x2 = i >= 2 ? x[i - 2] : 0;
    const y1 = i >= 1 ? y[i - 1] : 0;
    const y2 = i >= 2 ? y[i - 2] : 0;
    y.push(b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2);
  }
  return y;
}

describe('Biquad pass-through', () => {
  it('a fresh filter returns its input unchanged', () => {
    const input = noise(2000, 7);
    const out = runExact(new Biquad(), input);
    expect(out).toEqual(Array.from(input));
  });
});

describe.each(RATES)('Biquad levels at %i Hz', (sr) => {
  it('low-pass 1000 Hz, q 0.7071', () => {
    const f = new Biquad();
    f.setLowpass(1000, Q, sr);
    expect(Math.abs(gainDb(f, 100, sr))).toBeLessThan(0.5);
    expect(Math.abs(gainDb(f, 1000, sr) + 3.01)).toBeLessThan(0.3);
    expect(gainDb(f, 8000, sr)).toBeLessThan(-30);
  });

  it('high-pass 1000 Hz, q 0.7071', () => {
    const f = new Biquad();
    f.setHighpass(1000, Q, sr);
    expect(Math.abs(gainDb(f, 8000, sr))).toBeLessThan(0.5);
    expect(Math.abs(gainDb(f, 1000, sr) + 3.01)).toBeLessThan(0.3);
    expect(gainDb(f, 100, sr)).toBeLessThan(-30);
  });

  it('band-pass 1000 Hz, q 2', () => {
    const f = new Biquad();
    f.setBandpass(1000, 2, sr);
    expect(Math.abs(gainDb(f, 1000, sr))).toBeLessThan(0.5);
    expect(gainDb(f, 250, sr)).toBeLessThan(-10);
    expect(gainDb(f, 4000, sr)).toBeLessThan(-10);
  });

  it('all-pass 1000 Hz is flat in level and inverts the input at the centre', () => {
    const f = new Biquad();
    f.setAllpass(1000, Q, sr);
    for (const freq of [100, 1000, 8000]) {
      expect(Math.abs(gainDb(f, freq, sr))).toBeLessThan(0.1);
    }
    f.reset();
    const input = sine(1000, 1, sr);
    const output = run(f, input);
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = input.length >> 1; i < input.length; i++) {
      xy += input[i] * output[i];
      xx += input[i] * input[i];
      yy += output[i] * output[i];
    }
    expect(xy / Math.sqrt(xx * yy)).toBeLessThan(-0.99);
  });

  it('high q gives a resonant peak of about 20*log10(q)', () => {
    const f = new Biquad();
    f.setLowpass(1000, 4, sr);
    const g = gainDb(f, 1000, sr);
    expect(g).toBeGreaterThan(10);
    expect(Math.abs(g - 20 * Math.log10(4))).toBeLessThan(0.5);
  });
});

describe('Biquad reference impulse response', () => {
  const sr = 48000;
  it.each(['lowpass', 'bandpass'] as const)('%s matches direct form I', (kind) => {
    const f = new Biquad();
    const q = kind === 'lowpass' ? Q : 2;
    if (kind === 'lowpass') f.setLowpass(1000, q, sr);
    else f.setBandpass(1000, q, sr);
    const got = runExact(f, impulse(64));
    const want = refImpulse(kind, 1000, q, sr, 64);
    let nonTrivial = 0;
    for (let i = 0; i < 64; i++) {
      expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-12);
      if (Math.abs(want[i]) > 1e-6) nonTrivial++;
    }
    expect(nonTrivial).toBeGreaterThan(10);
  });
});

describe('Biquad clamping', () => {
  const sr = 48000;
  const input = noise(4800, 3);
  const lp = (freq: number, q: number): number[] => {
    const f = new Biquad();
    f.setLowpass(freq, q, sr);
    return runExact(f, input);
  };
  const finite = (a: number[]): boolean => a.every(Number.isFinite);

  it('clamps frequency', () => {
    const top = lp(0.45 * sr, Q);
    const low = lp(10, Q);
    const hi = lp(1e9, Q);
    expect(hi).toEqual(top);
    expect(lp(0, Q)).toEqual(low);
    expect(lp(NaN, Q)).toEqual(low);
    expect(top).not.toEqual(low);
    expect(finite(hi) && finite(low) && finite(lp(NaN, Q))).toBe(true);
  });

  it('clamps q', () => {
    const lo = lp(1000, 0.1);
    const hi = lp(1000, 30);
    expect(lp(1000, 0)).toEqual(lo);
    expect(lp(1000, NaN)).toEqual(lo);
    expect(lp(1000, 1000)).toEqual(hi);
    expect(lo).not.toEqual(hi);
    expect(finite(lo) && finite(hi)).toBe(true);
  });
});

describe('Biquad state', () => {
  const sr = 48000;

  it('reset clears the memory and keeps coefficients', () => {
    const input = noise(500, 5);
    const ringing = new Biquad();
    ringing.setLowpass(1000, Q, sr);
    run(ringing, input);
    const tail = runExact(ringing, new Float32Array(8));
    expect(tail.some((v) => v !== 0)).toBe(true);

    const f = new Biquad();
    f.setLowpass(1000, Q, sr);
    run(f, input);
    f.reset();
    expect(runExact(f, new Float32Array(100)).every((v) => v === 0)).toBe(true);
    // coefficients survive: an impulse still produces a filtered response
    const g = new Biquad();
    g.setLowpass(1000, Q, sr);
    f.reset();
    expect(runExact(f, impulse(32))).toEqual(runExact(g, impulse(32)));
  });

  it('changing coefficients does not clear the memory', () => {
    const f = new Biquad();
    f.setLowpass(1000, Q, sr);
    run(f, noise(100, 9));
    f.setLowpass(3000, Q, sr);
    expect(f.process(0)).not.toBe(0);
  });
});

describe('Biquad robustness', () => {
  it('non-finite input leaves outputs finite', () => {
    const f = new Biquad();
    f.setLowpass(1000, Q, 48000);
    const input = Array.from(noise(300, 2));
    input[10] = NaN;
    input[50] = Infinity;
    input[51] = -Infinity;
    input[200] = NaN;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = f.process(input[i]);
    expect(allFinite(out)).toBe(true);
    // a non-finite sample behaves exactly like 0
    const g = new Biquad();
    g.setLowpass(1000, Q, 48000);
    const cleaned = input.map((v) => (Number.isFinite(v) ? v : 0));
    expect(Array.from(out)).toEqual(Array.from(run(g, cleaned)));
  });

  describe.each(RATES)('stability at %i Hz', (sr) => {
    const kinds = ['setLowpass', 'setHighpass', 'setBandpass', 'setAllpass'] as const;
    it.each(kinds)('%s stays finite at extreme settings', (method) => {
      const input = noise(5 * sr, 11);
      for (const freq of [10, 0.45 * sr]) {
        for (const q of [0.1, 30]) {
          const f = new Biquad();
          f[method](freq, q, sr);
          let ok = true;
          for (let i = 0; i < input.length; i++) {
            if (!Number.isFinite(f.process(input[i]))) ok = false;
          }
          expect(ok).toBe(true);
        }
      }
    });
  });
});
