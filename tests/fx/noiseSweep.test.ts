import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { expLerp } from '../../src/fx/dsp/math';
import { NoiseSource } from '../../src/fx/dsp/noise';
import { Svf } from '../../src/fx/dsp/svf';
import { NoiseSweep } from '../../src/fx/effects/noiseSweep';
import { allFinite, noise, peak, rms, runBlocks, silence, sine, toDb } from '../fixtures/synthAudio';

const SR = 48000;
const RIGHT_SEED_OFFSET = 0x9e3779b9;

/** One channel of the reference: seeded white noise through a band-pass, scaled by 0.5 * a * a. */
function referenceChannel(noiseSeed: number, a: number, n: number): Float32Array {
  const svf = new Svf(SR);
  svf.set(expLerp(300, 9000, a), 0.8);
  const src = new NoiseSource(noiseSeed);
  const level = 0.5 * a * a;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    svf.process(src.white());
    out[i] = level * svf.bp;
  }
  return out;
}

/** What the effect must output for silence at a settled amount `a`, built from the building blocks. */
function reference(seed: number, a: number, n: number): { l: Float32Array; r: Float32Array } {
  return {
    l: referenceChannel(seed >>> 0, a, n),
    r: referenceChannel((seed + RIGHT_SEED_OFFSET) >>> 0, a, n),
  };
}

/** Effect set to amount `a` at once (setAmount then reset), fed `n` samples of silence. */
function fromReset(seed: number, a: number, n: number): { l: Float32Array; r: Float32Array } {
  const fx = new NoiseSweep(SR, seed);
  fx.setAmount(a);
  fx.reset();
  const l = silence(n);
  const r = silence(n);
  fx.process(l, r, n);
  return { l, r };
}

function maxDiff(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

function expectEqual(a: Float32Array, b: Float32Array): void {
  expect(a.length).toBe(b.length);
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) {
      diff = i;
      break;
    }
  }
  expect(diff).toBe(-1);
}

/** Share of the energy above 4 kHz: rms of the high-passed signal over rms of the signal. */
function highShare(x: Float32Array): number {
  const hp = new Biquad();
  hp.setHighpass(4000, 0.7071, SR);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = hp.process(x[i]);
  return rms(y) / rms(x);
}

function correlation(a: Float32Array, b: Float32Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
}

describe('NoiseSweep identity', () => {
  it('leaves noise on both channels bit-identical at amount 0', () => {
    const fx = new NoiseSweep(SR);
    const inL = noise(5000, 1);
    const inR = noise(5000, 2);
    const l = inL.slice();
    const r = inR.slice();
    fx.process(l, r, l.length);
    expectEqual(l, inL);
    expectEqual(r, inR);
  });

  it('returns to bit-identical output after the amount goes back to 0', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(0.8);
    fx.process(silence(SR), silence(SR), SR);
    fx.setAmount(0);
    fx.process(silence(SR), silence(SR), SR);
    const inL = noise(5000, 5);
    const inR = noise(5000, 6);
    const l = inL.slice();
    const r = inR.slice();
    fx.process(l, r, l.length);
    expectEqual(l, inL);
    expectEqual(r, inR);
  });

  it('treats setAmount(-3) like 0 (identity) and setAmount(5) like 1', () => {
    const low = new NoiseSweep(SR);
    low.setAmount(-3);
    const inL = noise(5000, 1);
    const inR = noise(5000, 2);
    const l = inL.slice();
    const r = inR.slice();
    low.process(l, r, l.length);
    expectEqual(l, inL);
    expectEqual(r, inR);

    const big = new NoiseSweep(SR);
    big.setAmount(5);
    const one = new NoiseSweep(SR);
    one.setAmount(1);
    const bl = inL.slice();
    const br = inR.slice();
    const ol = inL.slice();
    const or = inR.slice();
    big.process(bl, br, bl.length);
    one.process(ol, or, ol.length);
    expectEqual(bl, ol);
    expectEqual(br, or);
    expect(maxDiff(bl, inL)).toBeGreaterThan(0.01);
  });

  it('ignores NaN and Infinity in setAmount', () => {
    const a = new NoiseSweep(SR);
    a.setAmount(0.5);
    a.setAmount(NaN);
    a.setAmount(Infinity);
    a.setAmount(-Infinity);
    const b = new NoiseSweep(SR);
    b.setAmount(0.5);
    const inL = noise(20000, 1);
    const inR = noise(20000, 2);
    const al = inL.slice();
    const ar = inR.slice();
    const bl = inL.slice();
    const br = inR.slice();
    a.process(al, ar, al.length);
    b.process(bl, br, bl.length);
    expectEqual(al, bl);
    expectEqual(ar, br);

    const c = new NoiseSweep(SR);
    c.setAmount(NaN);
    const cl = inL.slice();
    const cr = inR.slice();
    c.process(cl, cr, cl.length);
    expectEqual(cl, inL);
    expectEqual(cr, inR);
  });
});

