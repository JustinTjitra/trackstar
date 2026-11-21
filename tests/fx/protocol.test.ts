import { describe, expect, it } from 'vitest';
import { FxEngine } from '../../src/fx/engine';
import { applyMessage, isFxMessage } from '../../src/fx/protocol';
import type { FxControls, FxMessage } from '../../src/fx/protocol';

/** An engine that records every call as [methodName, ...args], exactly as received. */
function fakeEngine(): { engine: FxControls; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]): void => {
    calls.push([name, ...args]);
  };
  const engine: FxControls = {
    setBpm: record('setBpm'),
    setBypass: record('setBypass'),
    setSceneSlot: record('setSceneSlot'),
    setSceneAmount: record('setSceneAmount'),
    setIsolator: record('setIsolator'),
    rollStart: record('rollStart'),
    rollStop: record('rollStop'),
    release: record('release'),
    reset: record('reset'),
  };
  return { engine, calls };
}

describe('protocol: valid messages', () => {
  it('maps each control message to exactly one engine call', () => {
    const cases: Array<[FxMessage, unknown[]]> = [
      [{ type: 'bpm', bpm: 128 }, ['setBpm', 128]],
      [{ type: 'bypass', on: true }, ['setBypass', true]],
      [{ type: 'bypass', on: false }, ['setBypass', false]],
      [{ type: 'sceneSlot', slot: 3 }, ['setSceneSlot', 3]],
      [{ type: 'sceneAmount', value: -0.4 }, ['setSceneAmount', -0.4]],
      [{ type: 'isolator', low: 0.1, mid: 0.5, high: 0.9 }, ['setIsolator', 0.1, 0.5, 0.9]],
      [{ type: 'rollStart', division: 0.25 }, ['rollStart', 0.25]],
      [{ type: 'rollStop' }, ['rollStop']],
      [{ type: 'release', release: 'echo', beats: 4 }, ['release', 'echo', 4]],
      [{ type: 'release', release: 'brake' }, ['release', 'brake', undefined]],
      [{ type: 'reset' }, ['reset']],
    ];
    for (const [msg, expected] of cases) {
      const label = JSON.stringify(msg);
      const { engine, calls } = fakeEngine();
      expect(isFxMessage(msg), label).toBe(true);
      expect(applyMessage(engine, msg), label).toBe(true);
      expect(calls, label).toStrictEqual([expected]);
    }
  });

  it('treats autoBpm as valid but leaves it to the audio processor', () => {
    for (const on of [true, false]) {
      const msg: FxMessage = { type: 'autoBpm', on };
      const label = JSON.stringify(msg);
      const { engine, calls } = fakeEngine();
      expect(isFxMessage(msg), label).toBe(true);
      expect(applyMessage(engine, msg), label).toBe(false);
      expect(calls, label).toStrictEqual([]);
    }
  });

  it('accepts every valid value', () => {
    const valid: unknown[] = [
      { type: 'sceneSlot', slot: 0 },
      { type: 'sceneSlot', slot: 1 },
      { type: 'sceneSlot', slot: 2 },
      { type: 'sceneSlot', slot: 3 },
      { type: 'sceneSlot', slot: 4 },
      { type: 'rollStart', division: 1 },
      { type: 'rollStart', division: 0.5 },
      { type: 'rollStart', division: 0.25 },
      { type: 'rollStart', division: 0.125 },
      { type: 'release', release: 'brake' },
      { type: 'release', release: 'echo' },
      { type: 'release', release: 'backspin' },
      { type: 'release', release: 'echo', beats: 0.25 },
      { type: 'release', release: 'echo', beats: 8 },
      { type: 'bpm', bpm: 0 },
      { type: 'bpm', bpm: 1000 },
      { type: 'bpm', bpm: -5 },
      { type: 'sceneAmount', value: 2 },
      { type: 'sceneAmount', value: -3 },
    ];
    for (const v of valid) {
      expect(isFxMessage(v), JSON.stringify(v)).toBe(true);
    }
  });

  it('ignores extra properties', () => {
    const msg: unknown = { type: 'bpm', bpm: 120, extra: 'x' };
    expect(isFxMessage(msg)).toBe(true);
    const { engine, calls } = fakeEngine();
    if (!isFxMessage(msg)) throw new Error('expected a valid message');
    expect(applyMessage(engine, msg)).toBe(true);
    expect(calls).toStrictEqual([['setBpm', 120]]);
  });

  it('survives a structured copy', () => {
    const copy: unknown = JSON.parse(JSON.stringify({ type: 'isolator', low: 0, mid: 0.5, high: 1 }));
    if (!isFxMessage(copy)) throw new Error('structured copy is not a valid message');
    const { engine, calls } = fakeEngine();
    expect(applyMessage(engine, copy)).toBe(true);
    expect(calls).toStrictEqual([['setIsolator', 0, 0.5, 1]]);
  });
});

