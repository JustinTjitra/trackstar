import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { OnsetDetector } from '../../src/fx/tempo/onset';
import { clickTrack, noise, silence, sine } from '../fixtures/synthAudio';

const SR = 48000;
const HOP = 512;

/** Feeds x (in blocks of `block` samples when given, else in one call) and returns every value. */
function collect(det: OnsetDetector, x: Float32Array, block?: number): number[] {
  const out: number[] = [];
  const cb = (v: number): void => {
    out.push(v);
  };
  if (block === undefined) {
    det.process(x, x.length, cb);
  } else {
    for (let i = 0; i < x.length; i += block) {
      const n = Math.min(block, x.length - i);
      det.process(x.subarray(i, i + n), n, cb);
    }
  }
  return out;
}

/** The expected values, written out with plain variables. */
function reference(x: Float32Array, sampleRate: number, hop: number): number[] {
  const floorLog = Math.log(1e-4);
  const lp = new Biquad();
  lp.setLowpass(200, Math.SQRT1_2, sampleRate);
  const c = 1 - Math.exp(-1 / ((8 / 1000) * sampleRate));
  let sF = 0;
  let sL = 0;
  let accF = 0;
  let accL = 0;
  let count = 0;
  let prevF = floorLog;
  let prevL = floorLog;
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const s = Number.isFinite(x[i]) ? x[i] : 0;
    const lo = lp.process(s);
    sF += (s * s - sF) * c;
    sL += (lo * lo - sL) * c;
    accF += sF;
    accL += sL;
    count++;
    if (count === hop) {
      const logF = Math.log(accF / hop + 1e-4);
      const logL = Math.log(accL / hop + 1e-4);
      out.push(0.5 * Math.max(0, logF - prevF) + 0.5 * Math.max(0, logL - prevL));
      prevF = logF;
      prevL = logL;
      accF = 0;
      accL = 0;
      count = 0;
    }
  }
  return out;
}

/** noise plus a click track at 128 BPM, 2 seconds. */
function mixed(sampleRate: number): Float32Array {
  const n = noise(2 * sampleRate, 7, 0.2);
  const c = clickTrack(128, 2, sampleRate);
  const x = new Float32Array(n.length);
  for (let i = 0; i < x.length; i++) x[i] = n[i] + c[i];
  return x;
}

/** Checks that beats show up as peaks and nothing else does. */
function expectBeats(values: number[], valuesPerBeat: number): void {
  const centres: number[] = [];
  for (let k = 0; Math.floor(k * valuesPerBeat) + 1 < values.length; k++) centres.push(Math.floor(k * valuesPerBeat));
  expect(centres.length).toBeGreaterThan(8);
  for (const c of centres) {
    const near = Math.max(values[c - 1] ?? 0, values[c], values[c + 1]);
    expect(near).toBeGreaterThan(1.5);
  }
  for (let i = 0; i < values.length; i++) {
    if (centres.some((c) => Math.abs(i - c) <= 1)) continue;
    expect(values[i]).toBeLessThan(1e-9);
  }
}

describe('OnsetDetector construction', () => {
  it('throws RangeError for a bad sampleRate or hop', () => {
    for (const sr of [0, -1, NaN, Infinity]) expect(() => new OnsetDetector(sr)).toThrow(RangeError);
    for (const hop of [0, -1, NaN, Infinity]) expect(() => new OnsetDetector(SR, hop)).toThrow(RangeError);
  });

  it('reports the value rate', () => {
    expect(new OnsetDetector(48000).hopRate).toBe(93.75);
    expect(new OnsetDetector(44100).hopRate).toBe(86.1328125);
    expect(new OnsetDetector(48000, 128).hopRate).toBe(375);
  });

  it('floors a fractional hop', () => {
    const det = new OnsetDetector(48000, 512.9);
    expect(det.hopRate).toBe(93.75);
    const x = mixed(SR);
    expect(collect(det, x)).toEqual(collect(new OnsetDetector(48000, 512), x));
  });
});

