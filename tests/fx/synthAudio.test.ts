import { describe, expect, it } from 'vitest';
import {
  allFinite,
  clickTrack,
  impulse,
  magnitudeAt,
  noise,
  peak,
  rms,
  runBlocks,
  silence,
  sine,
  toDb,
} from '../fixtures/synthAudio';

const SR = 48000;

describe('sine', () => {
  it('has the expected length', () => {
    expect(sine(440, 0.5, 44100).length).toBe(22050);
    expect(sine(1000, 1, SR).length).toBe(SR);
  });

  it('starts at zero and reaches the quarter-cycle peak at the right sample', () => {
    const x = sine(1000, 0.01, SR);
    expect(x[0]).toBe(0);
    // 1 kHz at 48 kHz has 48 samples per cycle, so n = 12 is a quarter cycle.
    expect(x[12]).toBeCloseTo(1, 5);
    expect(x[36]).toBeCloseTo(-1, 5);
  });

  it('scales by amp', () => {
    const x = sine(1000, 1, SR, 0.5);
    expect(peak(x)).toBeCloseTo(0.5, 3);
  });

  it('has RMS of amp / sqrt(2) within 1%', () => {
    const x = sine(1000, 1, SR, 0.5);
    const expected = 0.5 / Math.SQRT2;
    expect(Math.abs(rms(x) - expected) / expected).toBeLessThan(0.01);
  });
});

describe('magnitudeAt', () => {
  it('reads about 1 at the sine frequency for a full-scale sine', () => {
    const m = magnitudeAt(sine(1000, 1, SR), 1000, SR);
    expect(m).toBeGreaterThan(0.98);
    expect(m).toBeLessThan(1.02);
  });

  it('reads near 0 two octaves away', () => {
    const m = magnitudeAt(sine(1000, 1, SR), 4000, SR);
    expect(m).toBeLessThan(0.02);
  });

  it('scales linearly with the amplitude of the signal', () => {
    const m = magnitudeAt(sine(1000, 1, SR, 0.25), 1000, SR);
    expect(m).toBeGreaterThan(0.245);
    expect(m).toBeLessThan(0.255);
  });
});

