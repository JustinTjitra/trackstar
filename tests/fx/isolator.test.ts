import { describe, expect, it } from 'vitest';
import { ThreeBand } from '../../src/fx/dsp/crossover';
import { Smoother } from '../../src/fx/dsp/smoother';
import { dbToGain } from '../../src/fx/dsp/math';
import { Isolator, isolatorGain } from '../../src/fx/effects/isolator';
import { allFinite, noise, peak, rms, runBlocks, silence, sine, toDb } from '../fixtures/synthAudio';

const SR = 48000;

type Pair = { l: Float32Array; r: Float32Array };

/** What the isolator must output after setting the three controls and reset(), built from a fresh ThreeBand per channel. */
function reference(a: number, b: number, c: number, inL: Float32Array, inR: Float32Array): Pair {
  const ga = isolatorGain(a);
  const gb = isolatorGain(b);
  const gc = isolatorGain(c);
  const splitL = new ThreeBand(SR);
  const splitR = new ThreeBand(SR);
  const l = new Float32Array(inL.length);
  const r = new Float32Array(inR.length);
  for (let i = 0; i < inL.length; i++) {
    splitL.process(inL[i]);
    l[i] = ga * splitL.low + gb * splitL.mid + gc * splitL.high;
  }
  for (let i = 0; i < inR.length; i++) {
    splitR.process(inR[i]);
    r[i] = ga * splitR.low + gb * splitR.mid + gc * splitR.high;
  }
  return { l, r };
}

/** Isolator with the controls set at once (setters then reset), fed copies of the inputs. */
function fromReset(a: number, b: number, c: number, inL: Float32Array, inR: Float32Array): Pair {
  const iso = new Isolator(SR);
  iso.setLow(a);
  iso.setMid(b);
  iso.setHigh(c);
  iso.reset();
  const l = inL.slice();
  const r = inR.slice();
  iso.process(l, r, l.length);
  return { l, r };
}

const toneCache = new Map<string, number>();

