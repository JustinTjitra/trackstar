import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { expLerp, lerp } from '../../src/fx/dsp/math';
import { Reverb } from '../../src/fx/dsp/reverb';
import { Svf } from '../../src/fx/dsp/svf';
import { ReverbSweep } from '../../src/fx/effects/reverbSweep';
import type { SceneDirection } from '../../src/fx/types';
import { allFinite, impulse, noise, peak, rms, runBlocks, silence, sine, toDb } from '../fixtures/synthAudio';

const SR = 48000;
const DIRS: SceneDirection[] = ['up', 'down'];

type Pair = { l: Float32Array; r: Float32Array };

/** What the effect must output after setAmount(a) and reset(), built from the building blocks. */
function reference(dir: SceneDirection, a: number, inL: Float32Array, inR: Float32Array): Pair {
  const up = dir === 'up';
  const reverb = new Reverb(SR);
  reverb.setRoomSize(lerp(0.5, 0.85, a));
  const sendL = new Biquad();
  const sendR = new Biquad();
  sendL.setHighpass(120, 0.7071, SR);
  sendR.setHighpass(120, 0.7071, SR);
  const cutoff = up ? expLerp(20, 1500, a) : expLerp(18000, 500, a);
  const svfL = new Svf(SR);
  const svfR = new Svf(SR);
  svfL.set(cutoff, 0.7071);
  svfR.set(cutoff, 0.7071);
  const wet = 0.6 * a;
  const m = a >= 0.02 ? 1 : a / 0.02;
  const outL = new Float32Array(inL.length);
  const outR = new Float32Array(inR.length);
  for (let i = 0; i < inL.length; i++) {
    const xl = inL[i];
    const xr = inR[i];
    reverb.process(sendL.process(xl), sendR.process(xr));
    svfL.process(xl + wet * reverb.outL);
    svfR.process(xr + wet * reverb.outR);
    const fl = up ? svfL.hp : svfL.lp;
    const fr = up ? svfR.hp : svfR.lp;
    outL[i] = xl + m * (fl - xl);
    outR[i] = xr + m * (fr - xr);
  }
  return { l: outL, r: outR };
}

/** Effect set to amount `a` at once (setAmount then reset), fed copies of the inputs. */
function fromReset(dir: SceneDirection, a: number, inL: Float32Array, inR: Float32Array): Pair {
  const fx = new ReverbSweep(SR, dir);
  fx.setAmount(a);
  fx.reset();
  const l = inL.slice();
  const r = inR.slice();
  fx.process(l, r, l.length);
  return { l, r };
}

const toneCache = new Map<string, number>();

/** Level of a 3 s sine (amplitude 0.5) after the effect, relative to the input, over the last 0.5 s, in dB. */
function toneGainDb(dir: SceneDirection, a: number, freq: number): number {
  const key = `${dir}/${a}/${freq}`;
  const cached = toneCache.get(key);
  if (cached !== undefined) return cached;
  const x = sine(freq, 3, SR, 0.5);
  const out = fromReset(dir, a, x, x);
  const from = 2.5 * SR;
  const gain = toDb(rms(out.l, from, x.length)) - toDb(rms(x, from, x.length));
  toneCache.set(key, gain);
  return gain;
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

function tailDb(x: Float32Array, fromS: number, toS: number): number {
  return toDb(rms(x, Math.round(fromS * SR), Math.round(toS * SR)));
}

function constant(n: number, v: number): Float32Array {
  return new Float32Array(n).fill(v);
}

describe('ReverbSweep identity', () => {
  it('leaves noise on both channels bit-identical at amount 0', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      const inL = noise(5000, 1);
      const inR = noise(5000, 2);
      const l = inL.slice();
      const r = inR.slice();
      fx.process(l, r, l.length);
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
  });

  it('returns to bit-identical output after the amount goes back to 0', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      fx.setAmount(0.8);
      fx.process(noise(SR, 3), noise(SR, 4), SR);
      fx.setAmount(0);
      fx.process(noise(SR, 5), noise(SR, 6), SR);
      const inL = noise(5000, 7);
      const inR = noise(5000, 8);
      const l = inL.slice();
      const r = inR.slice();
      fx.process(l, r, l.length);
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
  });
});

