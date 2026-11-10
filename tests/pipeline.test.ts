import { describe, expect, it } from 'vitest';
import { GesturePipeline, type PipelineConfig } from '../src/gestures/pipeline';
import { DEFAULT_POSE_MAP } from '../src/gestures/stabilizer';
import type { ActionEvent, HandFrame } from '../src/types';
import { POSE_FINGERS, lerpFingers, synthHand, type FingerExtension } from './fixtures/synthHand';

const CFG: PipelineConfig = {
  clutchOn: 0.32,
  clutchOff: 0.4,
  holdMs: 80,
  firedMs: 250,
  speedGate: 3,
  poseMap: DEFAULT_POSE_MAP,
  deadBand: 0.04,
};
const FRAME = 33;

interface Step {
  fingers: FingerExtension;
  thumb: 'clutch' | 'away';
  x?: number;
  roll?: number;
}

/** Plays frames through a pipeline and returns every action event. */
function replay(frames: (Step | Step[])[], pipeline = new GesturePipeline(CFG)) {
  const actions: ActionEvent[] = [];
  frames.forEach((f, i) => {
    const steps = Array.isArray(f) ? f : [f];
    const hands: HandFrame[] = steps.map((s, j) =>
      synthHand({
        fingers: s.fingers,
        thumb: s.thumb,
        screen: { x: s.x ?? 0.3, y: 0.7 },
        rollDeg: s.roll ?? 0,
        noise: 0.0015,
        seed: i * 7 + j + 1,
      }),
    );
    actions.push(...pipeline.update(hands, i * FRAME).actions);
  });
  return { actions, pipeline };
}

const hold = (step: Step, frames: number): Step[] => Array.from({ length: frames }, () => step);

/** Fingers move from a to b over n frames, with the index finger leading by `lead` frames. */
function transition(a: FingerExtension, b: FingerExtension, n: number, thumb: Step['thumb'], lead = 0, x = 0.3): Step[] {
  return Array.from({ length: n }, (_, i) => {
    const k = (i + 1) / n;
    const fingers = lerpFingers(a, b, k);
    fingers.index = a.index + (b.index - a.index) * Math.min(1, (i + 1 + lead) / n);
    return { fingers, thumb, x };
  });
}

const armed = (x = 0.3): Step => ({ fingers: POSE_FINGERS.fist, thumb: 'clutch', x });

describe('GesturePipeline', () => {
  it('fires nothing when opening a fist without the clutch, even with the index leading', () => {
    const { actions } = replay([
      ...hold({ fingers: POSE_FINGERS.fist, thumb: 'away' }, 10),
      ...transition(POSE_FINGERS.fist, POSE_FINGERS.all_four, 6, 'away', 3),
      ...hold({ fingers: POSE_FINGERS.all_four, thumb: 'away' }, 20),
    ]);
    expect(actions).toEqual([]);
  });

  it('fires exactly one loop2 on deck A for a clutch flick on the left half', () => {
    const { actions } = replay([
      ...hold(armed(), 6),
      ...hold({ fingers: POSE_FINGERS.index_middle, thumb: 'clutch' }, 30),
    ]);
    expect(actions.map((a) => [a.deck, a.action])).toEqual([['A', 'loop2']]);
  });

  it('fires on deck B for a hand on the right half', () => {
    const { actions } = replay([
      ...hold(armed(0.75), 6),
      ...hold({ fingers: POSE_FINGERS.index_pinky, thumb: 'clutch', x: 0.75 }, 10),
    ]);
    expect(actions.map((a) => [a.deck, a.action])).toEqual([['B', 'drums']]);
  });

  it('fires only loop4 when the index finger leads a fist-to-open flick', () => {
    const { actions } = replay([
      ...hold(armed(), 6),
      ...transition(POSE_FINGERS.fist, POSE_FINGERS.all_four, 5, 'clutch', 2), // index alone for ~66ms
      ...hold({ fingers: POSE_FINGERS.all_four, thumb: 'clutch' }, 20),
    ]);
    expect(actions.map((a) => a.action)).toEqual(['loop4']);
  });

  it('fires nothing more while holding or changing poses after a fire', () => {
    const { actions } = replay([
      ...hold(armed(), 6),
      ...hold({ fingers: POSE_FINGERS.index_middle, thumb: 'clutch' }, 90),
      ...transition(POSE_FINGERS.index_middle, POSE_FINGERS.all_four, 5, 'clutch'),
      ...hold({ fingers: POSE_FINGERS.all_four, thumb: 'clutch' }, 30),
      ...transition(POSE_FINGERS.all_four, POSE_FINGERS.pinky, 5, 'clutch'),
      ...hold({ fingers: POSE_FINGERS.pinky, thumb: 'clutch' }, 30),
    ]);
    expect(actions.map((a) => a.action)).toEqual(['loop2']);
  });

  it('reads a tilted hand the same as an upright one', () => {
    const tilted = (s: Step): Step => ({ ...s, roll: 45 });
    const { actions } = replay([
      ...hold(tilted(armed()), 6),
      ...hold(tilted({ fingers: POSE_FINGERS.index_middle_ring, thumb: 'clutch' }), 10),
    ]);
    expect(actions.map((a) => a.action)).toEqual(['inst']);
  });

  it('keeps a hand on its deck while it sits on the centre line', () => {
    const p = new GesturePipeline(CFG);
    replay(hold(armed(0.44), 5), p);
    const out = p.update([synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch', screen: { x: 0.51, y: 0.7 } })], 1000);
    expect(out.decks.A.hand).not.toBeNull();
    expect(out.decks.B.hand).toBeNull();
  });

  it('runs both decks independently', () => {
    const both = (a: Step, b: Step): Step[] => [a, b];
    const frames: Step[][] = [
      ...Array.from({ length: 6 }, () => both(armed(0.25), armed(0.75))),
      ...Array.from({ length: 10 }, () =>
        both({ fingers: POSE_FINGERS.index, thumb: 'clutch', x: 0.25 }, { fingers: POSE_FINGERS.pinky, thumb: 'clutch', x: 0.75 }),
      ),
    ];
    const { actions } = replay(frames);
    expect(actions.map((a) => `${a.deck}:${a.action}`).sort()).toEqual(['A:loop1', 'B:vocals']);
  });

  it('drops the inner hand when both hands are on one half', () => {
    const p = new GesturePipeline(CFG);
    const out = p.update(
      [
        synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch', screen: { x: 0.35, y: 0.7 } }),
        synthHand({ fingers: POSE_FINGERS.fist, thumb: 'clutch', screen: { x: 0.15, y: 0.7 } }),
      ],
      0,
    );
    expect(out.decks.A.features?.mirroredX).toBeCloseTo(0.15, 2);
    expect(out.decks.B.hand).toBeNull();
  });

  it('resets a deck to idle when its hand leaves the frame', () => {
    const p = new GesturePipeline(CFG);
    replay(hold(armed(), 5), p);
    expect(p.update([], 2000).decks.A.ring.phase).toBe('idle');
  });
});
