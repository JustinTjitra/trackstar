import { describe, expect, it } from 'vitest';
import { Limiter } from '../../src/fx/dsp/limiter';
import { FxEngine } from '../../src/fx/engine';
import { Isolator } from '../../src/fx/effects/isolator';
import { ReleaseFx } from '../../src/fx/effects/release';
import { Roll } from '../../src/fx/effects/roll';
import { SceneFx } from '../../src/fx/scene';
import type { ReleaseType, RollDivision, SceneSlot } from '../../src/fx/types';
import { allFinite, noise, rms, runBlocks, sine, toDb } from '../fixtures/synthAudio';

const SR = 48000;
const FADE = 480; // 10 ms at 48 kHz
const GRID = 128;

interface Input {
  l: Float32Array;
  r: Float32Array;
}

/** Anything with an in-place stereo process. */
interface Proc {
  process(l: Float32Array, r: Float32Array, frames: number): void;
}

/** The controls the engine and the reference chain have in common. */
interface Rig extends Proc {
  setBpm(bpm: number): void;
  setSceneSlot(slot: SceneSlot): void;
  setSceneAmount(v: number): void;
  setIsolator(low: number, mid: number, high: number): void;
  rollStart(division: RollDivision): void;
  rollStop(): void;
  release(type: ReleaseType, beats?: number): void;
}

/** Noise with different seeds on the two channels. */
function noiseInput(total: number, amp = 0.5): Input {
  return { l: noise(total, 11, amp), r: noise(total, 22, amp) };
}

interface RefOptions {
  /** Puts the scene in front of the isolator. */
  sceneFirst?: boolean;
  /** Length of the release recording, in seconds. */
  releaseSeconds?: number;
}

/**
 * A plain restatement of the chain, built from standalone parts: isolator, scene, roll, release and
 * limiter on a grid of 128 samples, with the release check after every grid block. It has no bypass.
 */
class RefChain implements Rig {
  iso = new Isolator(SR);
  scene = new SceneFx(SR);
  roll = new Roll(SR);
  rel: ReleaseFx;
  lim = new Limiter(SR);
  #grid = 0;
  #sceneFirst: boolean;

  constructor(opts: RefOptions = {}) {
    this.rel = new ReleaseFx(SR, opts.releaseSeconds ?? 10);
    this.#sceneFirst = opts.sceneFirst === true;
  }

  setBpm(bpm: number): void {
    this.scene.setBpm(bpm);
    this.roll.setBpm(bpm);
    this.rel.setBpm(bpm);
  }

  setSceneSlot(slot: SceneSlot): void {
    this.scene.setSlot(slot);
  }

  setSceneAmount(v: number): void {
    this.scene.setAmount(v);
  }

  setIsolator(low: number, mid: number, high: number): void {
    this.iso.setLow(low);
    this.iso.setMid(mid);
    this.iso.setHigh(high);
  }

  rollStart(division: RollDivision): void {
    this.roll.start(division);
  }

  rollStop(): void {
    this.roll.stop();
  }

  release(type: ReleaseType, beats?: number): void {
    this.rel.trigger(type, beats);
  }

  /** Clears the memory of every part (settings stay) and restarts the grid: the state of fresh parts with the settings applied. */
  settle(): void {
    this.iso.reset();
    this.scene.reset();
    this.roll.reset();
    this.rel.reset();
    this.lim.reset();
    this.#grid = 0;
  }