describe('ReverbSweep reference', () => {
  it('matches the chain built from the building blocks', () => {
    const inL = noise(SR / 2, 11);
    const inR = noise(SR / 2, 12);
    for (const dir of DIRS) {
      for (const a of [0.01, 0.3, 0.7, 1]) {
        const got = fromReset(dir, a, inL, inR);
        const want = reference(dir, a, inL, inR);
        expect(maxDiff(got.l, want.l)).toBeLessThan(1e-5);
        expect(maxDiff(got.r, want.r)).toBeLessThan(1e-5);
        // the reference must differ from the input, or the test would prove nothing
        expect(maxDiff(want.l, inL)).toBeGreaterThan(0.001);
      }
    }
  });
});

describe('ReverbSweep filter', () => {
  it('up thins: a 100 Hz tone is cut at amount 1', () => {
    const g = toneGainDb('up', 1, 100);
    expect(g).toBeLessThan(-20);
  });

  it('down muffles: an 8 kHz tone is cut at amount 1', () => {
    const g = toneGainDb('down', 1, 8000);
    expect(g).toBeLessThan(-20);
  });

  it('the other side of each filter survives', () => {
    const up = toneGainDb('up', 1, 8000);
    const down = toneGainDb('down', 1, 200);
    for (const g of [up, down]) {
      expect(g).toBeGreaterThan(-3);
      expect(g).toBeLessThan(16);
    }
  });

  it('filters less at a low amount', () => {
    const up = toneGainDb('up', 0.3, 100);
    const down = toneGainDb('down', 0.3, 8000);
    expect(up).toBeGreaterThan(-12);
    expect(down).toBeGreaterThan(-12);
    expect(up).toBeGreaterThan(toneGainDb('up', 1, 100) + 10);
    expect(down).toBeGreaterThan(toneGainDb('down', 1, 8000) + 10);
  });

  it('does not let bass build up in the reverb', () => {
    const g = toneGainDb('down', 1, 40);
    expect(g).toBeLessThan(3);
  });
});

describe('ReverbSweep tail', () => {
  const hit = impulse(2 * SR);

  it('leaves a tail after an impulse', () => {
    for (const dir of DIRS) {
      const out = fromReset(dir, 0.7, hit, hit);
      const db = tailDb(out.l, 0.2, 0.4);
      expect(db).toBeGreaterThan(-70);
    }
  });

  it('has a longer and louder tail with more amount', () => {
    for (const dir of DIRS) {
      const high = tailDb(fromReset(dir, 0.9, hit, hit).l, 1.0, 1.5);
      const low = tailDb(fromReset(dir, 0.3, hit, hit).l, 1.0, 1.5);
      expect(high - low).toBeGreaterThanOrEqual(10);
    }
  });

  it('is one shared space: input on the left reaches the right', () => {
    const left = noise(SR, 21);
    const none = silence(SR);
    const wet = fromReset('down', 0.7, left, none);
    expect(rms(wet.r)).toBeGreaterThan(1e-4);
    const dry = fromReset('down', 0, left, none);
    expectEqual(dry.r, none);
  });
});

describe('ReverbSweep stability', () => {
  it('does not build up on a steady input', () => {
    const x = constant(8 * SR, 0.5);
    for (const dir of DIRS) {
      const out = fromReset(dir, 1, x, x);
      const p = Math.max(peak(out.l), peak(out.r));
      expect(Math.abs(out.l[out.l.length - 1] - (dir === 'down' ? 0.5 : 0))).toBeLessThan(1e-3);
      expect(Math.abs(out.r[out.r.length - 1] - (dir === 'down' ? 0.5 : 0))).toBeLessThan(1e-3);
      expect(p).toBeLessThan(1);
    }
  });

  it('stays finite and bounded on loud noise over 10 s at amount 1', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      fx.setAmount(1);
      const l = noise(10 * SR, 31);
      const r = noise(10 * SR, 32);
      fx.process(l, r, l.length);
      const p = Math.max(peak(l), peak(r));
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
      expect(p).toBeLessThan(8);
    }
  });
});

