import { describe, expect, it } from 'vitest';
import { FilterEcho } from '../../src/fx/effects/echo';
import { NoiseSweep } from '../../src/fx/effects/noiseSweep';
import { ReverbSweep } from '../../src/fx/effects/reverbSweep';
import { Spiral } from '../../src/fx/effects/spiral';
import { SCENE_TABLE, SceneFx } from '../../src/fx/scene';
import type { SceneSlot, StereoEffect } from '../../src/fx/types';
import { allFinite, noise, rms, runBlocks, sine, toDb } from '../fixtures/synthAudio';

const SR = 48000;
const FADE = 480; // 10 ms at 48 kHz

type Standalone = StereoEffect & { setAmount(v: number): void };

interface Entry {
  slot: SceneSlot;
  sign: 1 | -1;
  name: string;
  /** A standalone instance of the effect the scene should hold at this slot and sign, written out here on purpose. */
  make: () => Standalone;
}

const ENTRIES: Entry[] = [
  { slot: 0, sign: 1, name: 'BPF ECHO', make: () => new FilterEcho(SR, { filter: 'bpf' }) },
  { slot: 0, sign: -1, name: 'HPF ECHO', make: () => new FilterEcho(SR, { filter: 'hpf' }) },
  { slot: 1, sign: 1, name: 'ECHO', make: () => new FilterEcho(SR, { filter: 'none' }) },
  { slot: 1, sign: -1, name: 'LPF ECHO', make: () => new FilterEcho(SR, { filter: 'lpf' }) },
  { slot: 2, sign: 1, name: 'NOISE', make: () => new NoiseSweep(SR) },
  { slot: 2, sign: -1, name: 'CRUSH ECHO', make: () => new FilterEcho(SR, { filter: 'none', crush: true }) },
  { slot: 3, sign: 1, name: 'SPIRAL UP', make: () => new Spiral(SR, 'up') },
  { slot: 3, sign: -1, name: 'SPIRAL DOWN', make: () => new Spiral(SR, 'down') },
  { slot: 4, sign: 1, name: 'REVERB UP', make: () => new ReverbSweep(SR, 'up') },
  { slot: 4, sign: -1, name: 'REVERB DOWN', make: () => new ReverbSweep(SR, 'down') },
];

const ECHO = (): FilterEcho => new FilterEcho(SR, { filter: 'none' });
const SPIRAL_UP = (): Spiral => new Spiral(SR, 'up');

type Channel = 'l' | 'r';
const CHANNELS: Channel[] = ['l', 'r'];

interface Input {
  l: Float32Array;
  r: Float32Array;
}

/** Noise with different seeds on the two channels. */
function noiseInput(total: number): Input {
  return { l: noise(total, 11, 0.5), r: noise(total, 22, 0.5) };
}

/** A SceneFx fed from known input; every `feed` call processes the next samples in place and remembers them. */
interface Session {
  fx: SceneFx;
  x: Input;
  ol: Float32Array;
  or: Float32Array;
  /** Index of the next sample to be processed. */
  pos: number;
  /** Processes `n` more samples (in blocks of `block`) and returns the index of the first one. */
  feed(n: number, block?: number): number;
}