describe('protocol: invalid messages', () => {
  it('rejects malformed input without throwing', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      42,
      'bpm',
      true,
      [],
      [{ type: 'reset' }],
      Object.assign([], { type: 'reset' }),
      {},
      { type: 'nope' },
      { type: 5 },
      { type: 'bpm' },
      { type: 'bpm', bpm: NaN },
      { type: 'bpm', bpm: Infinity },
      { type: 'bpm', bpm: '120' },
      { type: 'autoBpm' },
      { type: 'autoBpm', on: 1 },
      { type: 'bypass', on: 'true' },
      { type: 'bypass' },
      { type: 'sceneSlot', slot: 5 },
      { type: 'sceneSlot', slot: -1 },
      { type: 'sceneSlot', slot: 1.5 },
      { type: 'sceneSlot', slot: '1' },
      { type: 'sceneSlot' },
      { type: 'sceneAmount', value: NaN },
      { type: 'sceneAmount' },
      { type: 'isolator', low: 0.5, high: 0.5 },
      { type: 'isolator', low: 0.5, mid: NaN, high: 0.5 },
      { type: 'isolator', low: '0', mid: 0.5, high: 0.5 },
      { type: 'isolator', low: 0.5, mid: 0.5, high: Infinity },
      { type: 'rollStart', division: 0.3 },
      { type: 'rollStart', division: 2 },
      { type: 'rollStart', division: '0.5' },
      { type: 'rollStart' },
      { type: 'release', release: 'spin' },
      { type: 'release' },
      { type: 'release', release: 'brake', beats: NaN },
      { type: 'release', release: 'brake', beats: 0 },
      { type: 'release', release: 'brake', beats: -1 },
      { type: 'release', release: 'brake', beats: '2' },
      { type: 'release', release: 'brake', beats: null },
    ];
    invalid.forEach((v, i) => {
      const label = `#${i} ${JSON.stringify(v)}`;
      expect(isFxMessage(v), label).toBe(false);
    });
  });
});

describe('protocol: hostile input', () => {
  it('returns false instead of throwing when reading a field throws', () => {
    const getter = {
      get type(): string {
        throw new Error('no');
      },
    };
    const proxy = new Proxy(
      {},
      {
        get(): never {
          throw new Error('no');
        },
      },
    );
    expect(() => isFxMessage(getter)).not.toThrow();
    expect(isFxMessage(getter)).toBe(false);
    expect(() => isFxMessage(proxy)).not.toThrow();
    expect(isFxMessage(proxy)).toBe(false);
  });
});

describe('protocol: engine', () => {
  it('drives the real engine through the controls type', () => {
    const engine = new FxEngine(48000);
    const controls: FxControls = engine;
    expect(applyMessage(controls, { type: 'sceneSlot', slot: 2 })).toBe(true);
    expect(applyMessage(controls, { type: 'bpm', bpm: 100 })).toBe(true);
    expect(engine.state().slot).toBe(2);
    expect(engine.state().bpm).toBe(100);
  });
});
