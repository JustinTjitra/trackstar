import { describe, expect, it } from 'vitest';
import { FeatureExtractor, clutchRatio, fingerAngle } from '../src/gestures/features';
import { POSE_FINGERS, synthHand } from './fixtures/synthHand';

const CFG = { clutchOn: 0.32, clutchOff: 0.4 };

describe('fingerAngle', () => {
  it('is near 180 for an extended finger and well under 125 for a folded one', () => {
    const open = synthHand({ fingers: POSE_FINGERS.all_four, thumb: 'away' });
    const fist = synthHand({ fingers: POSE_FINGERS.fist, thumb: 'away' });
    expect(fingerAngle(open.world, 5, 6, 8)).toBeGreaterThan(170);
    expect(fingerAngle(fist.world, 5, 6, 8)).toBeLessThan(110);
  });
});

describe('clutchRatio', () => {
  it('is small when the thumb presses the index knuckle and large when it is away', () => {
    const clutch = synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' });
    const away = synthHand({ fingers: POSE_FINGERS.fist, thumb: 'away' });
    expect(clutchRatio(clutch.world)).toBeLessThan(0.3);
    expect(clutchRatio(away.world)).toBeGreaterThan(0.45);
  });
});

describe('FeatureExtractor', () => {
  const poses = Object.entries(POSE_FINGERS);

  it.each([0, 45, 90, -60])('reads every pose correctly at roll %i degrees', (roll) => {
    for (const [name, fingers] of poses) {
      const fx = new FeatureExtractor(CFG);
      const f = fx.update(synthHand({ fingers, thumb: 'clutch', rollDeg: roll, noise: 0.002, seed: 7 }), 0);
      const expected = {
        index: fingers.index === 1,
        middle: fingers.middle === 1,
        ring: fingers.ring === 1,
        pinky: fingers.pinky === 1,
      };
      expect(f.fingers, `${name} at ${roll}deg`).toEqual(expected);
    }
  });

  it('detects the clutch with hysteresis', () => {
    const fx = new FeatureExtractor(CFG);
    expect(fx.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'away' }), 0).clutch).toBe(false);
    expect(fx.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' }), 33).clutch).toBe(true);

    // A ratio between on and off keeps the previous state either way.
    const between = new FeatureExtractor({ clutchOn: 0.1, clutchOff: 0.9 });
    expect(between.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' }), 0).clutch).toBe(false);
    const engaged = new FeatureExtractor({ clutchOn: 0.3, clutchOff: 0.9 });
    engaged.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' }), 0);
    expect(engaged.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'away' }), 33).clutch).toBe(true);
  });

  it('keeps a finger state when the angle sits between the two thresholds', () => {
    const fx = new FeatureExtractor(CFG);
    fx.update(synthHand({ fingers: POSE_FINGERS.index, thumb: 'clutch' }), 0);
    // index 0.68 gives a PIP angle of about 138 degrees, between the 125 and 150 thresholds.
    const half = { index: 0.68, middle: 0, ring: 0, pinky: 0 };
    expect(fx.update(synthHand({ fingers: half, thumb: 'clutch' }), 33).fingers.index).toBe(true);
    const fx2 = new FeatureExtractor(CFG);
    fx2.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' }), 0);
    expect(fx2.update(synthHand({ fingers: half, thumb: 'clutch' }), 33).fingers.index).toBe(false);
  });

  it('reports near-zero speed for a still hand and high speed for a fast one', () => {
    const still = new FeatureExtractor(CFG);
    still.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' }), 0);
    expect(still.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch' }), 33).speed).toBeLessThan(0.1);

    const fast = new FeatureExtractor(CFG);
    fast.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch', screen: { x: 0.2, y: 0.7 } }), 0);
    const f = fast.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch', screen: { x: 0.4, y: 0.7 } }), 50);
    expect(f.speed).toBeGreaterThan(3);
  });

  it('reports wrist position in mirrored display coordinates', () => {
    const fx = new FeatureExtractor(CFG);
    const f = fx.update(synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch', screen: { x: 0.25, y: 0.6 } }), 0);
    expect(f.mirroredX).toBeCloseTo(0.25, 5);
    expect(f.mirroredY).toBeCloseTo(0.6, 5);
  });
});
