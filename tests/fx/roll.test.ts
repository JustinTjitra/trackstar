import { describe, expect, it } from 'vitest';
import { Roll } from '../../src/fx/effects/roll';
import type { RollDivision } from '../../src/fx/types';
import { allFinite, noise, runBlocks, sine } from '../fixtures/synthAudio';

const SR = 48000;
const FADE = 240; // 5 ms at 48 kHz
const SEAM = 144; // 3 ms at 48 kHz

type Channel = 'l' | 'r';

/** A Roll fed from known input; every `feed` call processes the next samples in place and remembers them. */
interface Session {
  roll: Roll;
  xl: Float32Array;
  xr: Float32Array;
  ol: Float32Array;
  or: Float32Array;
  /** Index of the next sample to be processed. */
  pos: number;
  /** Processes `n` more samples (in blocks of `block`) and returns the index of the first one. */
  feed(n: number, block?: number): number;
}

function makeSession(total: number, sampleRate = SR, roll: Roll = new Roll(sampleRate), input?: { l: Float32Array; r: Float32Array }): Session {
  const xl = input ? input.l : noise(total, 11, 0.5);
  const xr = input ? input.r : noise(total, 22, 0.5);
  const s: Session = {
    roll,
    xl,
    xr,
    ol: xl.slice(),
    or: xr.slice(),
    pos: 0,
    feed(n: number, block = n) {
      const from = s.pos;
      if (from + n > xl.length) throw new Error('session input too short');
      runBlocks(
        (a, b, f) => roll.process(a, b, f),
        s.ol.subarray(from, from + n),
        s.or.subarray(from, from + n),
        Math.max(1, block),
      );
      s.pos += n;
      return from;
    },
  };
  return s;
}

/**
 * First output index in [from, to) where either channel differs from `expected(x, n)` by more
 * than `tol` (exact match when tol is 0), or -1 when all match. `expected` gets the input of
 * the channel being checked.
 */
function firstBad(s: Session, from: number, to: number, expected: (x: Float32Array, n: number) => number, tol = 0): number {
  const chans: Channel[] = ['l', 'r'];
  for (let n = from; n < to; n++) {
    for (const c of chans) {
      const x = c === 'l' ? s.xl : s.xr;
      const out = c === 'l' ? s.ol : s.or;
      const want = expected(x, n);
      if (tol === 0 ? out[n] !== want : !(Math.abs(out[n] - want) <= tol)) return n;
    }
  }
  return -1;
}

/** Checks the loop content `x[S - len + (j mod len)]` over output indices S + j for j in [jFrom, jTo), skipping the seam of each period. */
function loopContentBad(s: Session, S: number, len: number, jFrom: number, jTo: number, seam = SEAM, shift = len): number {
  for (let j = jFrom; j < jTo; j++) {
    if (j % len >= len - seam) continue;
    const bad = firstBad(s, S + j, S + j + 1, (x) => x[S - shift + (j % len)]);
    if (bad >= 0) return bad;
  }
  return -1;
}

/** Start at S = 30000 and run `after` samples; returns S. */
function startAt30000(s: Session, division: RollDivision, after: number): number {
  s.feed(30000);
  s.roll.start(division);
  const S = s.pos;
  s.feed(after);
  return S;
}

