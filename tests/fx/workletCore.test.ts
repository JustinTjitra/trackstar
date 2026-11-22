import { describe, expect, it } from 'vitest';
import { FxEngine } from '../../src/fx/engine';
import type { FxStateMessage } from '../../src/fx/protocol';
import { FxProcessorCore } from '../../src/fx/worklet/core';
import type { FxOutMessage } from '../../src/fx/worklet/core';
import { clickTrack, noise } from '../fixtures/synthAudio';

const SR = 48000;
const BLOCK = 128;

/** The settings of the "equals a standalone engine" test, as initial messages. */
const FX_INITIAL = [
  { type: 'isolator', low: 0.2, mid: 0.5, high: 0.9 },
  { type: 'sceneSlot', slot: 1 },
  { type: 'sceneAmount', value: 0.8 },
  { type: 'autoBpm', on: false },
];

interface Rig {
  core: FxProcessorCore;
  /** Shallow copies of every posted message. */
  msgs: FxOutMessage[];
  /** The posted objects themselves. */
  refs: FxOutMessage[];
  /** Index of the block being processed when each message was posted. */
  blockAt: number[];
  /** Number of blocks processed so far. */
  blocks: number;
}

function makeRig(initial?: unknown, post?: (msg: FxOutMessage) => void): Rig {
  const rig = { msgs: [], refs: [], blockAt: [], blocks: 0 } as unknown as Rig;
  rig.core = new FxProcessorCore(
    SR,
    (m) => {
      rig.refs.push(m);
      rig.msgs.push({ ...m });
      rig.blockAt.push(rig.blocks);
      if (post) post(m);
    },
    initial,
  );
  return rig;
}

/** Runs stereo arrays through the core block by block and returns the output. */
function run(rig: Rig, l: Float32Array, r: Float32Array, size = BLOCK): { l: Float32Array; r: Float32Array } {
  const outL = new Float32Array(l.length);
  const outR = new Float32Array(l.length);
  for (let i = 0; i < l.length; i += size) {
    const n = Math.min(size, l.length - i);
    rig.core.process([l.subarray(i, i + n), r.subarray(i, i + n)], [outL.subarray(i, i + n), outR.subarray(i, i + n)]);
    rig.blocks++;
  }
  return { l: outL, r: outR };
}

function states(rig: Rig): FxStateMessage[] {
  return rig.msgs.filter((m): m is FxStateMessage => m.type === 'state');
}

function last<T>(a: T[]): T {
  return a[a.length - 1];
}

/** Output of a standalone engine configured like FX_INITIAL, fed the same blocks. */
function reference(l: Float32Array, r: Float32Array, size = BLOCK): { l: Float32Array; r: Float32Array } {
  const eng = new FxEngine(SR);
  eng.setIsolator(0.2, 0.5, 0.9);
  eng.setSceneSlot(1);
  eng.setSceneAmount(0.8);
  eng.reset();
  const outL = Float32Array.from(l);
  const outR = Float32Array.from(r);
  for (let i = 0; i < l.length; i += size) {
    const n = Math.min(size, l.length - i);
    eng.process(outL.subarray(i, i + n), outR.subarray(i, i + n), n);
  }
  return { l: outL, r: outR };
}

/** Index of the first sample where two arrays differ, or -1 when they are identical. */
function firstDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

/** Exact comparison that fails with a small message (not a diff of the whole buffer). */
function expectSame(a: Float32Array, b: Float32Array): void {
  expect(firstDiff(a, b), 'first differing sample').toBe(-1);
}

function expectDiffers(a: Float32Array, b: Float32Array): void {
  expect(firstDiff(a, b) >= 0, 'arrays differ').toBe(true);
}

const TRACK = clickTrack(128, 12, SR);
const TEN_S = 10 * SR;

/** Runs of the click track, shared by several tests. Each is computed once. */
const memo = new Map<string, Rig>();
function trackRun(key: string, initial?: unknown): Rig {
  let rig = memo.get(key);
  if (!rig) {
    rig = makeRig(initial);
    run(rig, TRACK.subarray(0, TEN_S), TRACK.subarray(0, TEN_S));
    memo.set(key, rig);
  }
  return rig;
}