function makeSession(x: Input, fx = new SceneFx(SR)): Session {
  const s: Session = {
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

interface Call {
  at: number;
  run: (fx: SceneFx) => void;
}

/** Runs a scene over x until `end`, making each call just before the sample at its `at` is processed. */
function play(x: Input, script: Call[], end: number, block?: number): Session {
  const s = makeSession(x);
  for (const c of script) {
    s.feed(c.at - s.pos, block);
    c.run(s.fx);
  }
  s.feed(end - s.pos, block);
  return s;
}

/** The output of a standalone effect fed `x` from `from` to `to` (indexes as in x). `steps` are applied just before their sample. */
interface Ref {
  l: Float32Array;
  r: Float32Array;
}

interface RefStep<T> {
  at: number;
  run: (fx: T) => void;
}

/** The gain of the input fed into an effect m samples after it started. */
const ramp = (m: number): number => Math.min(1, (m + 1) / FADE);

/**
 * `fx` fed x from `from` to `to`. By default the input is ramped in from `from`, as the scene feeds a starting
 * effect; `ramped = false` feeds it plain.
 */
function standalone<T extends Standalone>(
  fx: T,
  x: Input,
  from: number,
  to: number,
  setup: (fx: T) => void,
  steps: RefStep<T>[] = [],
  ramped = true,
): Ref {
  const ref: Ref = { l: x.l.slice(), r: x.r.slice() };
  if (ramped) {
    for (let n = from; n < to; n++) {
      ref.l[n] = x.l[n] * ramp(n - from);
      ref.r[n] = x.r[n] * ramp(n - from);
    }
  }
  setup(fx);
  let pos = from;
  const go = (end: number): void => {
    if (end > pos) fx.process(ref.l.subarray(pos, end), ref.r.subarray(pos, end), end - pos);
    pos = end;
  };
  for (const st of steps) {
    go(st.at);
    st.run(fx);
  }
  go(to);
  return ref;
}

/** A fresh standalone effect started at `from` with the amount `a`. */
function fresh(make: () => Standalone, x: Input, from: number, to: number, a: number): Ref {
  return standalone(make(), x, from, to, (fx) => fx.setAmount(a));
}

/**
 * First output index in [from, to) where either channel differs from `expected(ch, n)` by more than `tol`
 * (exact match when tol is 0), or -1 when all match.
 */
function firstBad(s: Session, from: number, to: number, expected: (ch: Channel, n: number) => number, tol = 0): number {
  for (let n = from; n < to; n++) {
    for (const c of CHANNELS) {
      const out = c === 'l' ? s.ol : s.or;
      const want = expected(c, n);
      if (tol === 0 ? out[n] !== want : !(Math.abs(out[n] - want) <= tol)) return n;
    }
  }
  return -1;
}

/** First index in [from, to) where the output is not the input, or -1. */
function passBad(s: Session, from: number, to: number): number {
  return firstBad(s, from, to, (c, n) => (c === 'l' ? s.x.l[n] : s.x.r[n]));
}

/** First index in [from, to) where the output is not exactly the reference, or -1. */
function exactBad(s: Session, from: number, to: number, ref: Ref): number {
  return firstBad(s, from, to, (c, n) => (c === 'l' ? ref.l[n] : ref.r[n]));
}

interface Term {
  ref: Ref;
  gain: (n: number) => number;
  /** The part of the dry signal the effect was fed at sample n; 1 when omitted. */
  fed?: (n: number) => number;
}

/** First index in [from, to) where the output is not `x + sum of gain * (wet - x * fed)` within `tol`, or -1. */
function blendBad(s: Session, from: number, to: number, terms: Term[], tol = 1e-6): number {
  return firstBad(
    s,
    from,
    to,
    (c, n) => {
      const x = c === 'l' ? s.x.l : s.x.r;
      let v = x[n];
      for (const t of terms) v += t.gain(n) * ((c === 'l' ? t.ref.l[n] : t.ref.r[n]) - x[n] * (t.fed ? t.fed(n) : 1));
      return v;
    },
    tol,
  );
}

/** A fade out that begins at sample P: the first sample at P has (FADE - 1)/FADE. */
const fadeOut = (P: number) => (n: number): number => Math.max(0, FADE - 1 - (n - P)) / FADE;

/** The input ramp of an effect that started at sample S. */
const rampFrom = (S: number) => (n: number): number => ramp(n - S);

/** Checks the start formula over the fade and exactness after it, up to `to`. Returns the first bad index or -1. */
function startBad(s: Session, S: number, to: number, ref: Ref): number {
  const a = blendBad(s, S, S + FADE, [{ ref, gain: () => 1, fed: rampFrom(S) }]);
  return a !== -1 ? a : exactBad(s, S + FADE, to, ref);
}

/** Checks the switch formula over the fade and exactness of the incoming effect after it. */
function switchBad(s: Session, P: number, to: number, from: Ref, into: Ref): number {
  const a = blendBad(s, P, P + FADE, [
    { ref: from, gain: fadeOut(P) },
    { ref: into, gain: () => 1, fed: rampFrom(P) },
  ]);
  return a !== -1 ? a : exactBad(s, P + FADE, to, into);
}

describe('SceneFx', () => {
  it('has the documented table, validates the sample rate and starts at slot 0, amount 0', () => {
    expect(SCENE_TABLE).toEqual({
      0: { up: 'BPF ECHO', down: 'HPF ECHO' },
      1: { up: 'ECHO', down: 'LPF ECHO' },
      2: { up: 'NOISE', down: 'CRUSH ECHO' },
      3: { up: 'SPIRAL UP', down: 'SPIRAL DOWN' },
      4: { up: 'REVERB UP', down: 'REVERB DOWN' },
    });
    for (const e of ENTRIES) expect(e.name).toBe(SCENE_TABLE[e.slot][e.sign === 1 ? 'up' : 'down']);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => new SceneFx(bad)).toThrow(RangeError);
    const fx = new SceneFx(SR);
    expect(fx.slot).toBe(0);
    expect(fx.amount).toBe(0);
  });

  it('passes the input through exactly while the amount is 0, for every slot', () => {
    const s = makeSession(noiseInput(5000));
    for (const slot of [0, 1, 2, 3, 4] as SceneSlot[]) {
      s.fx.setSlot(slot);
      s.feed(1000);
    }
    expect(passBad(s, 0, 5000)).toBe(-1);
  });

  for (const e of ENTRIES) {
    it(`holds ${e.name} at slot ${e.slot}, sign ${e.sign > 0 ? '+' : '-'}: fades in, then equals the standalone effect`, () => {
      const S = 2000;
      const total = S + 30000;
      const x = noiseInput(total);
      const s = play(
        x,
        [
          {
            at: S,
            run: (fx) => {
              fx.setSlot(e.slot);
              fx.setAmount(e.sign * 0.7);
            },
          },
        ],
        total,
      );
      const ref = fresh(e.make, x, S, total, 0.7);
      expect(passBad(s, 0, S)).toBe(-1);
      expect(startBad(s, S, total, ref)).toBe(-1);
      const diff = new Float32Array(total - S);
      for (let n = S; n < total; n++) diff[n - S] = s.ol[n] - x.l[n];
      const db = toDb(rms(diff)) - toDb(rms(x.l, S, total));
      expect(db).toBeGreaterThan(-40);
      expect(allFinite(s.ol) && allFinite(s.or)).toBe(true);
    });
  }

  it('passes amount changes on to the effect', () => {
    const total = 25000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.3) },
        { at: 12000, run: (fx) => fx.setAmount(0.9) },
      ],
      total,
    );
    const ref = standalone(ECHO(), x, 2000, total, (fx) => fx.setAmount(0.3), [{ at: 12000, run: (fx) => fx.setAmount(0.9) }]);
    expect(startBad(s, 2000, total, ref)).toBe(-1);
    // the second amount is clearly audible, so a lost change would show
    const lost = standalone(ECHO(), x, 2000, total, (fx) => fx.setAmount(0.3));
    expect(exactBad(s, 14000, total, lost)).not.toBe(-1);
  });

  it('stops with a fade, passes the input through, and restarts clean', () => {
    const total = 60000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.6) },
        { at: 20000, run: (fx) => fx.setAmount(0) },
        { at: 30000, run: (fx) => fx.setAmount(0.5) },
      ],
      total,
    );
    const running = fresh(ECHO, x, 2000, total, 0.6);
    expect(blendBad(s, 20000, 20000 + FADE, [{ ref: running, gain: fadeOut(20000) }])).toBe(-1);
    expect(passBad(s, 20000 + FADE, 30000)).toBe(-1);
    const again = fresh(ECHO, x, 30000, total, 0.5);
    expect(startBad(s, 30000, total, again)).toBe(-1);
  });

  it('crossfades when the slot changes, and a returning effect starts clean', () => {
    const total = 62000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: 20000, run: (fx) => fx.setSlot(3) },
        { at: 40000, run: (fx) => fx.setSlot(1) },
      ],
      total,
    );
    const echo = fresh(ECHO, x, 2000, total, 0.7);
    const spiral = fresh(SPIRAL_UP, x, 20000, total, 0.7);
    expect(switchBad(s, 20000, 40000, echo, spiral)).toBe(-1);
    const echo2 = fresh(ECHO, x, 40000, total, 0.7);
    // SPIRAL UP has run since 20000 without a break
    expect(switchBad(s, 40000, total, spiral, echo2)).toBe(-1);
  });

  it('crossfades between the two effects of a slot when the sign flips', () => {
    const total = 42000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(0) },
        { at: 2000, run: (fx) => fx.setAmount(0.5) },
        { at: 20000, run: (fx) => fx.setAmount(-0.5) },
      ],
      total,
    );
    const bpf = fresh(() => new FilterEcho(SR, { filter: 'bpf' }), x, 2000, total, 0.5);
    const hpf = fresh(() => new FilterEcho(SR, { filter: 'hpf' }), x, 20000, total, 0.5);
    expect(switchBad(s, 20000, total, bpf, hpf)).toBe(-1);
  });

  it('never sounds an effect that was selected and replaced before any sample', () => {
    const total = 62000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.5) },
        {
          at: 20000,
          run: (fx) => {
            fx.setSlot(2);
            fx.setAmount(-0.5);
          },
        },
        { at: 40000, run: (fx) => fx.setAmount(0.5) },
      ],
      total,
    );
    const echo = fresh(ECHO, x, 2000, total, 0.5);
    const crush = fresh(() => new FilterEcho(SR, { filter: 'none', crush: true }), x, 20000, total, 0.5);
    expect(switchBad(s, 20000, 40000, echo, crush)).toBe(-1);
    // NOISE never sounded, so it is fresh when it is first wanted
    const noiseRef = fresh(() => new NoiseSweep(SR), x, 40000, total, 0.5);
    expect(switchBad(s, 40000, total, crush, noiseRef)).toBe(-1);
  });

  it('brings back an outgoing effect when it is wanted again during the crossfade', () => {
    const P = 20000;
    const Q = 20100;
    const total = 25000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: P, run: (fx) => fx.setSlot(3) },
        { at: Q, run: (fx) => fx.setSlot(1) },
      ],
      total,
    );
    const a = fresh(ECHO, x, 2000, total, 0.7);
    const b = fresh(SPIRAL_UP, x, P, total, 0.7);
    expect(
      blendBad(s, Q, Q + 479, [
        { ref: a, gain: (n) => Math.min(480, 381 + (n - Q)) / 480 },
        { ref: b, gain: (n) => Math.max(0, 479 - (n - Q)) / 480, fed: rampFrom(P) },
      ]),
    ).toBe(-1);
    expect(exactBad(s, Q + 479, total, a)).toBe(-1);
  });

  it('cuts the quieter of three effects sounding at once', () => {
    const total = 42000;
    const x = noiseInput(total);
    const base: Call[] = [
      { at: 0, run: (fx) => fx.setSlot(1) },
      { at: 2000, run: (fx) => fx.setAmount(0.7) },
      { at: 20000, run: (fx) => fx.setSlot(3) },
    ];
    const echo = fresh(ECHO, x, 2000, total, 0.7);

    // (a) the newcomer SPIRAL UP is quieter than ECHO: it is cut
    const sa = play(x, [...base, { at: 20100, run: (fx) => fx.setSlot(4) }], total);
    const reverbA = fresh(() => new ReverbSweep(SR, 'up'), x, 20100, total, 0.7);
    expect(
      blendBad(sa, 20100, total, [
        { ref: echo, gain: (n) => Math.max(0, 379 - (n - 20100)) / 480 },
        { ref: reverbA, gain: () => 1, fed: rampFrom(20100) },
      ]),
    ).toBe(-1);

    // (b) ECHO is quieter than SPIRAL UP: ECHO is cut
    const sb = play(x, [...base, { at: 20400, run: (fx) => fx.setSlot(4) }], total);
    const spiral = fresh(SPIRAL_UP, x, 20000, total, 0.7);
    const reverbB = fresh(() => new ReverbSweep(SR, 'up'), x, 20400, total, 0.7);
    expect(
      blendBad(sb, 20400, total, [
        { ref: spiral, gain: (n) => Math.max(0, 479 - (n - 20400)) / 480, fed: rampFrom(20000) },
        { ref: reverbB, gain: () => 1, fed: rampFrom(20400) },
      ]),
    ).toBe(-1);
  });

  it('stops cleanly when the effect is switched off during its fade-in', () => {
    const total = 12000;
    const x = noiseInput(total);
    for (const e of ENTRIES.filter((v) => v.name === 'NOISE' || v.name === 'REVERB UP')) {
      const S = 2000;
      const s = play(
        x,
        [
          {
            at: S,
            run: (fx) => {
              fx.setSlot(e.slot);
              fx.setAmount(0.7);
            },
          },
          { at: S + 100, run: (fx) => fx.setAmount(0) },
        ],
        total,
      );
      const ref = fresh(e.make, x, S, total, 0.7);
      expect(blendBad(s, S, S + 100, [{ ref, gain: () => 1, fed: rampFrom(S) }])).toBe(-1);
      expect(blendBad(s, S + 100, S + 579, [{ ref, gain: (n) => Math.max(0, 479 - (n - S - 100)) / 480, fed: rampFrom(S) }])).toBe(-1);
      expect(passBad(s, S + 579, total)).toBe(-1);
    }
  });

  it('fades back in when the amount returns during a fade-out, without resetting the effect', () => {
    const P = 20000;
    const total = 30000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.6) },
        { at: P, run: (fx) => fx.setAmount(0) },
        { at: P + 100, run: (fx) => fx.setAmount(0.6) },
      ],
      total,
    );
    const e = fresh(ECHO, x, 2000, total, 0.6);
    expect(blendBad(s, P + 100, P + 199, [{ ref: e, gain: (n) => Math.min(480, 381 + (n - P - 100)) / 480 }])).toBe(-1);
    expect(exactBad(s, P + 199, total, e)).toBe(-1);
  });

  it('forwards the tempo to the effects, including ones that are not sounding yet', () => {
    const total = 30000;
    const x = noiseInput(total);
    const echoAt100 = (fx: FilterEcho): void => {
      fx.setBpm(100);
      fx.setAmount(0.7);
    };
    const s1 = play(
      x,
      [
        { at: 0, run: (fx) => fx.setBpm(100) },
        { at: 2000, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
      ],
      total,
    );
    expect(startBad(s1, 2000, total, standalone(new FilterEcho(SR, { filter: 'none' }), x, 2000, total, echoAt100))).toBe(-1);
    // the default tempo gives a different echo, so the tempo really was used
    expect(exactBad(s1, 12000, total, fresh(ECHO, x, 2000, total, 0.7))).not.toBe(-1);

    const s2 = play(
      x,
      [
        { at: 0, run: (fx) => fx.setBpm(100) },
        { at: 2000, run: (fx) => fx.setSlot(3) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
      ],
      total,
    );
    const spiralRef = standalone(new Spiral(SR, 'up'), x, 2000, total, (fx) => {
      fx.setBpm(100);
      fx.setAmount(0.7);
    });
    expect(startBad(s2, 2000, total, spiralRef)).toBe(-1);

    const s3 = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: 15000, run: (fx) => fx.setBpm(140) },
      ],
      total,
    );
    const echo140 = standalone(ECHO(), x, 2000, total, (fx) => fx.setAmount(0.7), [{ at: 15000, run: (fx) => fx.setBpm(140) }]);
    expect(startBad(s3, 2000, total, echo140)).toBe(-1);
  });

  it('forwards the tempo to every effect that follows it', () => {
    const S = 2000;
    const total = S + 30000;
    const x = noiseInput(total);
    type Timed = Standalone & { setBpm(bpm: number): void };
    const timed = ENTRIES.filter((e) => e.name !== 'NOISE' && !e.name.startsWith('REVERB'));
    expect(timed.length).toBe(7);
    for (const e of timed) {
      const s = play(
        x,
        [
          { at: 0, run: (fx) => fx.setBpm(100) },
          {
            at: S,
            run: (fx) => {
              fx.setSlot(e.slot);
              fx.setAmount(e.sign * 0.7);
            },
          },
        ],
        total,
      );
      const at100 = standalone(e.make() as Timed, x, S, total, (fx) => {
        fx.setBpm(100);
        fx.setAmount(0.7);
      });
      expect(startBad(s, S, total, at100)).toBe(-1);
      // and that is not what the effect does at the default tempo
      expect(exactBad(s, S + FADE, total, fresh(e.make, x, S, total, 0.7))).not.toBe(-1);
    }
  });

  it('passes a new amount on when an outgoing effect is brought back', () => {
    const P = 30000;
    const total = 60000;
    const x = noiseInput(total);
    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: P, run: (fx) => fx.setAmount(0) },
        { at: P + 100, run: (fx) => fx.setAmount(0.2) },
      ],
      total,
    );
    const ref = standalone(ECHO(), x, 2000, total, (fx) => fx.setAmount(0.7), [{ at: P + 100, run: (fx) => fx.setAmount(0.2) }]);
    expect(exactBad(s, P + 199, total, ref)).toBe(-1);
    // the lower amount is audible: an echo left at 0.7 would differ
    expect(exactBad(s, P + 199, total, fresh(ECHO, x, 2000, total, 0.7))).not.toBe(-1);
  });

  it('ignores invalid slots and non-finite amounts and clamps the amount', () => {
    const fx = new SceneFx(SR);
    fx.setSlot(2);
    for (const bad of [5, -1, 1.5, NaN]) {
      fx.setSlot(bad as SceneSlot);
      expect(fx.slot).toBe(2);
    }
    fx.setAmount(0.4);
    fx.setAmount(NaN);
    expect(fx.amount).toBe(0.4);
    fx.setAmount(Infinity);
    expect(fx.amount).toBe(0.4);
    fx.setAmount(2);
    expect(fx.amount).toBe(1);
    fx.setAmount(-3);
    expect(fx.amount).toBe(-1);
  });

  it('treats non-finite input samples as 0', () => {
    const bad = [100, 700, 5000];
    const withBad = (total: number): Input => {
      const x = noiseInput(total);
      x.l[bad[0]] = NaN;
      x.r[bad[0]] = Infinity;
      x.l[bad[1]] = -Infinity;
      x.r[bad[1]] = NaN;
      x.l[bad[2]] = Infinity;
      x.r[bad[2]] = -Infinity;
      return x;
    };
    const off = makeSession(withBad(8000));
    off.feed(8000);
    expect(
      firstBad(off, 0, 8000, (c, n) => (bad.includes(n) ? 0 : c === 'l' ? off.x.l[n] : off.x.r[n])),
    ).toBe(-1);
    for (const e of ENTRIES) {
      const s = play(
        withBad(9000),
        [
          {
            at: 50,
            run: (fx) => {
              fx.setSlot(e.slot);
              fx.setAmount(e.sign * 0.7);
            },
          },
        ],
        9000,
      );
      expect(allFinite(s.ol) && allFinite(s.or)).toBe(true);
    }
  });

  it('reset clears the effect at once and keeps slot and amount', () => {
    // long enough for the echo of the first half-beat repeat (18000 samples) to come back after a reset
    const total = 40000;
    const x = noiseInput(total);
    const prepared = (): Ref =>
      standalone(
        ECHO(),
        x,
        10000,
        total,
        (fx) => {
          fx.setAmount(0.7);
          fx.reset();
        },
        [],
        false,
      );

    const s = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: 10000, run: (fx) => fx.reset() },
      ],
      total,
    );
    expect(s.fx.slot).toBe(1);
    expect(s.fx.amount).toBe(0.7);
    const ref = prepared();
    expect(exactBad(s, 10000, total, ref)).toBe(-1);
    let audible = false;
    for (let n = 10000; n < total; n++) if (ref.l[n] !== x.l[n]) audible = true;
    expect(audible).toBe(true);

    // an effect that is audible at once shows that there is no fade after a reset
    const nz = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(2) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: 10000, run: (fx) => fx.reset() },
      ],
      total,
    );
    const nzRef = standalone(
      new NoiseSweep(SR),
      x,
      10000,
      total,
      (fx) => {
        fx.setAmount(0.7);
        fx.reset();
      },
      [],
      false,
    );
    expect(exactBad(nz, 10000, total, nzRef)).toBe(-1);
    expect(nzRef.l[10000]).not.toBe(x.l[10000]);

    // a reset in the middle of a crossfade drops the outgoing effect
    const x2 = noiseInput(50000);
    const m = play(
      x2,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: 20000, run: (fx) => fx.setSlot(3) },
        { at: 20100, run: (fx) => fx.reset() },
      ],
      50000,
    );
    const spiral = standalone(
      SPIRAL_UP(),
      x2,
      20100,
      50000,
      (fx) => {
        fx.setAmount(0.7);
        fx.reset();
      },
      [],
      false,
    );
    expect(exactBad(m, 20100, 50000, spiral)).toBe(-1);

    // with the amount at 0 (even while fading out) a reset gives plain pass-through
    const o = play(
      x,
      [
        { at: 0, run: (fx) => fx.setSlot(1) },
        { at: 2000, run: (fx) => fx.setAmount(0.7) },
        { at: 10000, run: (fx) => fx.setAmount(0) },
        { at: 10100, run: (fx) => fx.reset() },
      ],
      total,
    );
    expect(passBad(o, 10100, total)).toBe(-1);
    expect(passBad(o, 0, 2000)).toBe(-1);
  });

  it('gives the same output for any block size', () => {
    const total = 60000;
    const x = noiseInput(total);
    const script: Call[] = [
      { at: 0, run: (fx) => fx.setSlot(1) },
      { at: 1000, run: (fx) => fx.setAmount(0.5) },
      { at: 10000, run: (fx) => fx.setAmount(0.9) },
      { at: 20000, run: (fx) => fx.setSlot(3) },
      { at: 30000, run: (fx) => fx.setAmount(-0.6) },
      { at: 45000, run: (fx) => fx.setAmount(0) },
    ];
    const whole = play(x, script, total);
    expect(rms(whole.ol, 30000, 45000)).toBeGreaterThan(0);
    for (const block of [1, 100, 128, 4096]) {
      const s = play(x, script, total, block);
      expect(exactBad(s, 0, total, { l: whole.ol, r: whole.or })).toBe(-1);
    }
  });

  it('only touches the first `frames` samples and ignores bad frame counts', () => {
    const fx = new SceneFx(SR);
    fx.setSlot(1);
    fx.setAmount(0.7);
    const x = noiseInput(30000);
    const warm = x.l.slice();
    const warmR = x.r.slice();
    fx.process(warm, warmR, 30000);

    const l = noise(256, 5, 0.5);
    const r = noise(256, 6, 0.5);
    const l0 = l.slice();
    const r0 = r.slice();
    fx.process(l, r, 100);
    let changed = false;
    for (let i = 0; i < 100; i++) if (l[i] !== l0[i]) changed = true;
    expect(changed).toBe(true);
    let tail = -1;
    for (let i = 100; i < 256; i++) if (l[i] !== l0[i] || r[i] !== r0[i]) tail = i;
    expect(tail).toBe(-1);

    for (const frames of [0, NaN, -5]) {
      const a = l0.slice();
      const b = r0.slice();
      fx.process(a, b, frames);
      expect(a).toEqual(l0);
      expect(b).toEqual(r0);
    }
  });

  it('switches without clicks', () => {
    const seconds = 20000 * 8 + 4000;
    const input = sine(97, seconds / SR, SR, 0.5);
    const x: Input = { l: input, r: input.slice() };
    const total = x.l.length;
    const script: Call[] = [];
    let at = 0;
    for (const sign of [1, -1]) {
      for (const slot of [1, 3, 4, 0] as SceneSlot[]) {
        script.push({
          at,
          run: (fx) => {
            fx.setSlot(slot);
            fx.setAmount(sign * 0.7);
          },
        });
        at += 20000;
      }
    }
    script.push({ at, run: (fx) => fx.setAmount(0) });
    const s = play(x, script, total);
    let inStep = 0;
    let outStep = 0;
    for (let n = 1; n < total; n++) {
      inStep = Math.max(inStep, Math.abs(x.l[n] - x.l[n - 1]));
      outStep = Math.max(outStep, Math.abs(s.ol[n] - s.ol[n - 1]), Math.abs(s.or[n] - s.or[n - 1]));
    }
    expect(outStep).toBeLessThanOrEqual(inStep + 0.03);
    expect(allFinite(s.ol) && allFinite(s.or)).toBe(true);
  });
});