  process(l: Float32Array, r: Float32Array, frames: number): void {
    let off = 0;
    while (off < frames) {
      const n = Math.min(GRID - this.#grid, frames - off);
      const a = l.subarray(off, off + n);
      const b = r.subarray(off, off + n);
      if (this.#sceneFirst) {
        this.scene.process(a, b, n);
        this.iso.process(a, b, n);
      } else {
        this.iso.process(a, b, n);
        this.scene.process(a, b, n);
      }
      this.roll.process(a, b, n);
      this.rel.process(a, b, n);
      this.lim.process(a, b, n);
      this.#grid = (this.#grid + n) % GRID;
      off += n;
      if (this.#grid === 0 && this.rel.consumeFinished()) {
        this.scene.setAmount(0);
        this.roll.stop();
        this.iso.setLow(0.5);
        this.iso.setMid(0.5);
        this.iso.setHigh(0.5);
      }
    }
  }
}

/** A processor fed from known input; every `feed` call processes the next samples in place and remembers them. */
interface Session<T extends Proc> {
  fx: T;
  x: Input;
  ol: Float32Array;
  or: Float32Array;
  /** Index of the next sample to be processed. */
  pos: number;
  /** Processes `n` more samples (in blocks of `block`) and returns the index of the first one. */
  feed(n: number, block?: number): number;
}

function makeSession<T extends Proc>(x: Input, fx: T): Session<T> {
  const s: Session<T> = {
    fx,
    x,
    ol: x.l.slice(),
    or: x.r.slice(),
    pos: 0,
    feed(n: number, block = n) {
      const from = s.pos;
      if (from + n > x.l.length) throw new Error('session input too short');
      runBlocks((a, b, f) => fx.process(a, b, f), s.ol.subarray(from, from + n), s.or.subarray(from, from + n), Math.max(1, block));
      s.pos += n;
      return from;
    },
  };
  return s;
}

interface Call<T> {
  at: number;
  run: (t: T) => void;
}

/** Runs `fx` over x until `end`, making each call just before the sample at its `at` is processed. */
function play<T extends Proc>(fx: T, x: Input, script: Call<T>[], end: number, block?: number): Session<T> {
  const s = makeSession(x, fx);
  for (const c of script) {
    s.feed(c.at - s.pos, block);
    c.run(s.fx);
  }
  s.feed(end - s.pos, block);
  return s;
}

/** Index of the first sample in [from, to) where a and b differ, or -1. */
function firstMismatch(a: Float32Array, b: Float32Array, from: number, to: number): number {
  for (let i = from; i < to; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/** Largest distance in [from, to) between a and expected(index). */
function maxErr(a: Float32Array, from: number, to: number, expected: (n: number) => number): number {
  let worst = 0;
  for (let i = from; i < to; i++) worst = Math.max(worst, Math.abs(a[i] - expected(i)));
  return worst;
}

/** Both channels of two sessions are bit-identical over [from, to). */
function expectSame(a: Session<Proc>, b: Session<Proc>, to: number, from = 0): void {
  expect(firstMismatch(a.ol, b.ol, from, to)).toBe(-1);
  expect(firstMismatch(a.or, b.or, from, to)).toBe(-1);
}

/** Mulberry32: floats in [0, 1) from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('FxEngine', () => {
  it('rejects a bad sample rate and starts neutral with a stable state object', () => {
    for (const sr of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => new FxEngine(sr)).toThrow(RangeError);
    }
    const e = new FxEngine(SR);
    expect(e.state()).toEqual({ bypass: false, slot: 0, amount: 0, rollActive: false, releaseActive: false, limiterGain: 1, bpm: 120 });
    expect(e.state()).toBe(e.state());
  });

  it('chains isolator, scene, roll, release and limiter in that order', () => {
    const x = noiseInput(80000);
    const script = <T extends Rig>(): Call<T>[] => [
      {
        at: 0,
        run: (t) => {
          t.setIsolator(0, 0.5, 1);
          t.setSceneSlot(2);
          t.setSceneAmount(0.7);
          t.setBpm(100);
        },
      },
      { at: 40000, run: (t) => t.rollStart(0.5) },
      { at: 70000, run: (t) => t.rollStop() },
    ];
    const engine = play(new FxEngine(SR), x, script<FxEngine>(), 80000);
    const ref = play(new RefChain(), x, script<RefChain>(), 80000);
    expectSame(engine, ref, 80000);
    // the scene (NOISE) does not commute with the isolator, so the order is part of the contract
    const swapped = play(new RefChain({ sceneFirst: true }), x, script<RefChain>(), 80000);
    expect(firstMismatch(engine.ol, swapped.ol, 0, 80000)).toBeGreaterThanOrEqual(0);
    // and the roll really changes the sound: without it the output differs inside the roll
    const noRoll = play(new RefChain(), x, script<RefChain>().filter((c) => c.at !== 40000), 80000);
    expect(firstMismatch(engine.ol, noRoll.ol, 40000, 70000)).toBeGreaterThanOrEqual(0);
    // tempo 100 reaches the roll (a roll at the default 120 BPM would not match): covered by this test
    const wrongTempo = play(new RefChain(), x, script<RefChain>().map((c) => (c.at === 0 ? { at: 0, run: (t: RefChain) => { c.run(t); t.setBpm(120); } } : c)), 80000);
    expect(firstMismatch(engine.ol, wrongTempo.ol, 40000, 70000)).toBeGreaterThanOrEqual(0);
  });

  it('returns everything to neutral when a release finishes, on the grid block where its sound ended', () => {
    const total = 65000 + 6880 + 48000;
    const x = noiseInput(total + 100);
    const setup = (t: Rig): void => {
      t.setIsolator(0, 1, 0.2);
      t.setSceneSlot(1);
      t.setSceneAmount(0.8);
    };
    const e = new FxEngine(SR);
    const s = makeSession(x, e);
    setup(e);
    s.feed(60000);
    e.rollStart(0.25);
    s.feed(5000);
    expect(e.state().rollActive).toBe(true);
    e.release('brake', 0.25); // 6000 samples, then the input is back after 480 more
    s.feed(3000);
    expect(e.state().releaseActive).toBe(true);
    s.feed(6000 + 480 + 400 - 3000);
    const st = e.state();
    expect(st.amount).toBe(0);
    expect(st.rollActive).toBe(false);
    expect(st.releaseActive).toBe(false);
    // the isolator is back at unity: checked by comparing with the reference below and by the level of what follows
    s.feed(48000);

    const ref = play(
      new RefChain(),
      x,
      [
        { at: 0, run: setup },
        { at: 60000, run: (t) => t.rollStart(0.25) },
        { at: 65000, run: (t) => t.release('brake', 0.25) },
      ],
      total,
    );
    expectSame(s, ref, total);
    // chosen check for the isolator: the settings were (0, 1, 0.2), which changes the level of noise a lot;
    // after the cancel the output level over the last 40000 samples equals the input level
    const from = total - 40000;
    expect(Math.abs(toDb(rms(s.ol, from, total) / rms(x.l, from, total)))).toBeLessThan(0.5);
    expect(Math.abs(toDb(rms(s.or, from, total) / rms(x.r, from, total)))).toBeLessThan(0.5);
  });

  it('records long enough for a backspin at slow tempo (10 seconds)', () => {
    const total = 430000;
    const x = noiseInput(total);
    const script = <T extends Rig>(): Call<T>[] => [
      { at: 0, run: (t) => t.setBpm(60) },
      { at: 330000, run: (t) => t.release('backspin') },
    ];
    const engine = play(new FxEngine(SR), x, script<FxEngine>(), total);
    const ref = play(new RefChain(), x, script<RefChain>(), total);
    expectSame(engine, ref, total);
    // a 4 second recording would run out: the output differs from a reference with the default length
    const short = play(new RefChain({ releaseSeconds: 4 }), x, script<RefChain>(), total);
    expect(firstMismatch(engine.ol, short.ol, 330000, total)).toBeGreaterThanOrEqual(0);
    // tempo 60 reaches the release (a 2-beat spin at 120 BPM is half as long): covered by this test
    const rel = play(new FxEngine(SR), x, script<FxEngine>(), 331000);
    expect(rel.fx.state().releaseActive).toBe(true);
  });

  it('is transparent in level with neutral settings', () => {
    for (const freq of [100, 1000, 8000]) {
      const x = sine(freq, 1, SR, 0.5);
      const l = x.slice();
      const r = x.slice();
      const e = new FxEngine(SR);
      runBlocks((a, b, f) => e.process(a, b, f), l, r, 128);
      const ref = rms(x, 24000, 48000);
      expect(Math.abs(toDb(rms(l, 24000, 48000) / ref))).toBeLessThan(0.5);
      expect(Math.abs(toDb(rms(r, 24000, 48000) / ref))).toBeLessThan(0.5);
    }
  });

  /**
   * Bypass scenario: isolator (0, 0.5, 1) and scene slot 1 at 0.6; bypass on just before P = 30000 and off just
   * before Q = 50000. `w1` is the output of the chain without bypass from the start. `w2` is the output of fresh
   * parts with the settings applied and then reset, fed x[Q..]: no release is involved, so the grid does not matter
   * (the engine's grid does not advance while it is bypassed, the reference starts at 0 at Q).
   */
  const P = 30000;
  const Q = 50000;
  const END = 53000;
  const setupBypass = (t: Rig): void => {
    t.setIsolator(0, 0.5, 1);
    t.setSceneSlot(1);
    t.setSceneAmount(0.6);
  };
  function bypassScenario() {
    const x = noiseInput(60000);
    const e = new FxEngine(SR);
    setupBypass(e);
    const s = makeSession(x, e);
    s.feed(P);
    e.setBypass(true);
    const bypassNow = e.state().bypass;
    s.feed(Q - P);
    e.setBypass(false);
    s.feed(END - Q);
    const w1 = makeSession(x, new RefChain());
    setupBypass(w1.fx);
    w1.feed(END);
    const fresh = new RefChain();
    setupBypass(fresh);
    fresh.settle();
    const w2l = x.l.slice();
    const w2r = x.r.slice();
    fresh.process(w2l.subarray(Q, END), w2r.subarray(Q, END), END - Q);
    return { x, s, w1, w2l, w2r, bypassNow };
  }

  it('crossfades to the untouched input over 10 ms when bypass is switched on', () => {
    const { x, s, w1, bypassNow } = bypassScenario();
    expect(bypassNow).toBe(true);
    for (const [out, dry, wet] of [
      [s.ol, x.l, w1.ol],
      [s.or, x.r, w1.or],
    ]) {
      const expected = (n: number): number => wet[n] + (dry[n] - wet[n]) * ((n - P + 1) / FADE);
      expect(maxErr(out, P, P + FADE - 1, expected)).toBeLessThan(1e-6);
      expect(firstMismatch(out, dry, P + FADE - 1, Q)).toBe(-1);
    }
    // before the switch the chain was running
    expect(firstMismatch(s.ol, x.l, 0, P)).toBeGreaterThanOrEqual(0);
  });

  it('is bit-exact and total while bypassed, including non-finite samples', () => {
    const e = new FxEngine(SR);
    e.setSceneSlot(2);
    e.setSceneAmount(0.9);
    e.setIsolator(0, 1, 1);
    e.setBypass(true);
    e.reset();
    const n = 1000;
    const l = noise(n, 5, 0.7);
    const r = noise(n, 6, 0.7);
    l[0] = NaN;
    l[1] = Infinity;
    l[2] = -Infinity;
    r[3] = NaN;
    r[130] = Infinity;
    r[777] = -Infinity;
    l[999] = NaN;
    const l0 = l.slice();
    const r0 = r.slice();
    e.process(l, r, n);
    let bad = -1;
    for (let i = 0; i < n && bad < 0; i++) {
      if (!Object.is(l[i], l0[i]) || !Object.is(r[i], r0[i])) bad = i;
    }
    expect(bad).toBe(-1);

    // the same holds for the rest of the grid block in which a fade to bypass completes (30000 + 479 is mid-block)
    const e2 = new FxEngine(SR);
    e2.setSceneSlot(2);
    e2.setSceneAmount(0.9);
    const warm = noiseInput(30000);
    e2.process(warm.l, warm.r, 30000);
    e2.setBypass(true);
    const m = 1500;
    const l2 = noise(m, 7, 0.7);
    const r2 = noise(m, 8, 0.7);
    l2[500] = NaN;
    l2[501] = Infinity;
    r2[502] = -Infinity;
    r2[600] = NaN;
    const l2o = l2.slice();
    const r2o = r2.slice();
    e2.process(l2, r2, m);
    let bad2 = -1;
    for (let i = FADE - 1; i < m && bad2 < 0; i++) {
      if (!Object.is(l2[i], l2o[i]) || !Object.is(r2[i], r2o[i])) bad2 = i;
    }
    expect(bad2).toBe(-1);
  });

  it('crossfades back to the chain over 10 ms with cleared memory when bypass is switched off', () => {
    const { x, s, w2l, w2r } = bypassScenario();
    for (const [out, dry, wet] of [
      [s.ol, x.l, w2l],
      [s.or, x.r, w2r],
    ]) {
      const expected = (n: number): number => wet[n] + (dry[n] - wet[n]) * ((FADE - 1 - (n - Q)) / FADE);
      expect(maxErr(out, Q, Q + FADE - 1, expected)).toBeLessThan(1e-6);
      expect(firstMismatch(out, wet, Q + FADE - 1, END)).toBe(-1);
    }
  });

  it('ignores triggers while bypassed, keeps the settings and applies them afterwards', () => {
    const total = 40000;
    const x = noiseInput(total);
    const e = new FxEngine(SR);
    const s = makeSession(x, e);
    e.setBypass(true);
    e.reset();
    e.rollStart(0.5);
    e.release('echo');
    expect(e.state().rollActive).toBe(false);
    expect(e.state().releaseActive).toBe(false);
    e.setSceneSlot(3);
    e.setSceneAmount(-0.4);
    e.setBpm(90);
    expect(e.state()).toEqual({ bypass: true, slot: 3, amount: -0.4, rollActive: false, releaseActive: false, limiterGain: 1, bpm: 90 });
    s.feed(5000);
    expect(firstMismatch(s.ol, x.l, 0, 5000)).toBe(-1);
    e.setBypass(false);
    s.feed(total - 5000);
    expect(e.state().rollActive).toBe(false);
    expect(e.state().releaseActive).toBe(false);

    // also during the fade into bypass, when the roll already has a recording to start from
    const f = new FxEngine(SR);
    const warm = noiseInput(6000);
    f.process(warm.l, warm.r, 6000);
    f.setBypass(true);
    f.process(warm.l.slice(0, 100), warm.r.slice(0, 100), 100);
    f.rollStart(0.5);
    f.release('echo');
    expect(f.state().rollActive).toBe(false);
    expect(f.state().releaseActive).toBe(false);

    const expectedOut = (bpm: number): Session<RefChain> => {
      // same history as the engine: the parts were cleared first (bypass completed), then the settings came in
      const ref = new RefChain();
      ref.settle();
      ref.setSceneSlot(3);
      ref.setSceneAmount(-0.4);
      ref.setBpm(bpm);
      const t = makeSession(x, ref);
      t.pos = 5000;
      t.feed(total - 5000);
      return t;
    };
    const ref = expectedOut(90);
    expect(firstMismatch(s.ol, ref.ol, 5000 + FADE - 1, total)).toBe(-1);
    expect(firstMismatch(s.or, ref.or, 5000 + FADE - 1, total)).toBe(-1);
    // the tempo reaches the scene (SPIRAL DOWN follows it): at 120 BPM the output would differ; covered by this test
    const other = expectedOut(120);
    expect(firstMismatch(s.ol, other.ol, 5000 + FADE - 1, total)).toBeGreaterThanOrEqual(0);
  });

  it('survives 20 seconds of random control changes with finite, bounded output', () => {
    const total = 20 * SR;
    const x = noiseInput(total, 1);
    const e = new FxEngine(SR);
    const rand = mulberry32(0xc0ffee);
    const KINDS = ['bpm', 'bypass', 'slot', 'amount', 'isolator', 'rollStart', 'rollStop', 'release', 'reset'];
    const counts: number[] = KINDS.map(() => 0);
    const divisions: RollDivision[] = [1, 0.5, 0.25, 0.125];
    const types: ReleaseType[] = ['brake', 'echo', 'backspin'];
    const badSlots = [-1, 5, 2.5, NaN, 99];
    for (let at = 0; at < total; at += GRID) {
      if (rand() < 1 / 20) {
        const k = Math.floor(rand() * KINDS.length);
        counts[k]++;
        const v = rand();
        switch (KINDS[k]) {
          case 'bpm':
            e.setBpm(v < 0.15 ? 0 : v < 0.3 ? 1000 : v < 0.4 ? NaN : 40 + rand() * 200);
            break;
          case 'bypass':
            e.setBypass(v < 0.5);
            break;
          case 'slot':
            e.setSceneSlot((v < 0.3 ? badSlots[Math.floor(rand() * badSlots.length)] : Math.floor(rand() * 5)) as SceneSlot);
            break;
          case 'amount':
            e.setSceneAmount(v < 0.1 ? NaN : rand() * 3 - 1.5);
            break;
          case 'isolator':
            e.setIsolator(rand() * 2 - 0.5, rand() * 2 - 0.5, rand() * 2 - 0.5);
            break;
          case 'rollStart':
            e.rollStart(divisions[Math.floor(rand() * 4)]);
            break;
          case 'rollStop':
            e.rollStop();
            break;
          case 'release':
            e.release(types[Math.floor(rand() * 3)], 0.25 + rand() * 3.75);
            break;
          default:
            e.reset();
        }
      }
      e.process(x.l.subarray(at, at + GRID), x.r.subarray(at, at + GRID), GRID);
    }
    let bad = 0;
    for (let i = 0; i < total; i++) {
      if (!(Math.abs(x.l[i]) <= 1) || !(Math.abs(x.r[i]) <= 1)) bad++;
    }
    expect(bad).toBe(0);
    KINDS.forEach((name, k) => {
      expect(counts[k], name).toBeGreaterThanOrEqual(5);
    });
  });

  it('gives finite output for non-finite input, also with a scene effect, a roll and a release running', () => {
    const total = 40000;
    const x = noiseInput(total);
    for (let i = 7; i < total; i += 331) {
      x.l[i] = NaN;
      x.r[i + 1 < total ? i + 1 : i] = i % 2 === 0 ? Infinity : -Infinity;
      x.l[i + 2 < total ? i + 2 : i] = -Infinity;
    }
    const plain = play(new FxEngine(SR), x, [], total);
    expect(allFinite(plain.ol) && allFinite(plain.or)).toBe(true);
    const busy = play(
      new FxEngine(SR),
      x,
      [
        {
          at: 0,
          run: (t) => {
            t.setSceneSlot(1);
            t.setSceneAmount(0.8);
          },
        },
        { at: 5000, run: (t) => t.rollStart(0.25) },
        { at: 20000, run: (t) => t.release('echo', 1) },
      ],
      total,
    );
    expect(busy.fx.state().releaseActive).toBe(true);
    expect(allFinite(busy.ol) && allFinite(busy.or)).toBe(true);
  });

  it('limits to the ceiling, also while a release is running', () => {
    const total = 5 * SR;
    const x = noiseInput(total, 1);
    const hot = play(new FxEngine(SR), x, [{ at: 0, run: (t) => t.setIsolator(1, 1, 1) }], total);
    expect(rms(x.l)).toBeGreaterThan(0.5);
    let worst = 0;
    for (let i = 0; i < total; i++) worst = Math.max(worst, Math.abs(hot.ol[i]), Math.abs(hot.or[i]));
    expect(worst).toBeLessThanOrEqual(0.98 + 1e-6);
    expect(hot.fx.state().limiterGain).toBeLessThan(1);
    // the limiter comes after the release: its output is limited too
    const echo = play(
      new FxEngine(SR),
      x,
      [
        { at: 0, run: (t) => t.setIsolator(1, 1, 1) },
        { at: 20000, run: (t) => t.release('echo', 2) },
      ],
      total,
    );
    let worstEcho = 0;
    for (let i = 20000; i < total; i++) worstEcho = Math.max(worstEcho, Math.abs(echo.ol[i]), Math.abs(echo.or[i]));
    expect(worstEcho).toBeLessThanOrEqual(0.98 + 1e-6);
  });

  it('clamps the tempo and ignores non-finite values', () => {
    // forwarding to the parts is covered elsewhere: the roll by the chain test, the release by the recording test,
    // the scene by the bypassed-settings test
    const e = new FxEngine(SR);
    e.setBpm(1000);
    expect(e.state().bpm).toBe(240);
    e.setBpm(1);
    expect(e.state().bpm).toBe(40);
    e.setBpm(NaN);
    expect(e.state().bpm).toBe(40);
    e.setBpm(Infinity);
    expect(e.state().bpm).toBe(40);
    e.setBpm(95);
    expect(e.state().bpm).toBe(95);
  });

  it('reset keeps the settings, ends roll and release and starts like fresh parts', () => {
    const total = 10050 + 20000;
    const x = noiseInput(total);
    const setup = (t: Rig): void => {
      t.setIsolator(0, 1, 0.2);
      t.setSceneSlot(2);
      t.setSceneAmount(-0.7);
      t.setBpm(100);
    };
    const e = new FxEngine(SR);
    const s = makeSession(x, e);
    setup(e);
    s.feed(10050); // not a multiple of 128, so the grid is mid-block at the reset
    e.rollStart(0.5);
    e.release('echo');
    expect(e.state().rollActive).toBe(true);
    expect(e.state().releaseActive).toBe(true);
    e.reset();
    expect(e.state()).toEqual({ bypass: false, slot: 2, amount: -0.7, rollActive: false, releaseActive: false, limiterGain: 1, bpm: 100 });
    s.feed(3000);
    e.release('brake', 0.25); // finishes on the grid, which reset restarted
    s.feed(total - 10050 - 3000);

    const ref = new RefChain();
    setup(ref);
    ref.settle();
    const t = makeSession(x, ref);
    t.pos = 10050;
    t.feed(3000);
    ref.release('brake', 0.25);
    t.feed(total - 10050 - 3000);
    expect(firstMismatch(s.ol, t.ol, 10050, total)).toBe(-1);
    expect(firstMismatch(s.or, t.or, 10050, total)).toBe(-1);
    expect(e.state().amount).toBe(0); // the release did finish, so the cancel happened

    // with bypass on, reset gives untouched buffers at once
    const b = new FxEngine(SR);
    setup(b);
    b.process(x.l.slice(0, 4000), x.r.slice(0, 4000), 4000);
    b.setBypass(true);
    b.reset();
    expect(b.state().bypass).toBe(true);
    const l = x.l.slice(0, 1000);
    const r = x.r.slice(0, 1000);
    b.process(l, r, 1000);
    expect(firstMismatch(l, x.l, 0, 1000)).toBe(-1);
    expect(firstMismatch(r, x.r, 0, 1000)).toBe(-1);
  });

  it('gives the same output whatever the block size of the caller', () => {
    const total = 60000;
    const x = noiseInput(total);
    const script: Call<FxEngine>[] = [
      {
        at: 0,
        run: (t) => {
          t.setBpm(100);
          t.setIsolator(0, 1, 0.2);
          t.setSceneSlot(2);
          t.setSceneAmount(0.6);
        },
      },
      { at: 5000, run: (t) => t.rollStart(0.5) },
      { at: 15000, run: (t) => t.rollStop() },
      { at: 20000, run: (t) => t.release('brake', 0.25) },
      { at: 40000, run: (t) => t.setBypass(true) },
      { at: 50000, run: (t) => t.setBypass(false) },
    ];
    const base = play(new FxEngine(SR), x, script, total);
    expect(base.fx.state().amount).toBe(0); // the release finished and cancelled
    expect(firstMismatch(base.ol, x.l, 40000 + FADE - 1, 50000)).toBe(-1); // and bypass really was on
    for (const block of [1, 100, 128, 4096]) {
      const s = play(new FxEngine(SR), x, script, total, block);
      expect(firstMismatch(s.ol, base.ol, 0, total), `left, block ${block}`).toBe(-1);
      expect(firstMismatch(s.or, base.or, 0, total), `right, block ${block}`).toBe(-1);
    }
  });

  it('restarts the grid when bypass completes, so a later release cancels at the same sample for any block size', () => {
    const total = 45000;
    const x = noiseInput(total);
    const script: Call<FxEngine>[] = [
      {
        at: 0,
        run: (t) => {
          t.setBpm(100);
          t.setIsolator(0, 1, 0.2);
          t.setSceneSlot(2);
          t.setSceneAmount(0.6);
        },
      },
      // the fade to bypass completes at 10479, in the middle of a grid block
      { at: 10000, run: (t) => t.setBypass(true) },
      { at: 20001, run: (t) => t.setBypass(false) },
      // 0.25 beat at 100 BPM is 7200 samples: the sound ends at 37200 and the cancel follows on the grid
      { at: 30000, run: (t) => t.release('brake', 0.25) },
    ];
    const base = play(new FxEngine(SR), x, script, total);
    expect(base.fx.state().amount).toBe(0);
    for (const block of [1, 100, 128, 4096]) {
      const s = play(new FxEngine(SR), x, script, total, block);
      expect(firstMismatch(s.ol, base.ol, 0, total), `left, block ${block}`).toBe(-1);
      expect(firstMismatch(s.or, base.or, 0, total), `right, block ${block}`).toBe(-1);
    }
    // the grid starts again at the first sample after bypass: a reference that starts there agrees
    const ref = new RefChain();
    ref.setBpm(100);
    ref.setIsolator(0, 1, 0.2);
    ref.setSceneSlot(2);
    ref.setSceneAmount(0.6);
    ref.settle();
    const r = makeSession({ l: x.l.subarray(20001), r: x.r.subarray(20001) }, ref);
    r.feed(30000 - 20001);
    ref.release('brake', 0.25);
    r.feed(total - 30000);
    expect(firstMismatch(base.ol.subarray(20001), r.ol, FADE, total - 20001)).toBe(-1);
    expect(firstMismatch(base.or.subarray(20001), r.or, FADE, total - 20001)).toBe(-1);
  });

  it('stays finite and still takes rollStop during the bypass crossfades', () => {
    const total = 30000;
    const x = noiseInput(total);
    // non-finite samples inside both crossfades
    for (const at of [10010, 10200, 20010, 20200]) {
      x.l[at] = NaN;
      x.r[at] = at % 20 === 0 ? Infinity : -Infinity;
    }
    const eng = new FxEngine(SR);
    const s = makeSession(x, eng);
    s.feed(8000);
    eng.rollStart(0.25);
    s.feed(2000);
    expect(eng.state().rollActive).toBe(true);
    eng.setBypass(true);
    s.feed(100);
    eng.rollStop(); // bypass is fading in: a stop must still get through
    expect(eng.state().rollActive).toBe(false);
    s.feed(FADE - 100 - 1);
    expect(allFinite(s.ol.subarray(0, s.pos)) && allFinite(s.or.subarray(0, s.pos))).toBe(true);
    s.feed(20000 - s.pos);
    eng.setBypass(false);
    s.feed(FADE + 2000);
    expect(allFinite(s.ol.subarray(20000, s.pos)) && allFinite(s.or.subarray(20000, s.pos))).toBe(true);
  });

  it('processes only the first `frames` samples and ignores empty or invalid counts', () => {
    const e = new FxEngine(SR);
    e.setSceneSlot(2);
    e.setSceneAmount(0.8);
    e.setIsolator(0, 1, 1);
    const x = noiseInput(256);
    const l = x.l.slice();
    const r = x.r.slice();
    e.process(l, r, 100);
    expect(firstMismatch(l, x.l, 100, 256)).toBe(-1);
    expect(firstMismatch(r, x.r, 100, 256)).toBe(-1);
    expect(firstMismatch(l, x.l, 0, 100)).toBeGreaterThanOrEqual(0);
    expect(firstMismatch(r, x.r, 0, 100)).toBeGreaterThanOrEqual(0);
    for (const frames of [0, NaN, -5]) {
      const a = x.l.slice();
      const b = x.r.slice();
      e.process(a, b, frames);
      expect(firstMismatch(a, x.l, 0, 256), `frames ${frames}`).toBe(-1);
      expect(firstMismatch(b, x.r, 0, 256), `frames ${frames}`).toBe(-1);
    }
  });
});