describe('FxProcessorCore constructor', () => {
  it.each([0, -1, NaN, Infinity])('throws RangeError for sampleRate %s', (sr) => {
    expect(() => new FxProcessorCore(sr, () => {})).toThrow(RangeError);
  });

  it('ignores an initial value that is not an array', () => {
    const rig = makeRig({ type: 'bypass', on: true });
    const l = noise(1000, 1, 0.5);
    const out = run(rig, l, l);
    expectDiffers(out.l, l); // not bypassed from the start: nothing was applied
    expect(() => makeRig('x')).not.toThrow();
  });
});

describe('pass-through and channel handling', () => {
  it('bypassed input comes out identical, and garbage in the output is overwritten', () => {
    const l = noise(SR / 2, 1, 0.5);
    const r = noise(SR / 2, 2, 0.5);
    const rig = makeRig([{ type: 'bypass', on: true }]);
    const outL = new Float32Array(l.length).fill(9);
    const outR = new Float32Array(l.length).fill(-9);
    for (let i = 0; i < l.length; i += BLOCK) {
      const n = Math.min(BLOCK, l.length - i);
      rig.core.process([l.subarray(i, i + n), r.subarray(i, i + n)], [outL.subarray(i, i + n), outR.subarray(i, i + n)]);
    }
    expectSame(outL, l);
    expectSame(outR, r);
  });

  it('duplicates a mono input to both outputs', () => {
    const m = noise(BLOCK * 10, 3, 0.5);
    const rig = makeRig([{ type: 'bypass', on: true }]);
    const outL = new Float32Array(m.length).fill(7);
    const outR = new Float32Array(m.length).fill(7);
    for (let i = 0; i < m.length; i += BLOCK) {
      rig.core.process([m.subarray(i, i + BLOCK)], [outL.subarray(i, i + BLOCK), outR.subarray(i, i + BLOCK)]);
    }
    expectSame(outL, m);
    expectSame(outR, m);
  });

  it('writes zeros when nothing is connected, and still runs the effects', () => {
    const bypassed = makeRig([{ type: 'bypass', on: true }]);
    const a = new Float32Array(BLOCK * 20).fill(5);
    const b = new Float32Array(BLOCK * 20).fill(5);
    for (let i = 0; i < a.length; i += BLOCK) {
      bypassed.core.process([], [a.subarray(i, i + BLOCK), b.subarray(i, i + BLOCK)]);
    }
    expect(a.every((v) => v === 0)).toBe(true);
    expect(b.every((v) => v === 0)).toBe(true);

    const noisy = makeRig([
      { type: 'sceneSlot', slot: 2 },
      { type: 'sceneAmount', value: 0.7 },
    ]);
    const c = new Float32Array(SR / 4).fill(5);
    const d = new Float32Array(SR / 4).fill(5);
    for (let i = 0; i < c.length; i += BLOCK) {
      noisy.core.process([], [c.subarray(i, i + BLOCK), d.subarray(i, i + BLOCK)]);
    }
    expect(c.some((v) => v !== 0)).toBe(true);
    expect(d.some((v) => v !== 0)).toBe(true);
  });

  it('applying initial settings resets the engine so they are in force from the first sample', () => {
    const l = noise(BLOCK * 4, 5, 0.5);
    const r = noise(BLOCK * 4, 6, 0.5);
    const rig = makeRig([{ type: 'bypass', on: true }]);
    const out = run(rig, l, r);
    expectSame(out.l, l);
    // with no reset the bypass would crossfade in over 10 ms and the first samples would be processed
    expect(out.l[0]).toBe(l[0]);
  });
});

