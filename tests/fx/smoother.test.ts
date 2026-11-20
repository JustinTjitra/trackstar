import { describe, it, expect } from 'vitest';
import { Smoother } from '../../src/fx/dsp/smoother';

/** Runs n samples and returns the last value. */
function run(s: Smoother, n: number): number {
  let v = s.value;
  for (let i = 0; i < n; i++) v = s.next();
  return v;
}

describe('Smoother', () => {
  it('starts settled at the initial value and stays there', () => {
    const s = new Smoother(48000, 20, 0.25);
    expect(s.value).toBe(0.25);
    expect(s.target).toBe(0.25);
    expect(s.isSettled()).toBe(true);
    for (let i = 0; i < 100; i++) {
      expect(s.next()).toBe(0.25);
    }
  });

  it.each([44100, 48000])('reaches about 63.2 percent after one time constant at %i Hz', (sampleRate) => {
    const s = new Smoother(sampleRate, 20, 0);
    s.setTarget(1);
    const n = Math.round(0.020 * sampleRate);
    const v = run(s, n);
    const expected = 1 - Math.exp(-1);
    expect(Math.abs(v - expected) / expected).toBeLessThan(0.05);
  });

  it('glides monotonically upward and never overshoots the target', () => {
    const s = new Smoother(48000, 20, 0);
    s.setTarget(1);
    let prev = s.value;
    for (let i = 0; i < 5000; i++) {
      const v = s.next();
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('converges within 1e-4 after 10 time constants and snaps exactly to the target', () => {
    const s = new Smoother(48000, 20, 0);
    s.setTarget(1);
    run(s, 9600); // 10 time constants of 960 samples
    expect(Math.abs(s.value - 1)).toBeLessThan(1e-4);
    expect(s.isSettled()).toBe(true);
    run(s, 96000); // 2 seconds more
    expect(s.value).toBe(1);
    expect(s.target).toBe(1);
  });

  it('jump sets value, target and the next output to the same number mid-glide', () => {
    const s = new Smoother(48000, 20, 0);
    s.setTarget(1);
    run(s, 100);
    expect(s.value).not.toBe(0.8);
    s.jump(0.8);
    expect(s.value).toBe(0.8);
    expect(s.target).toBe(0.8);
    expect(s.next()).toBe(0.8);
  });

  it('glides downward and reaches about 36.8% after one time constant', () => {
    const s = new Smoother(48000, 20, 1);
    s.setTarget(0);
    const v = run(s, 960);
    const expected = Math.exp(-1);
    expect(v).toBeLessThan(1);
    expect(Math.abs(v - expected) / expected).toBeLessThan(0.05);
  });

  it('continues from the current value when retargeted mid-glide', () => {
    const s = new Smoother(48000, 20, 0);
    s.setTarget(1);
    const before = run(s, 500);
    s.setTarget(0);
    const after = s.next();
    expect(Math.abs(after - before)).toBeLessThan(0.01);
    expect(s.target).toBe(0);
  });

  it('timeMs of 0 means no smoothing', () => {
    const s = new Smoother(48000, 0, 0);
    s.setTarget(0.7);
    expect(s.next()).toBe(0.7);
    expect(s.value).toBe(0.7);
  });

  it('ignores non-finite targets and jumps', () => {
    const s = new Smoother(48000, 20, 0.5);
    s.setTarget(NaN);
    s.setTarget(Infinity);
    expect(s.target).toBe(0.5);
    expect(s.value).toBe(0.5);
    s.jump(NaN);
    expect(s.target).toBe(0.5);
    expect(s.value).toBe(0.5);
    s.setTarget(1);
    for (let i = 0; i < 10; i++) {
      expect(Number.isFinite(s.next())).toBe(true);
    }
  });

  it('isSettled respects a custom eps', () => {
    const s = new Smoother(48000, 20, 0);
    s.setTarget(1);
    run(s, 960); // value is about 0.632, distance to target about 0.368
    expect(s.isSettled(0.5)).toBe(true);
    expect(s.isSettled(1e-6)).toBe(false);
    expect(s.isSettled()).toBe(false);
  });
});
