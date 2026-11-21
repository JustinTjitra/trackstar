import { describe, expect, it } from 'vitest';
import { ReleaseFx } from '../../src/fx/effects/release';
import type { ReleaseType } from '../../src/fx/types';
import { allFinite, noise, rms, runBlocks, sine, toDb } from '../fixtures/synthAudio';

const SR = 48000;
const FADE = 480; // 10 ms at 48 kHz
const BRAKE_FADE = 1440; // 30 ms at 48 kHz
const ECHO_DELAY = 12000; // half a beat at 120 BPM
const TYPES: ReleaseType[] = ['brake', 'backspin', 'echo'];
/** Length of the sound of each type at the default 2 beats, 120 BPM, 48 kHz. */
const DURATION: Record<ReleaseType, number> = { brake: 48000, backspin: 48000, echo: 96000 };

type Channel = 'l' | 'r';

/** A ReleaseFx fed from known input; every `feed` call processes the next samples in place and remembers them. */
interface Session {
  fx: ReleaseFx;
  xl: Float32Array;
  xr: Float32Array;
  ol: Float32Array;
  or: Float32Array;
  /** Index of the next sample to be processed. */
  pos: number;
  /** Processes `n` more samples (in blocks of `block`) and returns the index of the first one. */
  feed(n: number, block?: number): number;
}

function makeSession(
  total: number,
  opts: { sampleRate?: number; fx?: ReleaseFx; input?: { l: Float32Array; r: Float32Array } } = {},
): Session {
  const fx = opts.fx ?? new ReleaseFx(opts.sampleRate ?? SR);
  const xl = opts.input ? opts.input.l : noise(total, 11, 0.5);
  const xr = opts.input ? opts.input.r : noise(total, 22, 0.5);
  const s: Session = {
    fx,
    xl,
    xr,
    ol: xl.slice(),
    or: xr.slice(),
    pos: 0,
    feed(n: number, block = n) {
      const from = s.pos;
      if (from + n > xl.length) throw new Error('session input too short');
      runBlocks((a, b, f) => fx.process(a, b, f), s.ol.subarray(from, from + n), s.or.subarray(from, from + n), Math.max(1, block));
      s.pos += n;
      return from;
    },
  };
  return s;
}

/** Same signal on both channels. */
function sineInput(freq: number, seconds: number, amp = 0.5, sampleRate = SR): { l: Float32Array; r: Float32Array } {
  return { l: sine(freq, seconds, sampleRate, amp), r: sine(freq, seconds, sampleRate, amp) };
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

/** First index in [from, to) where the output is not the input, or -1. */
function passBad(s: Session, from: number, to: number): number {
  return firstBad(s, from, to, (x, n) => x[n]);
}

/** Linear interpolation between the inputs `lag` samples before position `p`, as the effect reads its recording. */
function interp(x: Float32Array, p: number, lag: number): number {
  const i = Math.floor(lag);
  const frac = lag - i;
  const a = p - i >= 0 ? x[p - i] : 0;
  const b = p - i - 1 >= 0 ? x[p - i - 1] : 0;
  return a + (b - a) * frac;
}

/** Checks the brake sound of length D with end fade `bf` over output indices T .. T + D - 1. */
function brakeBad(s: Session, T: number, D: number, bf: number): number {
  return firstBad(
    s,
    T,
    T + D,
    (x, p) => {
      const n = p - T;
      const lag = (n * n) / (2 * D);
      return Math.min(1, (D - n) / bf) * interp(x, p, lag);
    },
    1e-6,
  );
}

/** Checks the 'live input fades back in' ramp over output indices T + D .. T + D + fade - 1. */
function returnBad(s: Session, T: number, D: number, fade: number): number {
  return firstBad(s, T + D, T + D + fade, (x, p) => (x[p] * (p - T - D + 1)) / fade, 1e-6);
}

/** Position of the backspin read head behind the live input at sample n of D. */
function spinLag(n: number, D: number): number {
  const xx = n / D;
  return D * (xx <= 0.125 ? 20 * xx * xx : 1.9375 + xx - (16 / 7) * (1 - xx) * (1 - xx));
}

/** Expected echo release output (see the effect's description), computed with a plain simulation. */
function echoExpected(x: Float32Array, T: number, D: number, d: number, fade: number): Float32Array {
  const N = x.length;
  const y = new Float32Array(N);
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const wet = n >= d ? 0.6 * y[n - d] : 0;
    let gate: number;
    if (n < T) {
      gate = 1;
      out[n] = x[n];
    } else if (n < T + D) {
      const m = n - T;
      const xf = Math.min(1, (m + 1) / fade);
      gate = 1 - xf;
      out[n] = x[n] * gate + wet * xf * Math.min(1, (D - 1 - m) / fade);
    } else if (n < T + D + fade) {
      gate = (n - T - D + 1) / fade;
      out[n] = x[n] * gate;
    } else {
      gate = 1;
      out[n] = x[n];
    }
    y[n] = x[n] * gate + wet;
  }
  return out;
}