/** Level of a 2 s sine (amplitude 0.5) after the isolator, relative to the input, over the last 0.5 s, in dB. */
function toneGainDb(a: number, b: number, c: number, freq: number): number {
  const key = `${a}/${b}/${c}/${freq}`;
  const cached = toneCache.get(key);
  if (cached !== undefined) return cached;
  const x = sine(freq, 2, SR, 0.5);
  const out = fromReset(a, b, c, x, x);
  const from = 1.5 * SR;
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

describe('isolatorGain', () => {
  it('has the documented values', () => {
    expect(isolatorGain(0)).toBe(0);
    expect(isolatorGain(0.25)).toBeCloseTo(0.25, 12);
    expect(isolatorGain(0.5)).toBe(1);
    expect(isolatorGain(0.75)).toBeCloseTo(1.4976, 4);
    expect(isolatorGain(1)).toBeCloseTo(dbToGain(6), 12);
  });

  it('clamps values outside 0..1 and treats NaN as unity', () => {
    expect(isolatorGain(-3)).toBe(0);
    expect(isolatorGain(7)).toBeCloseTo(dbToGain(6), 12);
    expect(isolatorGain(NaN)).toBe(1);
  });

  it('never decreases and is continuous at 0.5', () => {
    let prev = isolatorGain(0);
    for (let k = 1; k <= 1000; k++) {
      const g = isolatorGain(k / 1000);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(Math.abs(isolatorGain(0.5 - 1e-9) - 1)).toBeLessThan(1e-6);
    expect(Math.abs(isolatorGain(0.5 + 1e-9) - 1)).toBeLessThan(1e-6);
  });
});

describe('Isolator neutral', () => {
  it('keeps the level of every frequency', () => {
    for (const f of [60, 300, 1000, 3000, 10000]) {
      expect(Math.abs(toneGainDb(0.5, 0.5, 0.5, f))).toBeLessThan(0.1);
    }
  });

  it('is exactly the crossover sum low + mid + high, not the input', () => {
    const inL = noise(SR / 2, 1);
    const inR = noise(SR / 2, 2);
    const iso = new Isolator(SR);
    const l = inL.slice();
    const r = inR.slice();
    iso.process(l, r, l.length);
    const splitL = new ThreeBand(SR);
    const splitR = new ThreeBand(SR);
    const wantL = new Float32Array(l.length);
    const wantR = new Float32Array(r.length);
    for (let i = 0; i < l.length; i++) {
      splitL.process(inL[i]);
      wantL[i] = splitL.low + splitL.mid + splitL.high;
      splitR.process(inR[i]);
      wantR[i] = splitR.low + splitR.mid + splitR.high;
    }
    expect(maxDiff(l, wantL)).toBeLessThan(1e-6);
    expect(maxDiff(r, wantR)).toBeLessThan(1e-6);
    // the crossover shifts the phase, so this is not a pass-through
    expect(maxDiff(l, inL)).toBeGreaterThan(0.05);
  });
});

describe('Isolator kill', () => {
  it('kills the low band and leaves the highs', () => {
    expect(toneGainDb(0, 0.5, 0.5, 60)).toBeLessThan(-40);
    expect(Math.abs(toneGainDb(0, 0.5, 0.5, 5000))).toBeLessThan(0.5);
  });

  it('kills the mid band and leaves the lows and highs', () => {
    expect(toneGainDb(0.5, 0, 0.5, 1000)).toBeLessThan(-30);
    expect(Math.abs(toneGainDb(0.5, 0, 0.5, 60))).toBeLessThan(0.5);
    expect(Math.abs(toneGainDb(0.5, 0, 0.5, 10000))).toBeLessThan(0.5);
  });

  it('kills the high band and leaves the lows', () => {
    expect(toneGainDb(0.5, 0.5, 0, 10000)).toBeLessThan(-38);
    expect(Math.abs(toneGainDb(0.5, 0.5, 0, 60))).toBeLessThan(0.5);
  });
});

describe('Isolator boost and curve', () => {
  const centres = [60, 1000, 10000];

  it('lifts only the boosted band by 6 dB', () => {
    for (let band = 0; band < 3; band++) {
      const v = [0.5, 0.5, 0.5];
      v[band] = 1;
      centres.forEach((f, k) => {
        const g = toneGainDb(v[0], v[1], v[2], f);
        if (k === band) expect(Math.abs(g - 6.02)).toBeLessThan(0.3);
        else expect(Math.abs(g)).toBeLessThan(0.5);
      });
    }
  });

  it('follows the curve between the ends', () => {
    expect(Math.abs(toneGainDb(0.25, 0.5, 0.5, 60) - -12.04)).toBeLessThan(0.3);
    expect(Math.abs(toneGainDb(0.75, 0.5, 0.5, 60) - 3.51)).toBeLessThan(0.3);
  });
});

describe('Isolator reference', () => {
  it('matches the crossover sum with the curve gains', () => {
    const inL = noise(SR / 2, 11);
    const inR = noise(SR / 2, 12);
    const triples: Array<[number, number, number]> = [
      [0, 0.5, 1],
      [1, 0, 0.5],
      [0.3, 0.8, 0.1],
      [0.5, 0.5, 0.5],
      [0.9, 0.2, 0],
    ];
    for (const [a, b, c] of triples) {
      const got = fromReset(a, b, c, inL, inR);
      const want = reference(a, b, c, inL, inR);
      expect(maxDiff(got.l, want.l)).toBeLessThan(1e-6);
      expect(maxDiff(got.r, want.r)).toBeLessThan(1e-6);
    }
    // the references really differ from each other
    const p = reference(0, 0.5, 1, inL, inR);
    const q = reference(1, 0, 0.5, inL, inR);
    expect(maxDiff(p.l, q.l)).toBeGreaterThan(0.1);
  });

  it('gives silence with everything killed', () => {
    const out = fromReset(0, 0, 0, noise(SR / 2, 3), noise(SR / 2, 4));
    expect(peak(out.l)).toBe(0);
    expect(peak(out.r)).toBe(0);
  });

  it('is 6 dB louder with everything boosted', () => {
    const inL = noise(2 * SR, 5);
    const inR = noise(2 * SR, 6);
    const neutral = fromReset(0.5, 0.5, 0.5, inL, inR);
    const boosted = fromReset(1, 1, 1, inL, inR);
    expect(Math.abs(toDb(rms(boosted.l)) - toDb(rms(neutral.l)) - 6.02)).toBeLessThan(0.05);
    expect(Math.abs(toDb(rms(boosted.r)) - toDb(rms(neutral.r)) - 6.02)).toBeLessThan(0.05);
  });
});

describe('Isolator glide', () => {
  it('moves from the old gain to the new one without a step', () => {
    const first = 48200;
    const second = SR;
    const all = sine(60, (first + second) / SR, SR, 0.5);
    const iso = new Isolator(SR);
    const l1 = all.slice(0, first);
    const r1 = all.slice(0, first);
    iso.process(l1, r1, first);
    iso.setLow(0);
    const l2 = all.slice(first);
    const r2 = all.slice(first);
    iso.process(l2, r2, second);

    let step = Math.abs(l2[0] - l1[first - 1]);
    for (let i = 1; i < 100; i++) step = Math.max(step, Math.abs(l2[i] - l2[i - 1]));
    // the input's own largest step is about 0.004; a jump of the gain would step by about 0.5
    expect(step).toBeLessThan(0.02);
    // the band really was killed in the end
    expect(rms(l2, second - SR / 2, second)).toBeLessThan(0.01);
    expect(allFinite(l2)).toBe(true);
  });
});

describe('Isolator channels', () => {
  it('keeps the channels independent', () => {
    const left = noise(SR / 2, 21);
    const out = fromReset(0.2, 0.9, 0.6, left, silence(SR / 2));
    expect(peak(out.l)).toBeGreaterThan(0.1);
    expect(peak(out.r)).toBe(0);
  });
});

describe('Isolator reset', () => {
  it('clears the filter memory and keeps the settings', () => {
    const iso = new Isolator(SR);
    iso.setLow(1);
    iso.setMid(1);
    iso.setHigh(1);
    iso.process(noise(SR, 31), noise(SR, 32), SR);
    iso.reset();
    const sl = silence(SR);
    const sr = silence(SR);
    iso.process(sl, sr, SR);
    expect(peak(sl)).toBe(0);
    expect(peak(sr)).toBe(0);

    const inL = noise(5000, 33);
    const inR = noise(5000, 34);
    const l = inL.slice();
    const r = inR.slice();
    iso.process(l, r, l.length);
    const want = fromReset(1, 1, 1, inL, inR);
    expectEqual(l, want.l);
    expectEqual(r, want.r);
  });

  it('ends a glide', () => {
    const x = sine(60, 0.1, SR, 0.5).subarray(200);
    const iso = new Isolator(SR);
    iso.setLow(0);
    iso.reset();
    const l = x.slice();
    const r = x.slice();
    iso.process(l, r, l.length);
    const want = reference(0, 0.5, 0.5, x, x);
    const n = 400;
    expect(maxDiff(l.subarray(0, n), want.l.subarray(0, n))).toBeLessThan(1e-6);

    // without the reset the first samples glide from unity and differ clearly
    const gliding = new Isolator(SR);
    gliding.setLow(0);
    const gl = x.slice();
    gliding.process(gl, x.slice(), gl.length);
    expect(maxDiff(gl.subarray(0, n), want.l.subarray(0, n))).toBeGreaterThan(0.005);
  });
});

describe('Isolator setters', () => {
  const inL = noise(20000, 1);
  const inR = noise(20000, 2);
  const run = (set: (iso: Isolator) => void): Pair => {
    const iso = new Isolator(SR);
    set(iso);
    iso.reset();
    const l = inL.slice();
    const r = inR.slice();
    iso.process(l, r, l.length);
    return { l, r };
  };

  it('clamps out of range values', () => {
    const big = run((iso) => iso.setLow(5));
    const one = run((iso) => iso.setLow(1));
    expectEqual(big.l, one.l);
    expectEqual(big.r, one.r);
    const low = run((iso) => iso.setLow(-3));
    const zero = run((iso) => iso.setLow(0));
    expectEqual(low.l, zero.l);
    expectEqual(low.r, zero.r);
    expect(maxDiff(one.l, zero.l)).toBeGreaterThan(0.1);
  });

  it('ignores non-finite values', () => {
    const base = run(() => {});
    const dirty = run((iso) => {
      iso.setMid(NaN);
      iso.setHigh(Infinity);
      iso.setLow(-Infinity);
    });
    expectEqual(dirty.l, base.l);
    expectEqual(dirty.r, base.r);

    const half = run((iso) => iso.setMid(0.2));
    const after = run((iso) => {
      iso.setMid(0.2);
      iso.setMid(NaN);
    });
    expectEqual(after.l, half.l);
    expect(maxDiff(half.l, base.l)).toBeGreaterThan(0.05);
  });
});

describe('Isolator buffers', () => {
  it('respects frames and leaves the rest untouched', () => {
    const iso = new Isolator(SR);
    iso.setLow(0);
    iso.reset();
    const inL = noise(200, 1);
    const inR = noise(200, 2);
    const l = inL.slice();
    const r = inR.slice();
    iso.process(l, r, 100);
    expectEqual(l.subarray(100), inL.subarray(100));
    expectEqual(r.subarray(100), inR.subarray(100));
    expect(maxDiff(l.subarray(0, 100), inL.subarray(0, 100))).toBeGreaterThan(0.01);
  });

  it('handles negative, NaN, fractional and oversize frames', () => {
    const iso = new Isolator(SR);
    const inL = noise(200, 1);
    const inR = noise(200, 2);
    for (const frames of [-5, NaN, -Infinity, 0, 0.9]) {
      const l = inL.slice();
      const r = inR.slice();
      expect(() => iso.process(l, r, frames)).not.toThrow();
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
    for (const frames of [1e9, Infinity]) {
      const l = inL.slice();
      const r = inR.slice(0, 150);
      expect(() => iso.process(l, r, frames)).not.toThrow();
      expect(l.length).toBe(200);
      expect(r.length).toBe(150);
      expectEqual(l.subarray(150), inL.subarray(150));
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
    }
    const l = inL.slice();
    iso.process(l, inR.slice(), 10.9);
    expectEqual(l.subarray(10), inL.subarray(10));
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
    const a = fromReset(0.2, 0.7, 1, dirtyL, dirtyR);
    const b = fromReset(0.2, 0.7, 1, cleanL, cleanR);
    expect(allFinite(a.l)).toBe(true);
    expect(allFinite(a.r)).toBe(true);
    expectEqual(a.l, b.l);
    expectEqual(a.r, b.r);
    expect(peak(a.l)).toBeGreaterThan(0.1);
  });

  it('gives the same output whatever the block size, also across a control change', () => {
    const n = 10000;
    const split = 4000;
    const inL = noise(n, 1);
    const inR = noise(n, 2);

    const blocked = new Isolator(SR);
    const bl = inL.slice();
    const br = inR.slice();
    blocked.setHigh(0.1);
    runBlocks((l, r, f) => blocked.process(l, r, f), bl.subarray(0, split), br.subarray(0, split), 128);
    blocked.setHigh(0.9);
    blocked.setLow(0.3);
    runBlocks((l, r, f) => blocked.process(l, r, f), bl.subarray(split), br.subarray(split), 128);

    const big = new Isolator(SR);
    const gl = inL.slice();
    const gr = inR.slice();
    big.setHigh(0.1);
    big.process(gl.subarray(0, split), gr.subarray(0, split), split);
    big.setHigh(0.9);
    big.setLow(0.3);
    big.process(gl.subarray(split), gr.subarray(split), n - split);

    expectEqual(bl, gl);
    expectEqual(br, gr);
    expect(maxDiff(bl, inL)).toBeGreaterThan(0.01);
  });
});

describe('Isolator constructor', () => {
  it('throws RangeError for an invalid sample rate', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => new Isolator(sr)).toThrow(RangeError);
    }
  });
});

