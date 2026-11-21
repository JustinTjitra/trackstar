import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { Reverb } from '../../src/fx/dsp/reverb';
import { allFinite, noise, peak, rms, toDb } from '../fixtures/synthAudio';

const SR = 48000;

/** Wet output for an impulse on both inputs at sample 0, followed by silence. */
function impulseResponse(
  reverb: Reverb,
  seconds: number,
  sampleRate: number,
): { l: Float32Array; r: Float32Array } {
  const n = Math.round(seconds * sampleRate);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) reverb.process(1, 1);
    else reverb.process(0, 0);
    l[i] = reverb.outL;
    r[i] = reverb.outR;
  }
  return { l, r };
}

function firstNonZero(x: Float32Array): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== 0) return i;
  return -1;
}

/** RMS of x between two times in seconds. */
function win(x: Float32Array, from: number, to: number, sampleRate = SR): number {
  return rms(x, Math.round(from * sampleRate), Math.round(to * sampleRate));
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

describe('Reverb basics', () => {
  it('starts with both outputs at 0', () => {
    const r = new Reverb(SR);
    expect(r.outL).toBe(0);
    expect(r.outR).toBe(0);
  });

  it('gives exact silence for silent input', () => {
    const r = new Reverb(SR);
    for (let i = 0; i < 2000; i++) {
      r.process(0, 0);
      expect(r.outL).toBe(0);
      expect(r.outR).toBe(0);
    }
  });

  it('rejects invalid sample rates', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => new Reverb(sr)).toThrow(RangeError);
    }
  });
});

describe('Reverb delay lengths', () => {
  it('first echo arrives at the shortest comb length at 44100 Hz', () => {
    const { l, r } = impulseResponse(new Reverb(44100), 0.1, 44100);
    expect(firstNonZero(l)).toBe(1116);
    expect(firstNonZero(r)).toBe(1139);
  });

  it('first echo arrives at the scaled comb length at 48000 Hz', () => {
    const { l, r } = impulseResponse(new Reverb(48000), 0.1, 48000);
    expect(firstNonZero(l)).toBe(1215);
    expect(firstNonZero(r)).toBe(1240);
  });

  // The start of the impulse response follows directly from the delay lengths, so it pins
  // every one of them. Each comb's first echo passes straight through the four all-passes
  // (sign -1 each, so +1 overall) and lands at the comb's own length with value
  // 2 inputs * 0.015 * 3 = 0.09. An echo that detours through one all-pass delay arrives that
  // many samples later with the opposite sign; through the same all-pass twice it arrives at
  // half size (the all-pass feedback is 0.5); through two different all-passes it is positive
  // again. Left all-pass lengths are 556, 441, 341, 225; the right ones are 23 longer.
  // The left comb at 1557 is absent: it cancels exactly against 1116 + 441.
  it('the first 1720 samples match the echo pattern the delay lengths predict at 44100 Hz', () => {
    const { l, r } = impulseResponse(new Reverb(44100), 1720 / 44100, 44100);
    const pattern = (x: Float32Array): Record<string, number[]> => {
      const found: Record<string, number[]> = { plus: [], minus: [], halfMinus: [], other: [] };
      for (let i = 0; i < 1720; i++) {
        const v = x[i];
        if (v === 0) continue;
        if (Math.abs(v - 0.09) < 1e-6) found.plus.push(i);
        else if (Math.abs(v + 0.09) < 1e-6) found.minus.push(i);
        else if (Math.abs(v + 0.045) < 1e-6) found.halfMinus.push(i);
        else found.other.push(i);
      }
      return found;
    };
    expect(pattern(l)).toEqual({
      // comb lengths, plus 1682 = 1116 + 225 + 341
      plus: [1116, 1188, 1277, 1356, 1422, 1491, 1617, 1682],
      // comb length + one all-pass length
      minus: [1341, 1413, 1457, 1502, 1529, 1581, 1618, 1629, 1647, 1672, 1697, 1716, 1718],
      // comb length + 2 * 225
      halfMinus: [1566, 1638],
      other: [],
    });
    expect(l[1557]).toBe(0);
    expect(pattern(r)).toEqual({
      plus: [1139, 1211, 1300, 1379, 1445, 1514, 1580, 1640],
      minus: [1387, 1459, 1503, 1548, 1575, 1603, 1627, 1664, 1675, 1693, 1718],
      // comb length + 2 * 248
      halfMinus: [1635, 1707],
      other: [],
    });
  });
});