describe('effects and state reports', () => {
  const l = noise(SR, 11, 0.5);
  const r = noise(SR, 22, 0.5);

  it('equals a standalone engine given the same settings and blocks', () => {
    const rig = makeRig(FX_INITIAL);
    const out = run(rig, l, r);
    const ref = reference(l, r);
    expectSame(out.l, ref.l);
    expectSame(out.r, ref.r);
    expectDiffers(out.l, l); // the effect really did something
  });

  it('posts ten state reports in the first second, the first after block 38', () => {
    const rig = makeRig(FX_INITIAL);
    run(rig, l, r);
    const s = states(rig);
    expect(rig.msgs.length).toBe(10);
    expect(rig.msgs.every((m) => m.type === 'state')).toBe(true);
    // block index is incremented after process returns, so a message from block 38 (0-based) sees 38
    expect(rig.blockAt[0]).toBe(37);
    for (const m of s) {
      expect(m).toMatchObject({
        bypass: false,
        slot: 1,
        amount: 0.8,
        rollActive: false,
        releaseActive: false,
        bpm: 120,
        detectedBpm: null,
        bpmConfidence: 0,
      });
      expect(typeof m.limiterGain).toBe('number');
    }
  });

  it('passes the same state object to post every time', () => {
    const rig = makeRig(FX_INITIAL);
    run(rig, l, r);
    expect(rig.refs.length).toBe(10);
    for (const ref of rig.refs) expect(ref).toBe(rig.refs[0]);
  });

  it('reflects messages in the next state report', () => {
    const rig = makeRig([{ type: 'autoBpm', on: false }]);
    rig.core.handleMessage({ type: 'sceneSlot', slot: 3 });
    rig.core.handleMessage({ type: 'sceneAmount', value: -0.5 });
    rig.core.handleMessage({ type: 'bpm', bpm: 100 });
    run(rig, l.subarray(0, 6000), r.subarray(0, 6000));
    expect(rig.msgs.length).toBe(1);
    expect(rig.msgs[0]).toMatchObject({ type: 'state', slot: 3, amount: -0.5, bpm: 100 });
  });

  it('ignores bad messages without changing anything or posting an error', () => {
    const rig = makeRig([{ type: 'autoBpm', on: false }]);
    for (const bad of [null, 42, { type: 'nope' }, { type: 'sceneSlot', slot: 9 }, 'x', [], undefined]) {
      expect(() => rig.core.handleMessage(bad)).not.toThrow();
    }
    run(rig, l.subarray(0, 6000), r.subarray(0, 6000));
    expect(rig.msgs.length).toBe(1);
    expect(rig.msgs[0]).toMatchObject({ type: 'state', slot: 0, amount: 0, bpm: 120, bypass: false });
  });
});