describe('impulse', () => {
  it('has a single 1 at the requested index and zeros elsewhere', () => {
    const x = impulse(10, 3);
    expect(x.length).toBe(10);
    expect(Array.from(x)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('defaults to index 0', () => {
    const x = impulse(4);
    expect(Array.from(x)).toEqual([1, 0, 0, 0]);
  });
});

describe('silence', () => {
  it('returns a zero-filled array of the requested length', () => {
    const x = silence(256);
    expect(x).toBeInstanceOf(Float32Array);
    expect(x.length).toBe(256);
    expect(peak(x)).toBe(0);
  });
});

describe('noise', () => {
  it('is identical for equal seeds', () => {
    expect(Array.from(noise(1000, 7))).toEqual(Array.from(noise(1000, 7)));
  });

  it('defaults to seed 1', () => {
    expect(Array.from(noise(100))).toEqual(Array.from(noise(100, 1)));
  });

  it('differs for different seeds', () => {
    const a = noise(1000, 1);
    const b = noise(1000, 2);
    let differences = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++;
    expect(differences).toBeGreaterThan(900);
  });

  it('stays within [-amp, amp]', () => {
    const x = noise(SR, 3, 0.7);
    for (const v of x) {
      expect(v).toBeGreaterThanOrEqual(-0.7);
      expect(v).toBeLessThanOrEqual(0.7);
    }
  });

  it('has a mean near zero', () => {
    const x = noise(SR, 11);
    let sum = 0;
    for (const v of x) sum += v;
    expect(Math.abs(sum / x.length)).toBeLessThan(0.02);
  });

  it('has RMS near amp / sqrt(3) (uniform distribution) within 5%', () => {
    const x = noise(SR, 5, 1);
    const expected = 1 / Math.sqrt(3);
    expect(Math.abs(rms(x) - expected) / expected).toBeLessThan(0.05);
  });
});

describe('clickTrack', () => {
  it('places clicks exactly 24000 samples apart at 120 BPM and 48 kHz, first at index 0', () => {
    const x = clickTrack(120, 2, SR);
    expect(x.length).toBe(2 * SR);
    const hits: number[] = [];
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) === 1) hits.push(i);
    expect(hits).toEqual([0, 24000, 48000, 72000]);
  });

  it('is exactly zero between the end of one click and the next', () => {
    // Default click length is 5 ms, which is 240 samples at 48 kHz.
    const x = clickTrack(120, 1, SR);
    const gap = x.slice(240, 24000);
    expect(gap.length).toBe(23760);
    expect(peak(gap)).toBe(0);
  });

  it('decays after the first sample, so only the first sample has absolute value amp', () => {
    const x = clickTrack(120, 1, SR, { amp: 0.8 });
    expect(x[0]).toBeCloseTo(0.8, 6);
    for (let i = 1; i < 240; i++) expect(Math.abs(x[i])).toBeLessThan(0.8);
    expect(peak(x)).toBeCloseTo(0.8, 6);
  });

  it('honours clickMs', () => {
    // 10 ms at 48 kHz is 480 samples, so the tail must still be non-zero at 400.
    const x = clickTrack(120, 1, SR, { clickMs: 10 });
    expect(x[400]).not.toBe(0);
    expect(x[480]).toBe(0);
  });

  it('uses Math.round(k * 60 / bpm * sampleRate) for click starts at fractional spacing', () => {
    const sr = 44100;
    const x = clickTrack(100, 2, sr);
    for (let k = 0; k < 3; k++) {
      const start = Math.round((k * 60 / 100) * sr);
      expect(Math.abs(x[start])).toBe(1);
    }
  });
});

describe('rms', () => {
  it('computes RMS over a sub-range only', () => {
    const x = Float32Array.from([0, 0, 1, 1]);
    expect(rms(x, 2, 4)).toBeCloseTo(1, 6);
    expect(rms(x, 0, 2)).toBe(0);
    expect(rms(x, 0, 4)).toBeCloseTo(Math.sqrt(0.5), 6);
  });

  it('returns 0 for an empty range', () => {
    const x = Float32Array.from([1, 1, 1]);
    expect(rms(x, 2, 2)).toBe(0);
  });

  it('defaults to the whole array', () => {
    const x = Float32Array.from([3, 4]);
    expect(rms(x)).toBeCloseTo(Math.sqrt(12.5), 6);
  });
});

describe('peak', () => {
  it('returns the maximum absolute value', () => {
    expect(peak(Float32Array.from([0.1, -0.7, 0.5]))).toBeCloseTo(0.7, 6);
  });

  it('returns 0 for an empty array', () => {
    expect(peak(new Float32Array(0))).toBe(0);
  });
});

describe('toDb', () => {
  it('maps 1 to 0 dB', () => {
    expect(toDb(1)).toBe(0);
  });

  it('maps 0 to -200 dB', () => {
    expect(toDb(0)).toBe(-200);
  });

  it('maps negative values to -200 dB', () => {
    expect(toDb(-0.5)).toBe(-200);
  });

  it('maps 0.5 to about -6.02 dB', () => {
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
  });
});

describe('allFinite', () => {
  it('is true for normal data', () => {
    expect(allFinite(sine(1000, 0.1, SR))).toBe(true);
    expect(allFinite(new Float32Array(0))).toBe(true);
  });

  it('is false when an element is NaN', () => {
    expect(allFinite(Float32Array.from([0, NaN, 0]))).toBe(false);
  });

  it('is false when an element is Infinity', () => {
    expect(allFinite(Float32Array.from([0, 0, Infinity]))).toBe(false);
    expect(allFinite(Float32Array.from([-Infinity, 0]))).toBe(false);
  });
});

describe('runBlocks', () => {
  it('splits 300 frames into blocks of 128, 128 and 44', () => {
    const l = new Float32Array(300);
    const r = new Float32Array(300);
    const seen: number[] = [];
    runBlocks((_l, _r, frames) => seen.push(frames), l, r, 128);
    expect(seen).toEqual([128, 128, 44]);
  });

  it('passes views of the same length as frames', () => {
    const l = new Float32Array(300);
    const r = new Float32Array(300);
    const lens: number[] = [];
    runBlocks((bl, br, frames) => {
      lens.push(bl.length, br.length, frames);
    }, l, r, 128);
    expect(lens).toEqual([128, 128, 128, 128, 128, 128, 44, 44, 44]);
  });

  it('writes through the views so in-place processing changes the originals', () => {
    const l = new Float32Array(300).fill(1);
    const r = new Float32Array(300).fill(2);
    runBlocks((bl, br) => {
      for (let i = 0; i < bl.length; i++) {
        bl[i] *= 3;
        br[i] = -br[i];
      }
    }, l, r);
    expect(peak(l)).toBe(3);
    expect(l.every((v) => v === 3)).toBe(true);
    expect(r.every((v) => v === -2)).toBe(true);
  });

  it('covers every sample exactly once', () => {
    const l = new Float32Array(300);
    const r = new Float32Array(300);
    let total = 0;
    runBlocks((_bl, _br, frames) => {
      total += frames;
    }, l, r, 128);
    expect(total).toBe(l.length);
  });
});