describe('Reverb tail', () => {
  const rv = new Reverb(SR);
  const ir = impulseResponse(rv, 3.2, SR);

  it('leaves a tail with default settings', () => {
    const db = toDb(win(ir.l, 0.05, 0.15));
    expect(db).toBeGreaterThan(-60);
  });

  it('has the level of eight combs and is diffused by the all-passes', () => {
    // eight combs: about -32.4 dB here; four combs would sit about 3 dB lower
    const db = toDb(win(ir.l, 0.05, 0.15));
    expect(db).toBeGreaterThan(-34);
    expect(db).toBeLessThan(-31);
    // all-passes smear each comb echo into many; bare combs give only a handful of non-zero samples
    let nonZero = 0;
    for (let i = 1215; i < 1215 + 2000; i++) if (ir.l[i] !== 0) nonZero++;
    expect(nonZero).toBeGreaterThan(500);
  });

  it('decays over time at room size 0.5', () => {
    const early = toDb(win(ir.l, 0.1, 0.2));
    const late = toDb(win(ir.l, 3.0, 3.1));
    expect(late).toBeLessThanOrEqual(early - 20);
  });

  it('has different left and right outputs of similar level', () => {
    const l = ir.l.subarray(0, SR);
    const r = ir.r.subarray(0, SR);
    let maxDiff = 0;
    for (let i = 0; i < l.length; i++) maxDiff = Math.max(maxDiff, Math.abs(l[i] - r[i]));
    expect(maxDiff).toBeGreaterThan(1e-6);
    const d = toDb(rms(l)) - toDb(rms(r));
    expect(Math.abs(d)).toBeLessThan(3);
  });
});

describe('Reverb settings', () => {
  it('rings longer with a larger room', () => {
    const small = new Reverb(SR);
    small.setRoomSize(0.3);
    const big = new Reverb(SR);
    big.setRoomSize(0.9);
    const a = toDb(win(impulseResponse(small, 2, SR).l, 1, 2));
    const b = toDb(win(impulseResponse(big, 2, SR).l, 1, 2));
    expect(b - a).toBeGreaterThanOrEqual(20);
  });

  it('damping removes high frequencies from the tail', () => {
    const ratioDb = (damping: number): number => {
      const rv = new Reverb(SR);
      rv.setRoomSize(0.8);
      rv.setDamping(damping);
      const x = impulseResponse(rv, 0.8, SR).l.subarray(Math.round(0.3 * SR));
      const hp = new Biquad();
      hp.setHighpass(4000, 0.7071, SR);
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = hp.process(x[i]);
      return toDb(rms(y) / rms(x));
    };
    const damped = ratioDb(1);
    const open = ratioDb(0);
    expect(open - damped).toBeGreaterThanOrEqual(6);
  });

  it('clamps settings and ignores non-finite values', () => {
    const make = (f: (r: Reverb) => void): Float32Array => {
      const r = new Reverb(SR);
      f(r);
      return impulseResponse(r, 0.5, SR).l;
    };
    expectEqual(make((r) => r.setRoomSize(5)), make((r) => r.setRoomSize(1)));
    expectEqual(make((r) => r.setRoomSize(-2)), make((r) => r.setRoomSize(0)));
    expectEqual(make((r) => r.setDamping(9)), make((r) => r.setDamping(1)));
    expectEqual(make((r) => r.setDamping(-9)), make((r) => r.setDamping(0)));
    // sanity: the settings really matter
    expect(firstNonZero(make((r) => r.setRoomSize(1)))).toBe(1215);
    const base = make((r) => r.setRoomSize(0.8));
    expectEqual(
      make((r) => {
        r.setRoomSize(0.8);
        r.setRoomSize(NaN);
        r.setRoomSize(Infinity);
        r.setRoomSize(-Infinity);
      }),
      base,
    );
    const baseD = make((r) => r.setDamping(0.2));
    expectEqual(
      make((r) => {
        r.setDamping(0.2);
        r.setDamping(NaN);
        r.setDamping(Infinity);
      }),
      baseD,
    );
    expect(Array.from(make((r) => r.setRoomSize(0))).some((v, i) => v !== base[i])).toBe(true);
  });

  it('is independent of the sample rate in decay', () => {
    const vals = [44100, 48000, 96000].map((sr) => {
      const rv = new Reverb(sr);
      rv.setRoomSize(0.7);
      const l = impulseResponse(rv, 1.2, sr).l;
      return toDb(win(l, 1.0, 1.2, sr)) - toDb(win(l, 0.2, 0.4, sr));
    });
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThan(3);
  });
});