describe('NoiseSweep reference', () => {
  it('matches the reference exactly at amount 1', () => {
    const got = fromReset(7, 1, 4800);
    const want = reference(7, 1, 4800);
    expect(maxDiff(got.l, want.l)).toBeLessThan(1e-6);
    expect(maxDiff(got.r, want.r)).toBeLessThan(1e-6);
    expect(peak(want.l)).toBeGreaterThan(0.05);
  });

  it('matches the reference at other amounts and another seed', () => {
    const cases: Array<[number, number]> = [
      [7, 0.25],
      [7, 0.5],
      [7, 0.8],
      [12345, 0.6],
    ];
    for (const [seed, a] of cases) {
      const got = fromReset(seed, a, 4800);
      const want = reference(seed, a, 4800);
      expect(maxDiff(got.l, want.l)).toBeLessThan(1e-6);
      expect(maxDiff(got.r, want.r)).toBeLessThan(1e-6);
      expect(peak(want.l)).toBeGreaterThan(0.005);
    }
  });

  it('applies the amount at once after reset(), with no glide from 0', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(0.9);
    fx.reset();
    const l = silence(20);
    const r = silence(20);
    fx.process(l, r, 20);
    const want = reference(7, 0.9, 20);
    for (let i = 0; i < 20; i++) {
      expect(l[i]).toBeCloseTo(want.l[i], 6);
      expect(r[i]).toBeCloseTo(want.r[i], 6);
    }
    expect(Math.abs(want.l[0])).toBeGreaterThan(1e-3);
    expect(Math.abs(want.r[0])).toBeGreaterThan(1e-3);
  });
});