describe('Isolator glide', () => {
  // While a control is moving, each band's GAIN follows a 20 ms smoother from its old value to
  // its new one. This rebuilds that from the blocks: one crossover per channel and one smoother
  // per band, in the gain domain. It pins the glide time and the fact that the gains are
  // smoothed (smoothing the control values instead would bend the curve through the gain law).
  it('follows the smoother curve sample for sample while two bands move', () => {
    const iso = new Isolator(SR);
    const refL = new ThreeBand(SR);
    const refR = new ThreeBand(SR);
    const low = new Smoother(SR, 20, 1);
    const mid = new Smoother(SR, 20, 1);
    const high = new Smoother(SR, 20, 1);
    const before = 2400;
    const after = 4800;
    const inL = noise(before + after, 31, 0.5);
    const inR = noise(before + after, 32, 0.5);
    const outL = inL.slice();
    const outR = inR.slice();

    iso.process(outL.subarray(0, before), outR.subarray(0, before), before);
    iso.setLow(0);
    iso.setHigh(1);
    iso.process(outL.subarray(before), outR.subarray(before), after);

    let worst = 0;
    let lowAtOneTimeConstant = -1;
    for (let i = 0; i < before + after; i++) {
      if (i === before) {
        low.setTarget(0);
        high.setTarget(dbToGain(6));
      }
      const gl = low.next();
      const gm = mid.next();
      const gh = high.next();
      if (i === before + 959) lowAtOneTimeConstant = gl;
      refL.process(inL[i]);
      refR.process(inR[i]);
      worst = Math.max(
        worst,
        Math.abs(outL[i] - (gl * refL.low + gm * refL.mid + gh * refL.high)),
        Math.abs(outR[i] - (gl * refR.low + gm * refR.mid + gh * refR.high)),
      );
    }
    expect(worst).toBeLessThan(1e-6);
    // one time constant (960 samples) after the change the low gain has fallen to 1/e
    expect(lowAtOneTimeConstant).toBeCloseTo(Math.exp(-1), 3);
  });
});
