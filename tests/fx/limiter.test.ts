import { describe, it, expect } from 'vitest';
import { Limiter, softClip } from '../../src/fx/dsp/limiter';
import { sine, noise, silence, peak, allFinite, runBlocks } from '../fixtures/synthAudio';

const SR = 48000;
const CEIL = 0.98;
const TOL = 1e-6;

/** Index of the first differing sample, or -1 when the arrays are identical. */
function firstDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

/** Drives the limiter down with a loud sine block and returns the final gain. */
function drive(lim: Limiter, seconds = 0.1): number {
  const l = sine(1000, seconds, SR, 2);
  const r = sine(1000, seconds, SR, 2);
  lim.process(l, r, l.length);
  return lim.gain;
}

/** Processes `n` samples of silence. */
function quiet(lim: Limiter, n: number): void {
  lim.process(silence(n), silence(n), n);
}

describe('softClip', () => {
  it('is the identity up to the knee', () => {
    for (let i = 0; i <= 1000; i++) {
      const x = -0.5 + i / 1000;
      expect(softClip(x)).toBe(x);
    }
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-0.5)).toBe(-0.5);
  });

  it('is continuous with slope 1 at the knee', () => {
    expect(Math.abs(softClip(0.5 + 1e-9) - 0.5)).toBeLessThan(1e-8);
    const slope = (softClip(0.5001) - softClip(0.5)) / 0.0001;
    expect(Math.abs(slope - 1)).toBeLessThan(1e-3);
  });

  it('is strictly increasing', () => {
    let prev = softClip(-5);
    for (let i = 1; i <= 1000; i++) {
      const y = softClip(-5 + i * 0.01);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it('is odd', () => {
    for (const x of [0.3, 0.7, 1, 3, 0.5, 10]) {
      expect(softClip(-x)).toBe(-softClip(x));
    }
  });

  it('is bounded by 1', () => {
    for (const x of [0.6, 1, 2, 10, 1e6]) {
      const y = softClip(x);
      expect(y).toBeGreaterThan(0.5);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(softClip(Infinity)).toBe(1);
    expect(softClip(-Infinity)).toBe(-1);
  });

  it('matches known values', () => {
    expect(softClip(1)).toBeCloseTo(0.5 + 0.5 * Math.tanh(1), 12);
    expect(softClip(-2)).toBeCloseTo(-(0.5 + 0.5 * Math.tanh(3)), 12);
  });

  it('maps NaN to 0', () => {
    expect(softClip(NaN)).toBe(0);
  });
});

describe('Limiter', () => {
  it('is bit-transparent below the ceiling', () => {
    const lim = new Limiter(SR);
    const inL = noise(SR, 1, 0.9);
    const inR = noise(SR, 2, 0.9);
    const l = inL.slice();
    const r = inR.slice();
    lim.process(l, r, l.length);
    expect(firstDiff(l, inL)).toBe(-1);
    expect(firstDiff(r, inR)).toBe(-1);
    expect(lim.gain).toBe(1);
  });

  it('holds a loud sine at the ceiling, not far below it', () => {
    const lim = new Limiter(SR);
    const l = sine(1000, 0.5, SR, 2);
    const r = sine(1000, 0.5, SR, 2);
    lim.process(l, r, l.length);
    expect(peak(l)).toBeLessThanOrEqual(CEIL + TOL);
    expect(peak(r)).toBeLessThanOrEqual(CEIL + TOL);
    expect(peak(l)).toBeGreaterThanOrEqual(0.97);
  });

  it('never exceeds the ceiling on wildly changing noise', () => {
    // Seeded pseudo-random amplitude in [0, 10), new value every 1000 samples.
    let s = 12345;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const n = 2 * SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i += 1000) {
      const len = Math.min(1000, n - i);
      l.set(noise(len, 100 + i, rand() * 10), i);
      r.set(noise(len, 5000 + i, rand() * 10), i);
    }
    const lim = new Limiter(SR);
    lim.process(l, r, n);
    expect(peak(l)).toBeLessThanOrEqual(CEIL + TOL);
    expect(peak(r)).toBeLessThanOrEqual(CEIL + TOL);
    expect(peak(l)).toBeGreaterThan(0.5);
  });

  it('attacks instantly on a single loud sample', () => {
    const lim = new Limiter(SR);
    const l = new Float32Array(301);
    const r = new Float32Array(301);
    l[300] = 5;
    lim.process(l, r, 301);
    expect(l[300]).toBeLessThanOrEqual(CEIL + TOL);
    expect(l[300]).toBeGreaterThan(0.97);
    expect(Math.abs(lim.gain - CEIL / 5)).toBeLessThan(1e-3);
  });

  it('holds a steady gain during a steady loud sine', () => {
    const lim = new Limiter(SR);
    const l = sine(1000, 0.3, SR, 2);
    const r = sine(1000, 0.3, SR, 2);
    const block = 16;
    const start = Math.ceil(0.002 * SR / block) * block;
    for (let i = 0; i < l.length; i += block) {
      lim.process(l.subarray(i, i + block), r.subarray(i, i + block), block);
      if (i >= start) {
        expect(lim.gain).toBeGreaterThanOrEqual(0.49 - 1e-6);
        expect(lim.gain).toBeLessThanOrEqual(0.49 * 1.05);
      }
    }
  });

  it('releases with the configured time constant', () => {
    const lim = new Limiter(SR);
    const g0 = drive(lim);
    expect(g0).toBeLessThan(0.6);
    quiet(lim, 3840);
    const expected = (1 - g0) * Math.exp(-1);
    expect(Math.abs(1 - lim.gain - expected)).toBeLessThan(expected * 0.05);
  });

  it('recovers above 0.99 within 5 release times', () => {
    const lim = new Limiter(SR);
    drive(lim);
    quiet(lim, 5 * 3840);
    expect(lim.gain).toBeGreaterThan(0.99);
  });

  it('returns to exact transparency after 25 release times of quiet', () => {
    const lim = new Limiter(SR);
    drive(lim);
    quiet(lim, 25 * 3840);
    expect(lim.gain).toBe(1);
    const inL = noise(4800, 3, 0.9);
    const inR = noise(4800, 4, 0.9);
    const l = inL.slice();
    const r = inR.slice();
    lim.process(l, r, l.length);
    expect(firstDiff(l, inL)).toBe(-1);
    expect(firstDiff(r, inR)).toBe(-1);
  });

  it('applies the same gain to both channels', () => {
    const lim = new Limiter(SR);
    const inL = sine(1000, 0.5, SR, 4);
    const inR = sine(300, 0.5, SR, 0.1);
    const l = inL.slice();
    const r = inR.slice();
    lim.process(l, r, l.length);
    let checked = 0;
    for (let i = 0; i < l.length; i++) {
      if (Math.abs(inL[i]) > 0.01 && Math.abs(inR[i]) > 0.01) {
        expect(Math.abs(r[i] / inR[i] - l[i] / inL[i])).toBeLessThan(1e-5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(peak(r)).toBeLessThan(0.05);
    expect(peak(l)).toBeLessThanOrEqual(CEIL + TOL);
  });

  it('gives identical output regardless of block size', () => {
    const n = SR / 2;
    const inL = new Float32Array(n);
    const inR = new Float32Array(n);
    inL.set(sine(700, 0.1, SR, 3), 0);
    inR.set(noise(0.1 * SR, 9, 2), 0);
    inL.set(sine(500, 0.3, SR, 0.4), 4800);
    inR.set(noise(0.3 * SR, 10, 0.3), 4800);

    const wholeL = inL.slice();
    const wholeR = inR.slice();
    new Limiter(SR).process(wholeL, wholeR, n);

    const blkL = inL.slice();
    const blkR = inR.slice();
    const lim = new Limiter(SR);
    runBlocks((a, b, f) => lim.process(a, b, f), blkL, blkR, 128);

    expect(firstDiff(blkL, wholeL)).toBe(-1);
    expect(firstDiff(blkR, wholeR)).toBe(-1);
    expect(peak(wholeL)).toBeLessThanOrEqual(CEIL + TOL);
  });

  it('respects the frames argument', () => {
    const lim = new Limiter(SR);
    const l = new Float32Array(200).fill(5);
    const r = new Float32Array(200).fill(5);
    lim.process(l, r, 100);
    for (let i = 0; i < 100; i++) {
      expect(l[i]).toBeLessThanOrEqual(CEIL + TOL);
      expect(r[i]).toBeLessThanOrEqual(CEIL + TOL);
    }
    for (let i = 100; i < 200; i++) {
      expect(l[i]).toBe(5);
      expect(r[i]).toBe(5);
    }
  });

  it('survives out-of-range frames values', () => {
    for (const frames of [1000, -5, NaN, Infinity, -Infinity]) {
      const lim = new Limiter(SR);
      const l = new Float32Array(200).fill(5);
      const r = new Float32Array(150).fill(5);
      expect(() => lim.process(l, r, frames)).not.toThrow();
      expect(l.length).toBe(200);
      expect(r.length).toBe(150);
      if (frames === 1000 || frames === Infinity) {
        // Clamped to the shorter buffer: 150 frames limited, left tail untouched.
        // Infinity is non-finite, so it counts as 0 and nothing is touched.
        const touched = frames === 1000 ? 150 : 0;
        for (let i = 0; i < 200; i++) {
          if (i < touched) expect(l[i]).toBeLessThanOrEqual(CEIL + TOL);
          else expect(l[i]).toBe(5);
        }
      } else {
        expect(Array.from(l).every((v) => v === 5)).toBe(true);
        expect(Array.from(r).every((v) => v === 5)).toBe(true);
      }
    }
  });

  it('handles non-finite input', () => {
    const lim = new Limiter(SR);
    const n = 300;
    const l = new Float32Array(n).fill(0.3);
    const r = new Float32Array(n).fill(0.3);
    l[10] = NaN;
    r[20] = Infinity;
    l[30] = -Infinity;
    r[30] = NaN;
    l[40] = 5;
    r[50] = 5;
    lim.process(l, r, n);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(l[10]).toBe(0);
    expect(r[20]).toBe(0);
    expect(l[30]).toBe(0);
    expect(r[30]).toBe(0);
    expect(l[40]).toBeLessThanOrEqual(CEIL + TOL);
    expect(l[40]).toBeGreaterThan(0.97);
    expect(r[50]).toBeLessThanOrEqual(CEIL + TOL);
    expect(r[50]).toBeGreaterThan(0.97);
    expect(Number.isFinite(lim.gain)).toBe(true);
    expect(lim.gain).toBeGreaterThan(0);
    expect(lim.gain).toBeLessThan(1);
  });

  it('reset restores unity gain', () => {
    const lim = new Limiter(SR);
    expect(drive(lim)).toBeLessThan(0.6);
    lim.reset();
    expect(lim.gain).toBe(1);
  });

  it('honours a custom ceiling and release', () => {
    const lim = new Limiter(SR, 0.5, 10);
    const l = sine(1000, 0.3, SR, 2);
    const r = sine(1000, 0.3, SR, 2);
    lim.process(l, r, l.length);
    expect(peak(l)).toBeLessThanOrEqual(0.5 + TOL);
    expect(peak(l)).toBeGreaterThan(0.49);
    quiet(lim, Math.round(0.05 * SR));
    expect(lim.gain).toBeGreaterThan(0.99);
  });

  describe('constructor', () => {
    it('rejects invalid sample rates', () => {
      for (const sr of [0, -1, NaN, Infinity, -Infinity]) {
        expect(() => new Limiter(sr)).toThrow(RangeError);
      }
    });

    it('clamps a ceiling of 5 to 1', () => {
      const lim = new Limiter(SR, 5);
      const l = sine(1000, 0.3, SR, 2);
      const r = sine(1000, 0.3, SR, 2);
      lim.process(l, r, l.length);
      expect(peak(l)).toBeLessThanOrEqual(1 + TOL);
      expect(peak(l)).toBeGreaterThan(0.99);
    });

    it('treats a NaN ceiling as 0.98', () => {
      const lim = new Limiter(SR, NaN);
      const l = sine(1000, 0.3, SR, 2);
      const r = sine(1000, 0.3, SR, 2);
      lim.process(l, r, l.length);
      expect(peak(l)).toBeLessThanOrEqual(CEIL + TOL);
      expect(peak(l)).toBeGreaterThan(0.97);
    });

    it('treats a NaN release as 80 ms', () => {
      const lim = new Limiter(SR, 0.98, NaN);
      const g0 = drive(lim);
      quiet(lim, 3840);
      const expected = (1 - g0) * Math.exp(-1);
      expect(Math.abs(1 - lim.gain - expected)).toBeLessThan(expected * 0.05);
    });
  });
});

describe('Limiter guarantee under hostile input', () => {
  // The one promise this class makes: nothing above the ceiling, nothing non-finite, whatever
  // comes in. Fed here: values spread over eight orders of magnitude, mixed with NaN,
  // infinities, the largest 32-bit floats and values right at the ceiling, for several
  // ceilings, release times and block sizes.
  it('never exceeds the ceiling and never outputs a non-finite value', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const specials = [0, 1e-30, 0.98, 0.9800001, 1, 3.4028234e38, -3.4028234e38, NaN, Infinity, -Infinity, 1e20, 0.5];
    const hostile = (): number =>
      rnd() < 0.15 ? specials[Math.floor(rnd() * specials.length)] : (rnd() * 2 - 1) * 10 ** (rnd() * 8 - 4);
    const settings: [number, number][] = [
      [0.98, 80],
      [0.5, 1],
      [1, 5000],
      [0.01, 10],
    ];
    let worstExcess = -Infinity;
    let bad = 0;
    for (const [ceiling, releaseMs] of settings) {
      for (const block of [1, 7, 128, 1000]) {
        const limiter = new Limiter(SR, ceiling, releaseMs);
        const l = new Float32Array(block);
        const r = new Float32Array(block);
        for (let b = 0; b < 200; b++) {
          for (let i = 0; i < block; i++) {
            l[i] = hostile();
            r[i] = hostile();
          }
          limiter.process(l, r, block);
          for (let i = 0; i < block; i++) {
            if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) bad++;
            worstExcess = Math.max(worstExcess, Math.abs(l[i]) - ceiling, Math.abs(r[i]) - ceiling);
          }
          const g = limiter.gain;
          if (!Number.isFinite(g) || g > 1 || g < 0) bad++;
        }
      }
    }
    expect(bad).toBe(0);
    expect(worstExcess).toBeLessThan(1e-6);
  });
});