/**
 * Expected output around several echo releases, each { T, D }, with a plain simulation of the
 * echo line. Only echo releases gate the line; inside any other release the line keeps taking
 * the live input, and the value returned there is not meaningful.
 */
function echoesExpected(x: Float32Array, echoes: { T: number; D: number }[], d: number, fade: number): Float32Array {
  const N = x.length;
  const y = new Float32Array(N);
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const wet = n >= d ? 0.6 * y[n - d] : 0;
    let gate = 1;
    out[n] = x[n];
    for (const e of echoes) {
      if (n >= e.T && n < e.T + e.D) {
        const m = n - e.T;
        const xf = Math.min(1, (m + 1) / fade);
        gate = 1 - xf;
        out[n] = x[n] * gate + wet * xf * Math.min(1, (e.D - 1 - m) / fade);
      } else if (n >= e.T + e.D && n < e.T + e.D + fade) {
        gate = (n - e.T - e.D + 1) / fade;
        out[n] = x[n] * gate;
      }
    }
    y[n] = x[n] * gate + wet;
  }
  return out;
}

/** Index of the first sample where two arrays differ, or -1. */
function firstDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

/** Number of sign changes of x over [from, to), ignoring exact zeros. */
function zeroCrossings(x: Float32Array, from: number, to: number): number {
  let count = 0;
  let last = 0;
  for (let i = from; i < to; i++) {
    const sgn = x[i] > 0 ? 1 : x[i] < 0 ? -1 : 0;
    if (sgn === 0) continue;
    if (last !== 0 && sgn !== last) count++;
    last = sgn;
  }
  return count;
}

/** Largest absolute step between neighbouring samples over both channels. */
function maxStep(s: Session): number {
  let max = 0;
  for (let n = 1; n < s.pos; n++) {
    max = Math.max(max, Math.abs(s.ol[n] - s.ol[n - 1]), Math.abs(s.or[n] - s.or[n - 1]));
  }
  return max;
}

/** Feeds `pre` samples, triggers, and returns the trigger index T. */
function triggerAfter(s: Session, pre: number, type: ReleaseType, beats?: number): number {
  s.feed(pre);
  s.fx.trigger(type, beats);
  return s.pos;
}

/** Checks the echo ratio out[Q + m + d] = 0.6 * out[Q + m] for m in [from, to) on both channels. */
function echoRatioBad(s: Session, Q: number, d: number, from: number, to: number): number {
  for (let m = from; m < to; m++) {
    if (!(Math.abs(s.ol[Q + m + d] - 0.6 * s.ol[Q + m]) <= 1e-6)) return m;
    if (!(Math.abs(s.or[Q + m + d] - 0.6 * s.or[Q + m]) <= 1e-6)) return m;
  }
  return -1;
}