describe('NoiseSweep sound', () => {
  it('passes the dry input untouched at any amount', () => {
    const inL = noise(10000, 1);
    const inR = noise(10000, 2);
    const withInput = new NoiseSweep(SR, 9);
    const withSilence = new NoiseSweep(SR, 9);
    for (const fx of [withInput, withSilence]) {
      fx.setAmount(0.7);
      fx.reset();
    }
    const l = inL.slice();
    const r = inR.slice();
    const sl = silence(10000);
    const sr = silence(10000);
    withInput.process(l, r, l.length);
    withSilence.process(sl, sr, sl.length);
    let worst = 0;
    for (let i = 0; i < l.length; i++) {
      worst = Math.max(worst, Math.abs(l[i] - sl[i] - inL[i]), Math.abs(r[i] - sr[i] - inR[i]));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('puts the loudest noise between -20 and -3 dBFS at amount 1', () => {
    const { l, r } = fromReset(7, 1, 2 * SR);
    for (const ch of [l, r]) {
      const db = toDb(rms(ch));
      expect(db).toBeGreaterThan(-20);
      expect(db).toBeLessThan(-3);
    }
  });

  it('gets louder with more amount', () => {
    let last = 0;
    for (const a of [0.25, 0.5, 0.75, 1]) {
      const level = rms(fromReset(7, a, SR).l);
      expect(level).toBeGreaterThan(last);
      last = level;
    }
  });

  it('gets brighter with more amount', () => {
    const high = highShare(fromReset(7, 0.9, SR).l);
    const low = highShare(fromReset(7, 0.2, SR).l);
    // measured: 0.916 at amount 0.9 and 0.304 at amount 0.2 (a band-pass with q 0.8 is wide)
    expect(high).toBeGreaterThan(0.6);
    expect(low).toBeLessThan(0.4);
    expect(high - low).toBeGreaterThan(0.4);
  });

  it('is band-passed: noise at amount 1 has little energy far below the centre', () => {
    const { l } = fromReset(7, 1, SR);
    const lowPart = new Biquad();
    lowPart.setLowpass(1000, 0.7071, SR);
    const y = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) y[i] = lowPart.process(l[i]);
    expect(rms(y) / rms(l)).toBeLessThan(0.2);
  });

  it('plays different noise on the left and right channels', () => {
    const { l, r } = fromReset(7, 1, SR);
    expect(Math.abs(correlation(l, r))).toBeLessThan(0.05);
    expect(maxDiff(l, r)).toBeGreaterThan(0.01);
  });

  it('stays finite and bounded over 10 s at amount 1', () => {
    const { l, r } = fromReset(7, 1, 10 * SR);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(peak(l)).toBeLessThan(0.8);
    expect(peak(r)).toBeLessThan(0.8);
  });
});

describe('NoiseSweep determinism and seeds', () => {
  it('is deterministic and depends on the seed', () => {
    const a = fromReset(7, 0.8, 5000);
    const b = fromReset(7, 0.8, 5000);
    const c = fromReset(8, 0.8, 5000);
    expectEqual(a.l, b.l);
    expectEqual(a.r, b.r);
    expect(maxDiff(a.l, c.l)).toBeGreaterThan(0.01);
    expect(maxDiff(a.r, c.r)).toBeGreaterThan(0.01);
  });

  it('uses seed 7 by default', () => {
    const a = new NoiseSweep(SR);
    const b = new NoiseSweep(SR, 7);
    a.setAmount(1);
    b.setAmount(1);
    const al = silence(5000);
    const ar = silence(5000);
    const bl = silence(5000);
    const br = silence(5000);
    a.process(al, ar, 5000);
    b.process(bl, br, 5000);
    expectEqual(al, bl);
    expectEqual(ar, br);
    expect(peak(al)).toBeGreaterThan(0);
  });

  it('accepts negative, fractional and very large seeds', () => {
    for (const seed of [-1, -123456, 1.5, 0.25, 2 ** 40, 2 ** 53, 0xffffffff]) {
      const fx = new NoiseSweep(SR, seed);
      fx.setAmount(1);
      const l = silence(500);
      const r = silence(500);
      expect(() => fx.process(l, r, 500)).not.toThrow();
      expect(allFinite(l)).toBe(true);
    }
  });

  it('throws RangeError for an invalid sample rate', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => new NoiseSweep(sr)).toThrow(RangeError);
    }
  });
});

describe('NoiseSweep glide and reset', () => {
  it('glides to a new amount instead of jumping', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(1);
    const n = 2 * SR;
    const l = silence(n);
    const r = silence(n);
    fx.process(l, r, n);
    const first = rms(l, 0, 48);
    const last = rms(l, n - SR, n);
    expect(first).toBeLessThan(0.05 * last);
    const settled = rms(fromReset(7, 1, 2 * SR).l);
    expect(Math.abs(toDb(last) - toDb(settled))).toBeLessThan(1);
  });

  it('restarts the noise sequence on reset()', () => {
    const fx = new NoiseSweep(SR, 7);
    fx.setAmount(0.5);
    fx.process(silence(SR), silence(SR), SR);
    fx.reset();
    const l = silence(5000);
    const r = silence(5000);
    fx.process(l, r, 5000);
    const want = fromReset(7, 0.5, 5000);
    expectEqual(l, want.l);
    expectEqual(r, want.r);
  });

  it('applies the new filter setting after a reset that follows an amount change', () => {
    // run at 1, drop to 0.1 and reset: the filters must be set for 0.1, not stay at 1
    const fx = new NoiseSweep(SR, 7);
    fx.setAmount(1);
    fx.process(silence(SR / 2), silence(SR / 2), SR / 2);
    fx.setAmount(0.1);
    fx.reset();
    const l = silence(4800);
    const r = silence(4800);
    fx.process(l, r, 4800);
    const want = reference(7, 0.1, 4800);
    expect(maxDiff(l, want.l)).toBeLessThan(1e-6);
    expect(maxDiff(r, want.r)).toBeLessThan(1e-6);
  });
});