describe('Roll', () => {
  it('rejects invalid constructor arguments with a RangeError', () => {
    for (const sr of [0, -1, NaN, Infinity]) expect(() => new Roll(sr)).toThrow(RangeError);
    for (const secs of [0, -1, NaN, Infinity]) expect(() => new Roll(SR, secs)).toThrow(RangeError);
    // fewer than 2 samples of recording
    expect(() => new Roll(SR, 1 / SR)).toThrow(RangeError);
    expect(() => new Roll(SR, 2 / SR)).not.toThrow();
  });

  it('passes the input through exactly when never started', () => {
    const s = makeSession(20000);
    s.roll.stop(); // stopping an inactive roll does nothing
    s.feed(20000, 333);
    expect(s.roll.active).toBe(false);
    expect(firstBad(s, 0, 20000, (x, n) => x[n])).toBe(-1);
  });

  it('does nothing when started with nothing recorded', () => {
    const s = makeSession(5000);
    s.roll.start(0.5);
    expect(s.roll.active).toBe(false);
    s.feed(5000);
    expect(s.roll.active).toBe(false);
    expect(firstBad(s, 0, 5000, (x, n) => x[n])).toBe(-1);
  });

  it('loops the slice that came just before the start, with the right period', () => {
    const s = makeSession(80000);
    const S = startAt30000(s, 0.5, 48000);
    expect(s.roll.active).toBe(true);
    // periods 0, 1, 2; period 0 only from j >= 240 where the start crossfade is over
    expect(loopContentBad(s, S, 12000, FADE, 36000)).toBe(-1);
    // the loop repeats itself sample for sample, seam included
    expect(firstBad(s, S + FADE, S + 36000, (x, n) => (x === s.xl ? s.ol : s.or)[n + 12000])).toBe(-1);
  });

  it('glides into the audio before the loop start at the seam', () => {
    const s = makeSession(80000);
    const S = startAt30000(s, 0.5, 48000);
    for (let p = 0; p < 3; p++) {
      const base = S + p * 12000;
      for (let k = 0; k < SEAM; k++) {
        const t = (k + 1) / SEAM;
        const bad = firstBad(
          s,
          base + 12000 - SEAM + k,
          base + 12000 - SEAM + k + 1,
          (x) => {
            const a = x[S - SEAM + k];
            const b = x[S - 12000 - SEAM + k];
            return a + (b - a) * t;
          },
          1e-6,
        );
        expect(bad).toBe(-1);
      }
      expect(firstBad(s, base + 11999, base + 12000, (x) => x[S - 12001], 1e-7)).toBe(-1);
    }
  });

  it('crossfades from live to the roll over the first 5 ms', () => {
    const s = makeSession(60000);
    const S = startAt30000(s, 0.5, 2000);
    expect(
      firstBad(s, S, S + FADE, (x, n) => {
        const j = n - S;
        return x[S + j] + (x[S - 12000 + j] - x[S + j]) * ((j + 1) / FADE);
      }, 1e-6),
    ).toBe(-1);
  });

  /** Scenario of the stop test; returns S and P. */
  function stopScenario(block: number): { s: Session; S: number; P: number } {
    const s = makeSession(60000);
    s.feed(30000, block);
    s.roll.start(0.5);
    const S = s.pos;
    s.feed(20000, block);
    s.roll.stop();
    expect(s.roll.active).toBe(false);
    const P = s.pos;
    s.feed(5000, block);
    return { s, S, P };
  }

  it('fades back to the live input after stop and then passes it through exactly', () => {
    const { s, S, P } = stopScenario(5000);
    expect(
      firstBad(s, P, P + FADE, (x, n) => {
        const j = n - P;
        const roll = x[S - 12000 + 8000 + j];
        return x[n] + (roll - x[n]) * ((239 - j) / FADE);
      }, 1e-6),
    ).toBe(-1);
    expect(firstBad(s, P + FADE, P + 5000, (x, n) => x[n])).toBe(-1);
  });

  it('follows the tempo and the sample rate', () => {
    // 100 BPM: one beat is 28800 samples
    {
      const s = makeSession(120000);
      s.roll.setBpm(100);
      const S = startAt30000(s, 1, 60000);
      expect(loopContentBad(s, S, 28800, FADE, 57000)).toBe(-1);
    }
    // 1000 BPM acts as 240: one beat is 12000 samples
    {
      const s = makeSession(80000);
      s.roll.setBpm(1000);
      const S = startAt30000(s, 1, 40000);
      expect(loopContentBad(s, S, 12000, FADE, 36000)).toBe(-1);
    }
    // 1 BPM acts as 40: one beat is 72000 samples
    {
      const s = makeSession(240000);
      s.roll.setBpm(1);
      s.feed(80000);
      s.roll.start(1);
      const S = s.pos;
      s.feed(150000);
      expect(loopContentBad(s, S, 72000, FADE, 140000)).toBe(-1);
    }
    // NaN is ignored: the previous 100 BPM stays
    {
      const s = makeSession(120000);
      s.roll.setBpm(100);
      s.roll.setBpm(NaN);
      s.roll.setBpm(Infinity);
      const S = startAt30000(s, 1, 60000);
      expect(loopContentBad(s, S, 28800, FADE, 57000)).toBe(-1);
    }
    // 44.1 kHz at the default 120 BPM: half a beat is 11025 samples
    {
      const s = makeSession(80000, 44100);
      const S = startAt30000(s, 0.5, 30000);
      expect(loopContentBad(s, S, 11025, 300, 10800)).toBe(-1);
      expect(loopContentBad(s, S, 11025, 11025 + 300, 11025 + 10800, 132, 11025)).toBe(-1);
    }
  });

  it('shortens the loop to what was recorded', () => {
    const s = makeSession(30000);
    s.feed(5000);
    s.roll.start(0.5);
    const S = s.pos;
    s.feed(12000);
    for (let p = 0; p < 2; p++) {
      for (let j = FADE; j < 5000 - SEAM - 1; j++) {
        expect(firstBad(s, S + p * 5000 + j, S + p * 5000 + j + 1, (x) => x[j])).toBe(-1);
      }
      // nothing came before the loop start, so the seam glides to silence
      expect(s.ol[S + p * 5000 + 4999]).toBe(0);
      expect(s.or[S + p * 5000 + 4999]).toBe(0);
    }
  });

  it('keeps the frozen audio when the division changes while rolling', () => {
    // half beat, then quarter beat 7000 samples in
    {
      const s = makeSession(90000);
      const S = startAt30000(s, 0.5, 7000);
      s.roll.start(0.25);
      const R = s.pos;
      s.feed(20000);
      expect(
        firstBad(s, R, R + FADE, (x, n) => {
          const j = n - R;
          const o = x[S - 12000 + 7000 + j];
          const nw = x[S - 6000 + j];
          return o + (nw - o) * ((j + 1) / FADE);
        }, 1e-6),
      ).toBe(-1);
      expect(loopContentBad(s, R, 6000, FADE, 18000, SEAM, R - S + 6000)).toBe(-1);
    }
    // quarter beat, then a whole beat 4000 samples later
    {
      const s = makeSession(120000);
      const S = startAt30000(s, 0.25, 4000);
      s.roll.start(1);
      const R = s.pos;
      s.feed(50000);
      // same end point: the loop is x[S - 24000 + i]
      expect(loopContentBad(s, R, 24000, FADE, 48000, SEAM, R - S + 24000)).toBe(-1);
    }
  });

  it('freezes a whole beat plus the audio its seam needs', () => {
    const s = makeSession(90000);
    const S = startAt30000(s, 1, 50000);
    for (let p = 0; p < 2; p++) {
      const base = S + p * 24000;
      // the seam of the longest loop still reaches back before the loop start
      expect(firstBad(s, base + 23999, base + 24000, (x) => x[S - 24001], 1e-7)).toBe(-1);
      expect(
        firstBad(s, base + 24000 - SEAM, base + 24000, (x, n) => {
          const k = n - (base + 24000 - SEAM);
          const a = x[S - SEAM + k];
          const b = x[S - 24000 - SEAM + k];
          return a + (b - a) * ((k + 1) / SEAM);
        }, 1e-6),
      ).toBe(-1);
    }
  });

  it('limits a longer loop to the frozen audio when the tempo drops while rolling', () => {
    const s = makeSession(90000);
    s.roll.setBpm(240);
    const S = startAt30000(s, 1, 5000); // freezes one beat at 240 BPM plus the seam: 12144 samples
    s.roll.setBpm(120);
    s.roll.start(1); // asks for 24000 samples, only 12144 are frozen
    const R = s.pos;
    s.feed(40000);
    expect(allFinite(s.ol)).toBe(true);
    expect(allFinite(s.or)).toBe(true);
    expect(loopContentBad(s, R, 12144, FADE, 36000, SEAM, R - S + 12144)).toBe(-1);
    expect(firstBad(s, R + FADE, R + 24000, (x, n) => (x === s.xl ? s.ol : s.or)[n + 12144])).toBe(-1);
  });

  it('has no clicks over a sequence of starts and stops on a sine', () => {
    const total = 30000 + 30000 + 10000 + 100 + 20000 + 2000;
    const tone = sine(97, total / SR, SR, 0.5);
    const s = makeSession(total, SR, new Roll(SR), { l: tone, r: tone.slice() });
    s.feed(30000);
    s.roll.start(0.5);
    s.feed(30000);
    s.roll.start(0.125);
    s.feed(10000);
    s.roll.stop();
    s.feed(100);
    s.roll.start(0.25);
    s.feed(20000);
    s.roll.stop();
    s.feed(2000);
    let worst = 0;
    for (let n = 1; n < total; n++) {
      worst = Math.max(worst, Math.abs(s.ol[n] - s.ol[n - 1]), Math.abs(s.or[n] - s.or[n - 1]));
    }
    expect(worst).toBeLessThan(0.012);
  });

  it('takes fresh audio when started while a stopped roll is still fading out', () => {
    const s = makeSession(120000);
    s.feed(30000);
    s.roll.start(0.5);
    s.feed(20000);
    s.roll.stop();
    s.feed(100);
    s.roll.start(0.5);
    const Q = s.pos;
    s.feed(30000);
    expect(s.roll.active).toBe(true);
    expect(loopContentBad(s, Q, 12000, FADE, 30000)).toBe(-1);
  });

  it('sanitises the division', () => {
    {
      const s = makeSession(40000);
      s.feed(30000);
      s.roll.start(NaN as RollDivision);
      expect(s.roll.active).toBe(false);
    }
    {
      const s = makeSession(90000);
      const S = startAt30000(s, 4 as RollDivision, 50000);
      expect(loopContentBad(s, S, 24000, FADE, 48000)).toBe(-1);
    }
    {
      const s = makeSession(60000);
      const S = startAt30000(s, 0.01 as RollDivision, 20000);
      expect(loopContentBad(s, S, 3000, FADE, 18000)).toBe(-1);
    }
  });

  it('does not depend on the rolling recording during a long hold', () => {
    const s = makeSession(48000 + 240000 + 10, SR, new Roll(SR, 1));
    s.feed(48000);
    s.roll.start(0.5);
    const S = s.pos;
    s.feed(240000);
    const lastPeriod = 19; // 240000 / 12000 = 20 periods, indices 0..19
    expect(loopContentBad(s, S, 12000, lastPeriod * 12000, 240000)).toBe(-1);
  });

  it('treats non-finite input as silence and stays finite', () => {
    const bad = [100, 5000, 20000, 20001];
    const make = (): { l: Float32Array; r: Float32Array } => {
      const l = noise(60000, 11, 0.5);
      const r = noise(60000, 22, 0.5);
      l[bad[0]] = NaN;
      r[bad[1]] = Infinity;
      l[bad[2]] = -Infinity;
      r[bad[3]] = NaN;
      return { l, r };
    };
    // inactive: zeros at the bad indices, the input elsewhere
    {
      const input = make();
      const s = makeSession(60000, SR, new Roll(SR), input);
      s.feed(30000);
      expect(s.ol[bad[0]]).toBe(0);
      expect(s.or[bad[1]]).toBe(0);
      expect(s.ol[bad[2]]).toBe(0);
      expect(s.or[bad[3]]).toBe(0);
      for (let n = 0; n < 30000; n++) {
        if (!Number.isFinite(input.l[n])) continue;
        expect(s.ol[n]).toBe(input.l[n]);
      }
    }
    // a roll over that region
    {
      const s = makeSession(60000, SR, new Roll(SR), make());
      s.feed(30000);
      s.roll.start(1);
      s.feed(30000);
      expect(allFinite(s.ol)).toBe(true);
      expect(allFinite(s.or)).toBe(true);
    }
  });

  it('reset leaves an instance that behaves like a fresh one', () => {
    const run = (roll: Roll): Session => {
      const s = makeSession(70000, SR, roll);
      s.feed(30000);
      roll.start(0.5);
      s.feed(30000);
      roll.stop();
      s.feed(100);
      return s;
    };
    const fresh = new Roll(SR);
    fresh.setBpm(100);
    const expected = run(fresh);

    const used = new Roll(SR);
    used.setBpm(100);
    run(used); // ends in the middle of a fade-out
    used.reset();
    expect(used.active).toBe(false);
    used.start(0.5); // nothing recorded any more
    expect(used.active).toBe(false);
    const again = run(used);
    expect(Array.from(again.ol)).toEqual(Array.from(expected.ol));
    expect(Array.from(again.or)).toEqual(Array.from(expected.or));
    // and the roll really happened, at the kept tempo (14400 samples)
    expect(loopContentBad(again, 30000, 14400, FADE, 28000)).toBe(-1);
  });

  it('gives the same output for any block size', () => {
    const ref = stopScenario(5000).s;
    for (const block of [1, 128, 4096]) {
      const got = stopScenario(block).s;
      expect(Array.from(got.ol)).toEqual(Array.from(ref.ol));
      expect(Array.from(got.or)).toEqual(Array.from(ref.or));
    }
  });

  it('honours frames smaller than the arrays and ignores bad frame counts', () => {
    const warm = (): Roll => {
      const roll = new Roll(SR);
      const s = makeSession(30000, SR, roll);
      s.feed(30000);
      roll.start(0.5);
      return roll;
    };
    const l0 = noise(256, 5, 0.5);
    const r0 = noise(256, 6, 0.5);
    {
      const roll = warm();
      const l = l0.slice();
      const r = r0.slice();
      roll.process(l, r, 100);
      let changed = 0;
      for (let i = 0; i < 100; i++) if (l[i] !== l0[i]) changed++;
      expect(changed).toBeGreaterThan(50);
      for (let i = 100; i < 256; i++) {
        expect(l[i]).toBe(l0[i]);
        expect(r[i]).toBe(r0[i]);
      }
    }
    for (const frames of [0, NaN, -5]) {
      const roll = warm();
      const l = l0.slice();
      const r = r0.slice();
      roll.process(l, r, frames);
      expect(Array.from(l)).toEqual(Array.from(l0));
      expect(Array.from(r)).toEqual(Array.from(r0));
    }
  });
});