describe('ReleaseFx', () => {
  it('rejects invalid constructor arguments with a RangeError', () => {
    for (const sr of [0, -1, NaN, Infinity]) expect(() => new ReleaseFx(sr)).toThrow(RangeError);
    for (const secs of [0, -1, NaN]) expect(() => new ReleaseFx(SR, secs)).toThrow(RangeError);
    expect(() => new ReleaseFx(SR, 1 / SR)).toThrow(RangeError);
    expect(() => new ReleaseFx(SR, 2 / SR)).not.toThrow();
  });

  it('passes the input through exactly when never triggered', () => {
    const s = makeSession(30000);
    s.feed(30000, 333);
    expect(s.fx.active).toBe(false);
    expect(s.fx.consumeFinished()).toBe(false);
    expect(passBad(s, 0, 30000)).toBe(-1);
  });

  it('brakes: the recording slows down to a stop, with an end fade, starting seamlessly', () => {
    const s = makeSession(120000);
    const T = triggerAfter(s, 60000, 'brake');
    s.feed(60000);
    expect(T).toBe(60000);
    expect(s.ol[T]).toBe(s.xl[T]);
    expect(s.or[T]).toBe(s.xr[T]);
    expect(brakeBad(s, T, 48000, BRAKE_FADE)).toBe(-1);
  });

  it('brake slows down a sine: fewer zero crossings in each quarter, then the live input returns', () => {
    const s = makeSession(0, { input: sineInput(1000, 3) });
    const T = triggerAfter(s, 20000, 'brake');
    s.feed(48000 + FADE - 1);
    expect(s.fx.active).toBe(true);
    s.feed(1);
    expect(s.fx.active).toBe(false);
    s.feed(5000);
    const q = [0, 1, 2, 3].map((k) => zeroCrossings(s.ol, T + k * 12000, T + (k + 1) * 12000));
    expect(q[0]).toBeGreaterThan(q[1]);
    expect(q[1]).toBeGreaterThan(q[2]);
    expect(q[2]).toBeGreaterThan(q[3]);
    expect(q[3]).toBeGreaterThan(0);
    expect(returnBad(s, T, 48000, FADE)).toBe(-1);
    expect(passBad(s, T + 48480, s.pos)).toBe(-1);
  });

  it('backspins: the recording is spun backwards, slows down and fades out', () => {
    const s = makeSession(140000);
    const T = triggerAfter(s, 80000, 'backspin', 1);
    s.feed(30000);
    const D = 24000;
    expect(
      firstBad(s, T, T + D, (x, p) => {
        const n = p - T;
        return (1 - n / D) * interp(x, p, spinLag(n, D));
      }, 1e-6),
    ).toBe(-1);
    expect(s.ol[T]).toBe(s.xl[T]);
    expect(s.or[T]).toBe(s.xr[T]);
    expect(Math.abs(s.ol[T + D - 1])).toBeLessThan(1e-4);
    expect(Math.abs(s.or[T + D - 1])).toBeLessThan(1e-4);
    expect(allFinite(s.ol) && allFinite(s.or)).toBe(true);
    expect(returnBad(s, T, D, FADE)).toBe(-1);
    expect(passBad(s, T + D + FADE, s.pos)).toBe(-1);
  });

  it('backspin fades to silence where it would read past the end of the recording', () => {
    const s = makeSession(120000, { fx: new ReleaseFx(SR, 1) });
    const T = triggerAfter(s, 60000, 'backspin');
    s.feed(50000);
    const D = 48000;
    let silent = 0;
    for (let n = 0; n < D; n++) {
      const lag = spinLag(n, D);
      const run = Math.min(1, Math.max(0, (47998 - lag) / 960));
      if (lag >= 47998) {
        silent++;
        expect(s.ol[T + n]).toBe(0);
        expect(s.or[T + n]).toBe(0);
      } else {
        const bad = firstBad(s, T + n, T + n + 1, (x, p) => (1 - n / D) * run * interp(x, p, lag), 1e-6);
        expect(bad).toBe(-1);
      }
    }
    expect(silent).toBeGreaterThanOrEqual(10000);
    expect(allFinite(s.ol) && allFinite(s.or)).toBe(true);
  });

  it('echo: a whole release matches a plain simulation of the gated feedback delay', () => {
    const s = makeSession(160000);
    const T = triggerAfter(s, 60000, 'echo');
    s.feed(100000);
    const wantL = echoExpected(s.xl, T, 96000, ECHO_DELAY, FADE);
    const wantR = echoExpected(s.xr, T, 96000, ECHO_DELAY, FADE);
    let bad = -1;
    for (let n = 0; n < 160000 && bad < 0; n++) {
      if (!(Math.abs(s.ol[n] - wantL[n]) <= 1e-6) || !(Math.abs(s.or[n] - wantR[n]) <= 1e-6)) bad = n;
    }
    expect(bad).toBe(-1);
  });

  it('echo line: an echo after an earlier echo and a brake still matches the simulation', () => {
    const s = makeSession(60000);
    // a short echo release (rings for 12000), then idle
    const T1 = triggerAfter(s, 5000, 'echo', 0.25);
    s.feed(12000 + FADE + 1000);
    // a short brake: the echo line must keep taking the live input while it runs
    s.fx.trigger('brake', 0.25);
    s.feed(6000 + FADE + 500);
    expect(s.fx.active).toBe(false);
    // the echo under test repeats audio from the return of the first echo and from the brake
    s.fx.trigger('echo', 0.5);
    const Q = s.pos;
    s.feed(24000 + FADE + 1000);
    const echoes = [{ T: T1, D: 12000 }, { T: Q, D: 24000 }];
    const wantL = echoesExpected(s.xl, echoes, ECHO_DELAY, FADE);
    const wantR = echoesExpected(s.xr, echoes, ECHO_DELAY, FADE);
    let bad = -1;
    for (let n = Q; n < s.pos && bad < 0; n++) {
      if (!(Math.abs(s.ol[n] - wantL[n]) <= 1e-6) || !(Math.abs(s.or[n] - wantR[n]) <= 1e-6)) bad = n;
    }
    expect(bad).toBe(-1);
  });

  it('echo rings out: each repeat is 0.6 times the one before, 4.44 dB down', () => {
    const s = makeSession(160000);
    const T = triggerAfter(s, 60000, 'echo');
    s.feed(100000);
    for (let k = 0; k < 6; k++) {
      expect(echoRatioBad(s, T + k * ECHO_DELAY, ECHO_DELAY, 480, 12000)).toBe(-1);
    }
    for (let k = 0; k < 6; k++) {
      const a = T + 480 + k * ECHO_DELAY;
      const b = T + 12000 + k * ECHO_DELAY;
      const c = a + ECHO_DELAY;
      const d = b + ECHO_DELAY;
      const drop = toDb(rms(s.ol, c, d)) - toDb(rms(s.ol, a, b));
      expect(Math.abs(drop + 4.44)).toBeLessThan(0.1);
    }
  });

  it('reports finished once at the end of the sound and stays active until the live input is back', () => {
    for (const type of TYPES) {
      const D = DURATION[type];
      const s = makeSession(D + 4000);
      s.feed(1000);
      expect(s.fx.active).toBe(false);
      expect(s.fx.consumeFinished()).toBe(false);
      s.fx.trigger(type);
      expect(s.fx.active).toBe(true);
      s.feed(D - 1);
      expect(s.fx.consumeFinished()).toBe(false);
      s.feed(1);
      expect(s.fx.consumeFinished()).toBe(true);
      expect(s.fx.consumeFinished()).toBe(false);
      expect(s.fx.active).toBe(true);
      s.feed(FADE - 1);
      expect(s.fx.active).toBe(true);
      s.feed(1);
      expect(s.fx.active).toBe(false);
    }
    // two releases in a row without consuming give a single true
    const s = makeSession(30000);
    s.fx.trigger('brake', 0.25);
    s.feed(6000 + FADE);
    expect(s.fx.active).toBe(false);
    s.fx.trigger('backspin', 0.25);
    s.feed(6000 + FADE);
    expect(s.fx.active).toBe(false);
    expect(s.fx.consumeFinished()).toBe(true);
    expect(s.fx.consumeFinished()).toBe(false);
  });

  describe('trigger while busy', () => {
    /** Brake at 1000; optionally an echo trigger `offset` samples later; returns the session. */
    function run(offset: number | null): Session {
      const s = makeSession(100000);
      s.feed(1000);
      s.fx.trigger('brake');
      if (offset === null) {
        s.feed(99000);
      } else {
        s.feed(offset);
        s.fx.trigger('echo', 8);
        s.feed(99000 - offset);
      }
      return s;
    }

    it('is ignored while a release is running', () => {
      const base = run(null);
      const s = run(20000);
      expect(firstDiff(s.ol, base.ol)).toBe(-1);
      expect(firstDiff(s.or, base.or)).toBe(-1);
    });

    it('is ignored while the live input is returning', () => {
      const base = run(null);
      const s = run(48000 + 100);
      expect(firstDiff(s.ol, base.ol)).toBe(-1);
      expect(firstDiff(s.or, base.or)).toBe(-1);
    });

    it('starts a new release right after the last returning sample', () => {
      const s = makeSession(100000);
      const T = triggerAfter(s, 1000, 'brake');
      s.feed(48000 + FADE);
      expect(s.fx.active).toBe(false);
      s.fx.trigger('echo');
      expect(s.fx.active).toBe(true);
      s.feed(FADE + 100);
      // the live sound is gone once the echo gate has closed
      const p = T + 48000 + FADE + FADE + 50;
      expect(s.ol[p]).not.toBe(s.xl[p]);
    });
  });

  it('sanitises the trigger arguments', () => {
    const s = makeSession(260000);
    s.feed(1000);
    s.fx.trigger('foo' as ReleaseType);
    expect(s.fx.active).toBe(false);
    s.fx.trigger('brake', NaN);
    expect(s.fx.active).toBe(false);
    s.feed(1000);
    expect(passBad(s, 0, 2000)).toBe(-1);
    // 100 beats is clamped to 8 beats: 192000 samples
    s.fx.trigger('brake', 100);
    const T = s.pos;
    s.feed(192000 + FADE - 1);
    expect(s.fx.active).toBe(true);
    s.feed(1);
    expect(s.fx.active).toBe(false);
    s.feed(100);
    expect(passBad(s, T + 192000 + FADE, s.pos)).toBe(-1);
    expect(returnBad(s, T, 192000, FADE)).toBe(-1);
    // 0.01 beats is clamped to 0.25 beats: 6000 samples
    const t = makeSession(20000);
    const T2 = triggerAfter(t, 1000, 'brake', 0.01);
    t.feed(6000 + FADE - 1);
    expect(t.fx.active).toBe(true);
    t.feed(1);
    expect(t.fx.active).toBe(false);
    t.feed(1000);
    expect(brakeBad(t, T2, 6000, BRAKE_FADE)).toBe(-1);
    expect(passBad(t, T2 + 6000 + FADE, t.pos)).toBe(-1);
  });

  describe('tempo', () => {
    /** Number of samples after the trigger at which `active` turns false. */
    function releaseSamples(setup: (fx: ReleaseFx) => void, type: ReleaseType = 'brake'): number {
      const fx = new ReleaseFx(SR);
      setup(fx);
      const s = makeSession(300000, { fx });
      s.feed(100);
      fx.trigger(type);
      let n = 0;
      while (fx.active) {
        s.feed(1);
        n++;
        if (n > 250000) throw new Error('never ended');
      }
      return n;
    }

    it('follows setBpm, clamps it and ignores non-finite values', () => {
      expect(releaseSamples(() => {})).toBe(48000 + FADE);
      expect(releaseSamples((fx) => fx.setBpm(100))).toBe(57600 + FADE);
      expect(releaseSamples((fx) => fx.setBpm(1000))).toBe(24000 + FADE);
      expect(releaseSamples((fx) => fx.setBpm(1))).toBe(144000 + FADE);
      expect(releaseSamples((fx) => {
        fx.setBpm(100);
        fx.setBpm(NaN);
        fx.setBpm(Infinity);
      })).toBe(57600 + FADE);
    });

    it('a running brake keeps the tempo it started with', () => {
      const s = makeSession(120000);
      const T = triggerAfter(s, 5000, 'brake');
      s.feed(10000);
      s.fx.setBpm(60);
      s.feed(60000);
      expect(brakeBad(s, T, 48000, BRAKE_FADE)).toBe(-1);
      expect(returnBad(s, T, 48000, FADE)).toBe(-1);
      expect(passBad(s, T + 48000 + FADE, s.pos)).toBe(-1);
    });

    it('a running echo keeps its delay, the next one uses the new tempo', () => {
      const s = makeSession(450000);
      const T = triggerAfter(s, 10000, 'echo');
      s.feed(20000);
      s.fx.setBpm(100);
      s.feed(96000 + FADE + 100000 - 20000);
      for (let k = 0; k < 6; k++) {
        expect(echoRatioBad(s, T + k * ECHO_DELAY, ECHO_DELAY, 480, 12000)).toBe(-1);
      }
      // 100 BPM: half a beat is 14400 samples, an echo release of 2 beats rings for 4 beats = 115200
      const Q = s.pos;
      s.fx.trigger('echo');
      s.feed(115200 + FADE + 100);
      expect(echoRatioBad(s, Q, 14400, 480, 14400)).toBe(-1);
      expect(s.fx.active).toBe(false);
      // the release was 115200 long
      expect(passBad(s, Q + 115200 + FADE, s.pos)).toBe(-1);
      expect(returnBad(s, Q, 115200, FADE)).toBe(-1);
    });
  });

  it('works at 44.1 kHz', () => {
    const s = makeSession(100000, { sampleRate: 44100 });
    const T = triggerAfter(s, 40000, 'brake');
    s.feed(44100 + 441 - 1);
    expect(s.fx.active).toBe(true);
    s.feed(1 + 500);
    expect(s.fx.active).toBe(false);
    expect(brakeBad(s, T, 44100, 1323)).toBe(-1);
    expect(returnBad(s, T, 44100, 441)).toBe(-1);
    expect(passBad(s, T + 44541, s.pos)).toBe(-1);
  });

  it('does not click', () => {
    const limits: Record<ReleaseType, number> = { brake: 0.012, echo: 0.012, backspin: 0.03 };
    for (const type of TYPES) {
      const s = makeSession(0, { input: sineInput(97, 6) });
      s.feed(150000);
      s.fx.trigger(type);
      s.feed(DURATION[type] + FADE + 20000);
      expect(maxStep(s)).toBeLessThan(limits[type]);
    }
  });

  it('treats non-finite input as silence', () => {
    const s = makeSession(0, { input: { l: noise(150000, 11, 0.5), r: noise(150000, 22, 0.5) } });
    s.xl[100] = NaN;
    s.xr[101] = Infinity;
    s.xl[102] = -Infinity;
    s.xr[102] = NaN;
    s.ol.set(s.xl);
    s.or.set(s.xr);
    s.feed(10000);
    expect(s.ol[100]).toBe(0);
    expect(s.or[101]).toBe(0);
    expect(s.ol[102]).toBe(0);
    expect(s.or[102]).toBe(0);
    for (const type of TYPES) {
      const t = makeSession(0, { input: { l: noise(150000, 11, 0.5), r: noise(150000, 22, 0.5) } });
      t.feed(5000);
      t.fx.trigger(type);
      for (const k of [10, 700, 20000, 30000]) {
        t.xl[5000 + k] = NaN;
        t.xr[5000 + k + 1] = k % 2 ? Infinity : -Infinity;
        t.ol[5000 + k] = NaN;
        t.or[5000 + k + 1] = t.xr[5000 + k + 1];
      }
      t.feed(DURATION[type] + FADE + 5000);
      expect(allFinite(t.ol)).toBe(true);
      expect(allFinite(t.or)).toBe(true);
    }
  });

  describe('reset', () => {
    it('ends a running release at once and passes the input through', () => {
      const s = makeSession(60000);
      s.feed(1000);
      s.fx.trigger('brake');
      s.feed(5000);
      expect(s.fx.active).toBe(true);
      s.fx.reset();
      expect(s.fx.active).toBe(false);
      expect(s.fx.consumeFinished()).toBe(false);
      const from = s.feed(10000);
      expect(passBad(s, from, s.pos)).toBe(-1);
    });

    it('forgets the recording and the echo: a used instance behaves like a new one', () => {
      for (const type of ['echo', 'brake', 'backspin'] as ReleaseType[]) {
        const scenario = (fx: ReleaseFx): Session => {
          const s = makeSession(0, { fx, input: { l: noise(120000, 5, 0.5), r: noise(120000, 6, 0.5) } });
          s.feed(3000);
          fx.trigger(type);
          s.feed(100000);
          return s;
        };
        const used = new ReleaseFx(SR);
        const warm = makeSession(0, { fx: used, input: { l: noise(100000, 77, 0.5), r: noise(100000, 78, 0.5) } });
        warm.feed(40000);
        used.trigger('echo');
        warm.feed(20000);
        used.reset();
        const a = scenario(used);
        const b = scenario(new ReleaseFx(SR));
        expect(firstDiff(a.ol, b.ol)).toBe(-1);
        expect(firstDiff(a.or, b.or)).toBe(-1);
      }
    });

    it('clears a pending finished flag and picks up a tempo set during the release', () => {
      const s = makeSession(120000);
      s.feed(1000);
      s.fx.trigger('brake', 0.25);
      s.feed(6000); // the sound has ended, nobody has asked yet
      s.fx.reset();
      expect(s.fx.consumeFinished()).toBe(false);
      // the tempo changes while an echo is running (so its delay is kept), then reset
      s.feed(1000);
      s.fx.trigger('echo');
      s.feed(1000);
      s.fx.setBpm(100);
      s.fx.reset();
      s.feed(40000);
      s.fx.trigger('echo');
      const Q = s.pos;
      s.feed(60000);
      // half a beat at 100 BPM is 14400 samples
      expect(echoRatioBad(s, Q, 14400, 480, 14400)).toBe(-1);
    });

    it('keeps the tempo', () => {
      const fx = new ReleaseFx(SR);
      fx.setBpm(100);
      fx.reset();
      const s = makeSession(80000, { fx });
      const T = triggerAfter(s, 1000, 'brake');
      s.feed(57600 + FADE - 1);
      expect(fx.active).toBe(true);
      s.feed(1);
      expect(fx.active).toBe(false);
      expect(brakeBad(s, T, 57600, BRAKE_FADE)).toBe(-1);
    });
  });

  it('gives the same output for any block size', () => {
    const total = 12000 + 3 * 2000 + 48480 + 96480 + 48480;
    const run = (block: number | null): Session => {
      const s = makeSession(total);
      const f = (n: number) => s.feed(n, block ?? n);
      f(10000);
      s.fx.trigger('brake');
      f(48480 + 2000);
      s.fx.trigger('echo');
      f(96480 + 2000);
      s.fx.trigger('backspin');
      f(48480 + 2000);
      return s;
    };
    const ref = run(null);
    expect(ref.pos).toBeLessThanOrEqual(total);
    for (const block of [1, 128, 4096]) {
      const s = run(block);
      expect(firstDiff(s.ol.subarray(0, s.pos), ref.ol.subarray(0, ref.pos))).toBe(-1);
      expect(firstDiff(s.or.subarray(0, s.pos), ref.or.subarray(0, ref.pos))).toBe(-1);
    }
    // the scenario really contained all three sounds: output differs from the input
    expect(passBad(ref, 10100, 10100 + 24000)).not.toBe(-1);
    expect(passBad(ref, 60580 + 1000, 60580 + 1000 + 24000)).not.toBe(-1);
  });

  it('only touches the first `frames` samples, and nothing for frames 0, NaN or negative', () => {
    const fx = new ReleaseFx(SR);
    const prime = makeSession(1000, { fx });
    prime.feed(1000);
    fx.trigger('brake', 0.25);
    const l = noise(256, 3, 0.5);
    const r = noise(256, 4, 0.5);
    const l0 = l.slice();
    const r0 = r.slice();
    fx.process(l, r, 100);
    expect(firstDiff(l.subarray(100), l0.subarray(100))).toBe(-1);
    expect(firstDiff(r.subarray(100), r0.subarray(100))).toBe(-1);
    expect(firstDiff(l.subarray(0, 100), l0.subarray(0, 100))).not.toBe(-1);
    const l1 = l.slice();
    const r1 = r.slice();
    for (const frames of [0, NaN, -5]) {
      fx.process(l, r, frames);
      expect(firstDiff(l, l1)).toBe(-1);
      expect(firstDiff(r, r1)).toBe(-1);
    }
    // the ignored calls did not advance the release: it still lasts exactly 6000 + 480 samples in total
    const rest = makeSession(7000, { fx });
    rest.feed(6000 - 100 + FADE - 1);
    expect(fx.active).toBe(true);
    rest.feed(1);
    expect(fx.active).toBe(false);
  });
});