describe('NoiseSweep buffers', () => {
  it('respects frames and leaves the rest untouched', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(1);
    fx.reset();
    const inL = noise(200, 1);
    const inR = noise(200, 2);
    const l = inL.slice();
    const r = inR.slice();
    fx.process(l, r, 100);
    expectEqual(l.subarray(100), inL.subarray(100));
    expectEqual(r.subarray(100), inR.subarray(100));
    expect(maxDiff(l.subarray(0, 100), inL.subarray(0, 100))).toBeGreaterThan(0.01);
  });

  it('handles negative, NaN and oversize frames without throwing or writing out of range', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(1);
    fx.reset();
    const inL = noise(200, 1);
    const inR = noise(200, 2);
    for (const frames of [-5, NaN, -Infinity, 0, 0.9]) {
      const l = inL.slice();
      const r = inR.slice();
      expect(() => fx.process(l, r, frames)).not.toThrow();
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
    for (const frames of [1e9, Infinity]) {
      const l = inL.slice();
      const r = inR.slice(0, 150);
      expect(() => fx.process(l, r, frames)).not.toThrow();
      expect(l.length).toBe(200);
      expect(r.length).toBe(150);
      // only the shorter buffer's length is processed
      expectEqual(l.subarray(150), inL.subarray(150));
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
    }
  });

  it('floors a fractional frames count', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(1);
    fx.reset();
    const inL = noise(50, 1);
    const l = inL.slice();
    fx.process(l, inL.slice(), 10.9);
    expectEqual(l.subarray(10), inL.subarray(10));
    expect(maxDiff(l.subarray(0, 10), inL.subarray(0, 10))).toBeGreaterThan(0);
  });

  it('treats NaN and Infinity input like 0', () => {
    const dirtyL = noise(3000, 1);
    const dirtyR = noise(3000, 2);
    dirtyL[10] = NaN;
    dirtyL[500] = Infinity;
    dirtyL[501] = -Infinity;
    dirtyR[0] = NaN;
    dirtyR[2999] = Infinity;
    const cleanL = dirtyL.slice();
    const cleanR = dirtyR.slice();
    for (const i of [10, 500, 501]) cleanL[i] = 0;
    for (const i of [0, 2999]) cleanR[i] = 0;
    const a = new NoiseSweep(SR);
    const b = new NoiseSweep(SR);
    for (const fx of [a, b]) {
      fx.setAmount(0.6);
      fx.reset();
    }
    a.process(dirtyL, dirtyR, 3000);
    b.process(cleanL, cleanR, 3000);
    expect(allFinite(dirtyL)).toBe(true);
    expect(allFinite(dirtyR)).toBe(true);
    expectEqual(dirtyL, cleanL);
    expectEqual(dirtyR, cleanR);
  });

  it('gives the same output whatever the block size, also across an amount change', () => {
    const n = 10000;
    const split = 4000;
    const inL = noise(n, 1);
    const inR = noise(n, 2);

    const blocked = new NoiseSweep(SR);
    const bl = inL.slice();
    const br = inR.slice();
    blocked.setAmount(0.3);
    runBlocks((l, r, f) => blocked.process(l, r, f), bl.subarray(0, split), br.subarray(0, split), 128);
    blocked.setAmount(0.9);
    runBlocks((l, r, f) => blocked.process(l, r, f), bl.subarray(split), br.subarray(split), 128);

    const big = new NoiseSweep(SR);
    const gl = inL.slice();
    const gr = inR.slice();
    big.setAmount(0.3);
    big.process(gl.subarray(0, split), gr.subarray(0, split), split);
    big.setAmount(0.9);
    big.process(gl.subarray(split), gr.subarray(split), n - split);

    expectEqual(bl, gl);
    expectEqual(br, gr);
    expect(maxDiff(bl, inL)).toBeGreaterThan(0.01);
  });

  it('adds noise on top of a sine without changing the sine', () => {
    const fx = new NoiseSweep(SR);
    fx.setAmount(0.5);
    fx.reset();
    const tone = sine(440, 0.5, SR, 0.5);
    const l = tone.slice();
    const r = tone.slice();
    fx.process(l, r, l.length);
    const added = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) added[i] = l[i] - tone[i];
    const want = fromReset(7, 0.5, l.length).l;
    expect(maxDiff(added, want)).toBeLessThan(1e-6);
  });
});
