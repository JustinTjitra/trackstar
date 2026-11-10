import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE_MAP, Stabilizer, type StabilizerConfig } from '../src/gestures/stabilizer';
import type { Action, Pose } from '../src/types';

const CFG: StabilizerConfig = { holdMs: 80, firedMs: 250, speedGate: 3, poseMap: DEFAULT_POSE_MAP };
const FRAME = 33;

/** Feeds a sequence of [pose, clutch, frames, speed?] steps and collects what fired. */
function run(s: Stabilizer, steps: [Pose, boolean, number, number?][], start = 0) {
  let t = start;
  const fired: Action[] = [];
  let last = s.update({ pose: 'fist', clutch: false, speed: 0, t }).ring;
  t += FRAME;
  s.reset();
  for (const [pose, clutch, frames, speed = 0] of steps) {
    for (let i = 0; i < frames; i++) {
      const out = s.update({ pose, clutch, speed, t });
      if (out.fired) fired.push(out.fired);
      last = out.ring;
      t += FRAME;
    }
  }
  return { fired, ring: last, t };
}

describe('Stabilizer', () => {
  it('never fires without the clutch', () => {
    const { fired, ring } = run(new Stabilizer(CFG), [
      ['fist', false, 5],
      ['index_middle', false, 20],
      ['all_four', false, 20],
    ]);
    expect(fired).toEqual([]);
    expect(ring.phase).toBe('idle');
  });

  it('arms on clutch + fist', () => {
    const { ring } = run(new Stabilizer(CFG), [['fist', true, 2]]);
    expect(ring.phase).toBe('armed');
  });

  it('fires once when a mapped pose is held past the hold time', () => {
    const { fired, ring } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index_middle', true, 4],
    ]);
    expect(fired).toEqual(['loop2']);
    expect(ring.phase).toBe('fired');
  });

  it('fires nothing when the pose is released before the hold time', () => {
    const { fired } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index_middle', true, 2],
      ['fist', true, 5],
    ]);
    expect(fired).toEqual([]);
  });

  it('restarts the hold when the pose changes mid-form', () => {
    const { fired } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index', true, 2],
      ['all_four', true, 4],
    ]);
    expect(fired).toEqual(['loop4']);
  });

  it('aborts while the hand moves fast', () => {
    const { fired, ring } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index_middle', true, 10, 5],
    ]);
    expect(fired).toEqual([]);
    expect(ring.phase).toBe('armed');
  });

  it('fires nothing more until the hand returns to the armed fist', () => {
    const { fired } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index_middle', true, 30],
      ['all_four', true, 30],
      ['pinky', true, 30],
    ]);
    expect(fired).toEqual(['loop2']);
  });

  it('shows rearm after the flash and allows a second action after a fist', () => {
    const s = new Stabilizer(CFG);
    const first = run(s, [
      ['fist', true, 3],
      ['index_middle', true, 15],
    ]);
    expect(first.ring.phase).toBe('rearm');
    const { fired } = run(s, [
      ['fist', true, 3],
      ['index_middle', true, 15],
      ['fist', true, 3],
      ['index_pinky', true, 4],
    ]);
    expect(fired).toEqual(['loop2', 'drums']);
  });

  it('goes idle when the clutch is released mid-form', () => {
    const { fired, ring } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index_middle', true, 1],
      ['index_middle', false, 10],
    ]);
    expect(fired).toEqual([]);
    expect(ring.phase).toBe('idle');
  });

  it('ignores unmapped poses while armed', () => {
    const map = { ...DEFAULT_POSE_MAP, pinky: null };
    const { fired, ring } = run(new Stabilizer({ ...CFG, poseMap: map }), [
      ['fist', true, 3],
      ['pinky', true, 10],
      ['none', true, 10],
    ]);
    expect(fired).toEqual([]);
    expect(ring.phase).toBe('armed');
  });

  it('reports hold progress from 0 to 1 while forming', () => {
    const s = new Stabilizer({ ...CFG, holdMs: 100 });
    s.update({ pose: 'fist', clutch: true, speed: 0, t: 0 });
    const a = s.update({ pose: 'index', clutch: true, speed: 0, t: 10 });
    const b = s.update({ pose: 'index', clutch: true, speed: 0, t: 60 });
    expect(a.ring).toMatchObject({ phase: 'forming', action: 'loop1' });
    expect(a.ring.progress).toBeCloseTo(0, 5);
    expect(b.ring.progress).toBeCloseTo(0.5, 5);
  });

  it('goes back to idle from fired when the clutch was released during the flash', () => {
    const { ring } = run(new Stabilizer(CFG), [
      ['fist', true, 3],
      ['index', true, 4],
      ['index', false, 12],
    ]);
    expect(ring.phase).toBe('idle');
  });
});