describe('ReverbSweep glide and reset', () => {
  // Right after the amount changes the glide has barely begun, so the first samples are still
  // almost the input; half a second later the effect is fully in. Measured with the glide: the
  // first three samples move by at most 0.06. With the amount jumping instead: 0.3 to 0.7.
  it('starts from where it was when the amount changes', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      fx.process(noise(SR, 21, 0.5), noise(SR, 22, 0.5), SR);
      fx.setAmount(1);
      const inL = noise(SR, 23, 0.5);
      const inR = noise(SR, 24, 0.5);
      const l = inL.slice();
      const r = inR.slice();
      fx.process(l, r, SR);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(l[i] - inL[i])).toBeLessThan(0.1);
        expect(Math.abs(r[i] - inR[i])).toBeLessThan(0.1);
      }
      const change = new Float32Array(SR / 2);
      for (let i = 0; i < change.length; i++) change[i] = l[SR / 2 + i] - inL[SR / 2 + i];
      expect(rms(change)).toBeGreaterThan(0.1);
    }
  });

  it('glides to a new amount without steps', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      const l0 = constant(SR, 0.5);
      const r0 = constant(SR, 0.5);
      fx.process(l0, r0, SR);
      fx.setAmount(1);
      const l = constant(SR, 0.5);
      const r = constant(SR, 0.5);
      fx.process(l, r, SR);
      // start with the step across the boundary between the two buffers: a jump of the amount
      // would land exactly there
      let step = Math.max(Math.abs(l[0] - l0[SR - 1]), Math.abs(r[0] - r0[SR - 1]));
      for (let i = 1; i < SR; i++) step = Math.max(step, Math.abs(l[i] - l[i - 1]), Math.abs(r[i] - r[i - 1]));
      // measured: 0.026 for up (the closing high-pass removes the 0.5 offset within about 20 ms), 0.00004 for down
      expect(step).toBeLessThan(0.05);
      // the amount really did move: the output ended up far from the input
      expect(Math.abs(l[SR - 1] - 0.5)).toBeGreaterThan(dir === 'up' ? 0.4 : 0);
      expect(allFinite(l)).toBe(true);
    }
  });

  it('reset() silences the tail and keeps the amount', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      fx.setAmount(0.8);
      fx.process(noise(SR, 41), noise(SR, 42), SR);
      fx.reset();
      const sl = silence(2 * SR);
      const sr = silence(2 * SR);
      fx.process(sl, sr, sl.length);
      expectEqual(sl, silence(2 * SR));
      expectEqual(sr, silence(2 * SR));

      const inL = noise(5000, 43);
      const inR = noise(5000, 44);
      const l = inL.slice();
      const r = inR.slice();
      fx.process(l, r, l.length);
      const want = fromReset(dir, 0.8, inL, inR);
      expectEqual(l, want.l);
      expectEqual(r, want.r);
      expect(maxDiff(l, inL)).toBeGreaterThan(0.01);
    }
  });

  it('applies the settings for the current amount after a reset that follows an amount change', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
      fx.setAmount(1);
      fx.process(noise(SR / 2, 1), noise(SR / 2, 2), SR / 2);
      fx.setAmount(0.4);
      fx.reset();
      const inL = noise(4800, 3);
      const inR = noise(4800, 4);
      const l = inL.slice();
      const r = inR.slice();
      fx.process(l, r, l.length);
      const want = reference(dir, 0.4, inL, inR);
      expect(maxDiff(l, want.l)).toBeLessThan(1e-5);
      expect(maxDiff(r, want.r)).toBeLessThan(1e-5);
    }
  });
});