describe('OnsetDetector values', () => {
  it('matches the formula at 48 kHz with hop 512', () => {
    const x = mixed(SR);
    const got = collect(new OnsetDetector(SR, 512), x);
    const want = reference(x, SR, 512);
    expect(got.length).toBe(Math.floor(96000 / 512));
    expect(want.length).toBe(got.length);
    for (let i = 0; i < got.length; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-12);
  });

  it('matches the formula at 44.1 kHz with hop 256', () => {
    const x = mixed(44100);
    const got = collect(new OnsetDetector(44100, 256), x);
    const want = reference(x, 44100, 256);
    expect(got.length).toBe(Math.floor(x.length / 256));
    expect(want.length).toBe(got.length);
    for (let i = 0; i < got.length; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-12);
  });

  it('finds clicks at 48 kHz and nothing between them', () => {
    const values = collect(new OnsetDetector(SR), clickTrack(120, 6, SR));
    expectBeats(values, (60 / 120) * (SR / HOP));
  });

  it('finds clicks at 44.1 kHz and nothing between them', () => {
    const values = collect(new OnsetDetector(44100), clickTrack(120, 6, 44100));
    expectBeats(values, (60 / 120) * (44100 / HOP));
  });

  it('gives exact zeros for silence', () => {
    const values = collect(new OnsetDetector(SR), silence(2 * SR));
    expect(values.length).toBe(Math.floor((2 * SR) / HOP));
    for (const v of values) expect(v).toBe(0);
  });

  it('does not treat a steady tone as onsets', () => {
    const a = collect(new OnsetDetector(SR), sine(440, 3, SR, 0.5));
    expect(a[0]).toBeGreaterThan(2);
    expect(Math.max(...a.slice(4))).toBeLessThan(0.02);
    const b = collect(new OnsetDetector(SR), sine(60, 3, SR, 0.5));
    expect(Math.max(...b.slice(4))).toBeLessThan(0.1);
  });

  it('keeps steady noise quiet compared with a click', () => {
    const values = collect(new OnsetDetector(SR), noise(6 * SR, 3, 0.25)).slice(2);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeLessThan(0.1);
  });

  it('treats a level below the floor as silence', () => {
    const values = collect(new OnsetDetector(SR), noise(96000, 3, 0.001));
    expect(Math.max(...values)).toBeLessThan(0.01);
  });

  it('never gives negative or non-finite values, and treats bad samples as 0', () => {
    const clean = mixed(SR);
    const dirty = clean.slice();
    const bad = [NaN, Infinity, -Infinity];
    for (let i = 0; i < 60; i++) {
      const at = 1000 + i * 1500;
      dirty[at] = bad[i % 3];
      clean[at] = 0;
    }
    const got = collect(new OnsetDetector(SR), dirty);
    const want = collect(new OnsetDetector(SR), clean);
    expect(got).toEqual(want);
    for (const v of got) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('OnsetDetector blocks, frames and reset', () => {
  it('gives the same values for any block size', () => {
    const x = mixed(SR);
    const whole = collect(new OnsetDetector(SR), x);
    for (const block of [1, 128, 500, 4096]) {
      const split = collect(new OnsetDetector(SR), x, block);
      expect(split.length).toBe(whole.length);
      expect(split).toEqual(whole);
    }
  });

  it('consumes only `frames` samples', () => {
    const x = noise(4096, 5, 0.5);
    const det = new OnsetDetector(SR);
    const got: number[] = [];
    const cb = (v: number): void => {
      got.push(v);
    };
    for (let i = 0; i < 5; i++) det.process(x, 100, cb);
    expect(got.length).toBe(0);
    det.process(x, 100, cb);
    expect(got.length).toBe(1);
    const det2 = new OnsetDetector(SR);
    for (const f of [0, NaN, -5]) det2.process(x, f, cb);
    for (let i = 0; i < 5; i++) det2.process(x, 100, cb);
    expect(got.length).toBe(1);
    det2.process(x, 100, cb);
    expect(got.length).toBe(2);
  });

  it('reset gives the same values as a fresh detector', () => {
    const x = clickTrack(120, 3, SR);
    const det = new OnsetDetector(SR);
    collect(det, x);
    det.reset();
    expect(collect(det, x)).toEqual(collect(new OnsetDetector(SR), x));
  });

  it('reset after loud audio forgets the level it had reached', () => {
    // 100 whole hops of loud noise leave both bands at a high level; a quieter low tone must still start with an onset
    const det = new OnsetDetector(SR);
    collect(det, noise(100 * HOP, 9, 0.5));
    det.reset();
    const quiet = sine(100, 0.2, SR, 0.1);
    const after = collect(det, quiet);
    const fresh = collect(new OnsetDetector(SR), quiet);
    expect(after).toEqual(fresh);
    expect(fresh[0]).toBeGreaterThan(1);
  });

  it('reset in the middle of a hop discards the partial hop', () => {
    const x = noise(4096, 9, 0.5);
    const det = new OnsetDetector(SR);
    const got: number[] = [];
    const cb = (v: number): void => {
      got.push(v);
    };
    det.process(x, 300, cb);
    expect(got.length).toBe(0);
    det.reset();
    det.process(x, 511, cb);
    expect(got.length).toBe(0);
    det.process(x.subarray(511), 1, cb);
    expect(got.length).toBe(1);
    expect(got[0]).toBe(collect(new OnsetDetector(SR), x.subarray(0, 512))[0]);
  });

  it('calls back synchronously and in order', () => {
    const x = noise(10000, 4, 0.3);
    const want = reference(x, SR, HOP);
    for (const n of [511, 512, 513, 1024, 5000, 10000]) {
      const det = new OnsetDetector(SR);
      const calls: Array<[number, number]> = [];
      let inside = 0;
      det.process(
        x,
        n,
        (v) => {
          calls.push([calls.length, v]);
          inside = calls.length;
        },
      );
      expect(calls.length).toBe(Math.floor(n / HOP));
      expect(inside).toBe(calls.length);
      calls.forEach(([idx, v], i) => {
        expect(idx).toBe(i);
        expect(Math.abs(v - want[i])).toBeLessThan(1e-12);
      });
    }
  });
});