describe('tempo following', () => {
  it('auto tempo on: detects 128 BPM and applies it to the engine', () => {
    const rig = trackRun('auto');
    const s = states(rig);
    const end = last(s);
    expect(Math.abs((end.detectedBpm as number) - 128)).toBeLessThan(0.5);
    expect(end.bpmConfidence).toBeGreaterThan(0.5);
    expect(Math.abs(end.bpm - 128)).toBeLessThan(0.5);
    for (const m of s.slice(0, 39)) {
      expect(m.detectedBpm).toBeNull();
      expect(m.bpm).toBe(120);
    }
    // the detector answers at onset value 376 (4.01 s), the 4th estimate: the 41st report is the first with a tempo
    expect(s.findIndex((m) => m.detectedBpm !== null)).toBe(40);
  });

  it('estimates the tempo about once a second, not on every onset value', () => {
    const rig = trackRun('auto');
    const distinct = new Set(states(rig).map((m) => m.detectedBpm).filter((v) => v !== null));
    // estimates at 4.01 s, 5.01 s, ... 10 s: at most 7 of them, so at most 7 distinct readings
    expect(distinct.size).toBeLessThanOrEqual(7);
  });

  it('ignores a low-confidence estimate: noise has no tempo to follow', () => {
    const rig = makeRig();
    const n = noise(8 * SR, 31, 0.5);
    run(rig, n, noise(8 * SR, 32, 0.5));
    const s = states(rig).filter((m) => m.detectedBpm !== null);
    expect(s.length).toBeGreaterThan(0);
    // the precondition that makes this test bite: noise gives a reading that is weak and far from 120
    expect(s.some((m) => m.bpmConfidence <= 0.5 && Math.abs((m.detectedBpm as number) - 120) > 0.25)).toBe(true);
    for (const m of s) {
      if (m.bpmConfidence <= 0.5) expect(m.bpm).toBe(120);
    }
  });

  it('does not follow a beat it is only half sure of', () => {
    // clicks buried in noise: the detector finds 128 BPM but with confidence between 0.25 and 0.5
    const c = clickTrack(128, 10, SR);
    const n = noise(c.length, 7, 0.2);
    const x = new Float32Array(c.length);
    for (let i = 0; i < x.length; i++) x[i] = c[i] + n[i];
    const rig = makeRig();
    run(rig, x, x);
    const s = states(rig).filter((m) => m.detectedBpm !== null);
    expect(s.some((m) => m.bpmConfidence > 0.25 && Math.abs((m.detectedBpm as number) - 128) < 1.5)).toBe(true);
    for (const m of s) {
      expect(m.bpmConfidence).toBeLessThan(0.5);
      expect(m.bpm).toBe(120);
    }
  });

  it('hears a beat that is on one channel only', () => {
    const x = TRACK.subarray(0, 8 * SR);
    const rig = makeRig([{ type: 'autoBpm', on: false }]);
    run(rig, new Float32Array(x.length), x);
    expect(Math.abs((last(states(rig)).detectedBpm as number) - 128)).toBeLessThan(0.5);
  });

  it('drops the detection when the music stops', () => {
    const rig = makeRig([{ type: 'bypass', on: true }]);
    const x = TRACK.subarray(0, 6 * SR);
    run(rig, x, x);
    expect(last(states(rig)).detectedBpm).not.toBeNull();
    const quiet = new Float32Array(9 * SR);
    run(rig, quiet, quiet);
    const end = last(states(rig));
    expect(end.detectedBpm).toBeNull();
    expect(end.bpmConfidence).toBe(0);
  });

  it('analyses the input, not the processed output', () => {
    // the isolator with every band at 0 silences the output, but the tempo is still read from the input
    const rig = makeRig([
      { type: 'isolator', low: 0, mid: 0, high: 0 },
      { type: 'autoBpm', on: false },
    ]);
    const x = TRACK.subarray(0, 8 * SR);
    const out = run(rig, x, x);
    let peak = 0;
    for (let i = 3 * SR; i < out.l.length; i++) peak = Math.max(peak, Math.abs(out.l[i]));
    expect(peak).toBeLessThan(1e-3);
    expect(Math.abs((last(states(rig)).detectedBpm as number) - 128)).toBeLessThan(0.5);
  });

  it('auto tempo off: detects but does not apply; switching on applies it', () => {
    const rig = makeRig([{ type: 'autoBpm', on: false }]);
    run(rig, TRACK.subarray(0, TEN_S), TRACK.subarray(0, TEN_S));
    const end = last(states(rig));
    expect(Math.abs((end.detectedBpm as number) - 128)).toBeLessThan(0.5);
    expect(end.bpm).toBe(120);

    rig.core.handleMessage({ type: 'autoBpm', on: true });
    const more = TRACK.subarray(TEN_S, TEN_S + 2 * SR);
    run(rig, more, more);
    expect(Math.abs(last(states(rig)).bpm - 128)).toBeLessThan(0.5);
  });

  it('dead band: the tempo is not rewritten on every estimate', () => {
    const rig = trackRun('auto');
    const s = states(rig);
    const first = s.findIndex((m) => m.detectedBpm !== null);
    expect(first).toBeGreaterThan(0);
    const values = new Set(s.slice(first).map((m) => m.bpm));
    // measured: the detector reads 128.21 down to 127.90 over six estimates; the engine takes 128.21, then 127.92 (two values)
    expect(values.size).toBe(2);
    const [a, b] = [...values];
    // it moved once, by more than the dead band of 0.25 BPM and by less than 1
    expect(Math.abs(a - b)).toBeGreaterThan(0.25);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it('analyses the input, so bypass does not stop tempo detection', () => {
    const rig = trackRun('bypass', [{ type: 'bypass', on: true }]);
    const end = last(states(rig));
    expect(end.bypass).toBe(true);
    expect(Math.abs((end.detectedBpm as number) - 128)).toBeLessThan(0.5);
  });

  it('reset message forgets the detection, and the tempo is found again', () => {
    const rig = makeRig();
    run(rig, TRACK.subarray(0, 6 * SR), TRACK.subarray(0, 6 * SR));
    expect(last(states(rig)).detectedBpm).not.toBeNull();

    rig.core.handleMessage({ type: 'reset' });
    const before = states(rig).length;
    const a = TRACK.subarray(6 * SR, 9 * SR);
    run(rig, a, a);
    const mid = states(rig).slice(before);
    expect(mid.length).toBeGreaterThan(0);
    for (const m of mid) {
      expect(m.detectedBpm).toBeNull();
      expect(m.bpmConfidence).toBe(0);
    }
    const b = TRACK.subarray(9 * SR, 12 * SR);
    run(rig, b, b);
    const end = last(states(rig));
    expect(Math.abs((end.detectedBpm as number) - 128)).toBeLessThan(0.5);
  });

  it('reset message clears the detection at once, in the next state report', () => {
    const rig = makeRig();
    run(rig, TRACK.subarray(0, 6 * SR), TRACK.subarray(0, 6 * SR));
    rig.core.handleMessage({ type: 'reset' });
    const n = states(rig).length;
    const a = TRACK.subarray(6 * SR, 6 * SR + 6000);
    run(rig, a, a);
    const m = states(rig)[n];
    expect(m.detectedBpm).toBeNull();
    expect(m.bpmConfidence).toBe(0);
  });
});

describe('failing safe', () => {
  const l = noise(SR, 11, 0.5);
  const r = noise(SR, 22, 0.5);

  it('passes audio through untouched after post throws, and posts the error once', () => {
    const rig = makeRig(FX_INITIAL, () => {
      throw new Error('port closed');
    });
    let out!: { l: Float32Array; r: Float32Array };
    expect(() => {
      out = run(rig, l, r);
    }).not.toThrow();
    expect(rig.msgs.length).toBe(2);
    expect(rig.msgs[0].type).toBe('state');
    expect(rig.msgs[1]).toEqual({ type: 'error', message: 'port closed' });
    // the effect was audible before the failure
    expectDiffers(out.l.subarray(0, 37 * BLOCK), l.subarray(0, 37 * BLOCK));
    // from the failing block on, the output is the input
    const from = rig.blockAt[0] * BLOCK;
    expectSame(out.l.subarray(from), l.subarray(from));
    expectSame(out.r.subarray(from), r.subarray(from));

    rig.core.handleMessage({ type: 'bypass', on: false });
    const out2 = run(rig, l, r);
    expectSame(out2.l, l);
    expectSame(out2.r, r);
    expect(rig.msgs.length).toBe(2);
  });

  it('reports the thrown message when post works again', () => {
    let calls = 0;
    const rig = makeRig(FX_INITIAL, () => {
      if (calls++ === 0) throw new Error('boom');
    });
    expect(() => run(rig, l, r)).not.toThrow();
    expect(rig.msgs.length).toBe(2);
    expect(rig.msgs[1]).toEqual({ type: 'error', message: 'boom' });
  });

  it('a non-Error throw is reported as text', () => {
    let calls = 0;
    const rig = makeRig(FX_INITIAL, () => {
      if (calls++ === 0) throw 'plain';
    });
    run(rig, l, r);
    expect(rig.msgs[1]).toEqual({ type: 'error', message: 'plain' });
  });
});

describe('other block sizes and channel counts', () => {
  const l = noise(SR, 11, 0.5);
  const r = noise(SR, 22, 0.5);

  it.each([64, 256, 1000])('matches a standalone engine with blocks of %i', (size) => {
    const rig = makeRig(FX_INITIAL);
    const out = run(rig, l, r, size);
    const ref = reference(l, r, size);
    expectSame(out.l, ref.l);
    expectSame(out.r, ref.r);
    expect(states(rig).length).toBe(10);
  });

  it('with one output channel copies the first input channel and does nothing else', () => {
    const rig = makeRig(FX_INITIAL);
    const out = new Float32Array(SR);
    for (let i = 0; i < SR; i += BLOCK) {
      const n = Math.min(BLOCK, SR - i);
      expect(() => rig.core.process([l.subarray(i, i + n), r.subarray(i, i + n)], [out.subarray(i, i + n)])).not.toThrow();
    }
    expectSame(out, l);
    expect(rig.msgs.length).toBe(0);
  });

  it('with no output channels does nothing', () => {
    const rig = makeRig(FX_INITIAL);
    expect(() => rig.core.process([l.subarray(0, BLOCK), r.subarray(0, BLOCK)], [])).not.toThrow();
    expect(rig.msgs.length).toBe(0);
  });
});