describe('Reverb stability and input handling', () => {
  it('stays finite and bounded at maximum room size and no damping', () => {
    const rv = new Reverb(SR);
    rv.setRoomSize(1);
    rv.setDamping(0);
    const n = 5 * SR;
    const x = noise(n, 7, 1);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      rv.process(x[i], x[i]);
      l[i] = rv.outL;
      r[i] = rv.outR;
    }
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    // All eight combs reinforce each other at 0 Hz, where the gain is 36 at room size 1 (see
    // the steady-input test below). Noise has a little energy down there, so the output can
    // swing far above the input. The bound is that gain plus a margin, not a level target.
    const p = Math.max(peak(l), peak(r));
    expect(p).toBeLessThan(40);
  });

  // Gain structure: a steady input settles at inputs * 0.015 * 8 combs * 3 / (1 - feedback).
  // The damping filter and the all-passes both pass 0 Hz at unity, so they do not change it.
  it.each([
    [0, 2, 2.4],
    [0.5, 3, 4.5],
    [1, 12, 36],
  ])('settles at the predicted level for a steady input (room %f)', (room, seconds, expected) => {
    const rv = new Reverb(SR);
    rv.setRoomSize(room);
    for (let i = 0; i < seconds * SR; i++) rv.process(1, 1);
    expect(Math.abs(rv.outL / expected - 1)).toBeLessThan(0.002);
    expect(Math.abs(rv.outR / expected - 1)).toBeLessThan(0.002);
  });

  it('sums the two inputs into one mono feed', () => {
    const a = new Reverb(SR);
    const b = new Reverb(SR);
    const n = SR >> 1;
    for (let i = 0; i < n; i++) {
      a.process(i === 0 ? 1 : 0, 0);
      b.process(0, i === 0 ? 1 : 0);
      expect(a.outL).toBe(b.outL);
      expect(a.outR).toBe(b.outR);
    }
  });

  it('treats non-finite input as silence', () => {
    const a = new Reverb(SR);
    const b = new Reverb(SR);
    a.process(1, 1);
    b.process(1, 1);
    a.process(NaN, Infinity);
    b.process(0, 0);
    for (let i = 0; i < 3000; i++) {
      expect(a.outL).toBe(b.outL);
      expect(a.outR).toBe(b.outR);
      a.process(0, 0);
      b.process(0, 0);
    }
    const rv = new Reverb(SR);
    const x = noise(SR, 3, 0.5);
    let ok = true;
    for (let i = 0; i < x.length; i++) {
      rv.process(i === 20000 ? NaN : x[i], i === 20001 ? -Infinity : x[i]);
      if (!Number.isFinite(rv.outL) || !Number.isFinite(rv.outR)) ok = false;
    }
    expect(ok).toBe(true);
  });

  it('reset clears the tail and keeps the settings', () => {
    const rv = new Reverb(SR);
    rv.setRoomSize(0.8);
    rv.setDamping(0.3);
    rv.process(1, 1);
    for (let i = 0; i < 5000; i++) rv.process(0, 0);
    expect(rv.outL !== 0 || rv.outR !== 0).toBe(true);
    rv.reset();
    expect(rv.outL).toBe(0);
    expect(rv.outR).toBe(0);
    for (let i = 0; i < 5000; i++) {
      rv.process(0, 0);
      expect(rv.outL).toBe(0);
      expect(rv.outR).toBe(0);
    }
    rv.reset();
    const after = impulseResponse(rv, 0.5, SR);
    const fresh = new Reverb(SR);
    fresh.setRoomSize(0.8);
    fresh.setDamping(0.3);
    const ref = impulseResponse(fresh, 0.5, SR);
    expectEqual(after.l, ref.l);
    expectEqual(after.r, ref.r);
  });
});
