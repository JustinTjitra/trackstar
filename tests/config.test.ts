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

  it('does not share nested objects with the defaults', () => {
    const c = loadConfig(new MemStorage());
    c.poseMap.index = null;
    expect(DEFAULT_CONFIG.poseMap.index).toBe('loop1');
  });
});