describe('ReverbSweep setters', () => {
  it('clamps the amount and ignores non-finite values', () => {
    const inL = noise(20000, 1);
    const inR = noise(20000, 2);
    const run = (set: (fx: ReverbSweep) => void): Pair => {
      const fx = new ReverbSweep(SR, 'up');
      set(fx);
      const l = inL.slice();
      const r = inR.slice();
      fx.process(l, r, l.length);
      return { l, r };
    };
    const big = run((fx) => fx.setAmount(5));
    const one = run((fx) => fx.setAmount(1));
    expectEqual(big.l, one.l);
    expectEqual(big.r, one.r);
    expect(maxDiff(big.l, inL)).toBeGreaterThan(0.1);

    const low = run((fx) => fx.setAmount(-2));
    expectEqual(low.l, inL);
    expectEqual(low.r, inR);

    const half = run((fx) => fx.setAmount(0.5));
    const dirty = run((fx) => {
      fx.setAmount(0.5);
      fx.setAmount(NaN);
      fx.setAmount(Infinity);
      fx.setAmount(-Infinity);
    });
    expectEqual(dirty.l, half.l);
    expectEqual(dirty.r, half.r);

    const nan = run((fx) => fx.setAmount(NaN));
    expectEqual(nan.l, inL);
    expectEqual(nan.r, inR);
  });
});

describe('ReverbSweep buffers', () => {
  it('respects frames and leaves the rest untouched', () => {
    for (const dir of DIRS) {
      const fx = new ReverbSweep(SR, dir);
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
    }
  });

  it('handles negative, NaN and oversize frames without throwing or writing out of range', () => {
    const fx = new ReverbSweep(SR, 'up');
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
      expectEqual(l.subarray(150), inL.subarray(150));
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
    }
  });

  it('floors a fractional frames count', () => {
    const fx = new ReverbSweep(SR, 'down');
    fx.setAmount(1);
    fx.reset();
    const inL = noise(50, 1);
    const l = inL.slice();
    fx.process(l, inL.slice(), 10.9);
    expectEqual(l.subarray(10), inL.subarray(10));
    expect(maxDiff(l.subarray(0, 10), inL.subarray(0, 10))).toBeGreaterThan(0);
  });

  it('treats NaN and Infinity input like 0', () => {
    for (const dir of DIRS) {
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
      const a = new ReverbSweep(SR, dir);
      const b = new ReverbSweep(SR, dir);
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
      expect(peak(dirtyL)).toBeGreaterThan(0.1);
    }
  });

  it('gives the same output whatever the block size, also across an amount change', () => {
    const n = 10000;
    const split = 4000;
    const inL = noise(n, 1);
    const inR = noise(n, 2);
    for (const dir of DIRS) {
      const blocked = new ReverbSweep(SR, dir);
      const bl = inL.slice();
      const br = inR.slice();
      blocked.setAmount(0.3);
      runBlocks((l, r, f) => blocked.process(l, r, f), bl.subarray(0, split), br.subarray(0, split), 128);
      blocked.setAmount(0.9);
      runBlocks((l, r, f) => blocked.process(l, r, f), bl.subarray(split), br.subarray(split), 128);

      const big = new ReverbSweep(SR, dir);
      const gl = inL.slice();
      const gr = inR.slice();
      big.setAmount(0.3);
      big.process(gl.subarray(0, split), gr.subarray(0, split), split);
      big.setAmount(0.9);
      big.process(gl.subarray(split), gr.subarray(split), n - split);

      expectEqual(bl, gl);
      expectEqual(br, gr);
      expect(maxDiff(bl, inL)).toBeGreaterThan(0.01);
    }
  });
});

describe('ReverbSweep constructor', () => {
  it('throws RangeError for an invalid sample rate', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => new ReverbSweep(sr, 'up')).toThrow(RangeError);
    }
  });

  it('throws RangeError for an unknown direction', () => {
    expect(() => new ReverbSweep(SR, 'sideways' as SceneDirection)).toThrow(RangeError);
    expect(() => new ReverbSweep(SR, undefined as unknown as SceneDirection)).toThrow(RangeError);
  });
});
