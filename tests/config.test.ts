import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type StorageLike } from '../src/config/config';

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

describe('config', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadConfig(new MemStorage())).toEqual(DEFAULT_CONFIG);
  });

  it('returns defaults when storage throws or holds junk', () => {
    expect(loadConfig(throwing)).toEqual(DEFAULT_CONFIG);
    const s = new MemStorage();
    s.setItem('trackstar.config.v1', '{not json');
    expect(loadConfig(s)).toEqual(DEFAULT_CONFIG);
  });

  it('merges a partial stored config over the defaults', () => {
    const s = new MemStorage();
    s.setItem('trackstar.config.v1', JSON.stringify({ holdMs: 120, poseMap: { pinky: null } }));
    const c = loadConfig(s);
    expect(c.holdMs).toBe(120);
    expect(c.poseMap.pinky).toBeNull();
    expect(c.poseMap.index).toBe('loop1');
    expect(c.speedGate).toBe(DEFAULT_CONFIG.speedGate);
  });

  it('round-trips through save and load', () => {
    const s = new MemStorage();
    const c = { ...DEFAULT_CONFIG, outPort: 'IAC Driver Touchless', calibrated: true, clutchOn: 0.3, clutchOff: 0.38 };
    saveConfig(c, s);
    expect(loadConfig(s)).toEqual(c);
  });

  it('does not throw when saving to blocked storage', () => {
    expect(() => saveConfig(DEFAULT_CONFIG, throwing)).not.toThrow();
  });

  it('inverts stem feedback by default and keeps a stored override', () => {
    expect(loadConfig(new MemStorage()).invert).toEqual({ drums: true, vocals: true, inst: true });
    const s = new MemStorage();
    s.setItem('trackstar.config.v1', JSON.stringify({ invert: { vocals: false } }));
    expect(loadConfig(s).invert).toEqual({ drums: true, vocals: false, inst: true });
  });

  it('does not share nested objects with the defaults', () => {
    const c = loadConfig(new MemStorage());
    c.poseMap.index = null;
    expect(DEFAULT_CONFIG.poseMap.index).toBe('loop1');
  });

  it('has default effects settings', () => {
    expect(loadConfig(new MemStorage()).fx).toEqual({
      inputLabel: null,
      outputLabel: null,
      source: 'demo',
      releaseType: 'brake',
      releaseBeats: 2,
      sceneSlot: 1,
      autoBpm: true,
    });
  });

  it('merges a partial stored fx config over the effects defaults', () => {
    const s = new MemStorage();
    s.setItem('trackstar.config.v1', JSON.stringify({ fx: { source: 'input', inputLabel: 'BlackHole 2ch (Virtual)' } }));
    const c = loadConfig(s);
    expect(c.fx).toEqual({
      inputLabel: 'BlackHole 2ch (Virtual)',
      outputLabel: null,
      source: 'input',
      releaseType: 'brake',
      releaseBeats: 2,
      sceneSlot: 1,
      autoBpm: true,
    });
    expect(c.holdMs).toBe(DEFAULT_CONFIG.holdMs);
  });

  it('round-trips the effects settings through save and load', () => {
    const s = new MemStorage();
    const c = {
      ...DEFAULT_CONFIG,
      fx: {
        inputLabel: 'BlackHole 2ch (Virtual)',
        outputLabel: 'DDJ-FLX2',
        source: 'input' as const,
        releaseType: 'backspin' as const,
        releaseBeats: 4,
        sceneSlot: 3 as const,
        autoBpm: false,
      },
    };
    saveConfig(c, s);
    expect(loadConfig(s)).toEqual(c);
  });

  it('loads a config stored before effects settings existed with default fx', () => {
    const s = new MemStorage();
    s.setItem('trackstar.config.v1', JSON.stringify({ holdMs: 120 }));
    const c = loadConfig(s);
    expect(c.fx).toEqual(DEFAULT_CONFIG.fx);
    expect(c.holdMs).toBe(120);
  });

  it('falls back to the default for each bad stored effects value', () => {
    const s = new MemStorage();
    s.setItem(
      'trackstar.config.v1',
      JSON.stringify({
        fx: {
          inputLabel: 42,
          outputLabel: ['x'],
          source: 'tape',
          releaseType: 'spin',
          releaseBeats: 'two',
          sceneSlot: 9,
          autoBpm: 'yes',
        },
      }),
    );
    expect(loadConfig(s).fx).toEqual(DEFAULT_CONFIG.fx);
  });

  it('keeps the good effects values when another field is bad', () => {
    const s = new MemStorage();
    s.setItem('trackstar.config.v1', JSON.stringify({ fx: { source: 'input', sceneSlot: 9, releaseType: 'echo' } }));
    const c = loadConfig(s);
    expect(c.fx.source).toBe('input');
    expect(c.fx.releaseType).toBe('echo');
    expect(c.fx.sceneSlot).toBe(1);
  });

  it('clamps releaseBeats to 0.25..8 and falls back for non-numbers', () => {
    const load = (releaseBeats: unknown) => {
      const s = new MemStorage();
      s.setItem('trackstar.config.v1', JSON.stringify({ fx: { releaseBeats } }));
      return loadConfig(s).fx.releaseBeats;
    };
    expect(load(100)).toBe(8);
    expect(load(0)).toBe(0.25);
    expect(load(-3)).toBe(0.25);
    expect(load(0.5)).toBe(0.5);
    expect(load(null)).toBe(2);
  });

  it('accepts scene slots 0 to 4 only', () => {
    const load = (sceneSlot: unknown) => {
      const s = new MemStorage();
      s.setItem('trackstar.config.v1', JSON.stringify({ fx: { sceneSlot } }));
      return loadConfig(s).fx.sceneSlot;
    };
    expect(load(0)).toBe(0);
    expect(load(4)).toBe(4);
    expect(load(1.5)).toBe(1);
    expect(load(-1)).toBe(1);
    expect(load('2')).toBe(1);
  });

  it('loads the default effects settings when stored fx is not an object', () => {
    for (const fx of ['demo', 7, null, [1, 2]]) {
      const s = new MemStorage();
      s.setItem('trackstar.config.v1', JSON.stringify({ fx }));
      expect(loadConfig(s).fx).toEqual(DEFAULT_CONFIG.fx);
    }
  });

  it('does not share the frozen default effects object', () => {
    const c = loadConfig(new MemStorage());
    expect(() => {
      c.fx.sceneSlot = 4;
    }).not.toThrow();
    expect(DEFAULT_CONFIG.fx.sceneSlot).toBe(1);
    expect(loadConfig(new MemStorage()).fx.sceneSlot).toBe(1);
  });
});
