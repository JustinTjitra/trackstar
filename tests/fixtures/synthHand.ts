import type { HandFrame, Vec3 } from '../../src/types';

/**
 * Builds a plausible 21-point MediaPipe hand from a few parameters, so gesture logic
 * can be tested without a camera. Geometry is a simple kinematic model, palm facing
 * the camera. Real recordings (see ?record mode) can supplement these later.
 */
export interface FingerExtension {
  index: number; // 0 = fully folded, 1 = fully extended
  middle: number;
  ring: number;
  pinky: number;
}

export interface SynthOptions {
  fingers: FingerExtension;
  thumb: 'clutch' | 'away';
  /** Wrist position in the MIRRORED display, 0..1. Default centre-left (deck A). */
  screen?: { x: number; y: number };
  /** In-plane rotation in degrees (positive = clockwise on screen). */
  rollDeg?: number;
  /** Image units per metre. Default makes the hand about 20% of the frame. */
  scale?: number;
  /** Uniform noise amplitude in metres (image noise scales with it). */
  noise?: number;
  seed?: number;
}

const FINGERS = {
  index: { base: [0.025, 0.085], seg: [0.04, 0.025, 0.02], ids: [5, 6, 7, 8] },
  middle: { base: [0.005, 0.09], seg: [0.045, 0.028, 0.02], ids: [9, 10, 11, 12] },
  ring: { base: [-0.015, 0.085], seg: [0.042, 0.026, 0.02], ids: [13, 14, 15, 16] },
  pinky: { base: [-0.032, 0.075], seg: [0.032, 0.02, 0.018], ids: [17, 18, 19, 20] },
} as const;

const MAX_FLEX_DEG = [80, 100, 70]; // MCP, PIP, DIP

const THUMBS: Record<'clutch' | 'away', [number, number, number][]> = {
  away: [
    [0.02, 0.02, 0.01],
    [0.045, 0.04, 0.015],
    [0.065, 0.06, 0.02],
    [0.08, 0.075, 0.02],
  ],
  clutch: [
    [0.02, 0.02, 0.01],
    [0.04, 0.035, 0.02],
    [0.045, 0.06, 0.025],
    [0.035, 0.08, 0.015],
  ],
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthHand(opts: SynthOptions): HandFrame {
  const local: [number, number, number][] = new Array(21);
  local[0] = [0, 0, 0];
  THUMBS[opts.thumb].forEach((p, i) => (local[1 + i] = p));

  for (const name of Object.keys(FINGERS) as (keyof typeof FINGERS)[]) {
    const f = FINGERS[name];
    const ext = Math.min(1, Math.max(0, opts.fingers[name]));
    let pos: [number, number, number] = [f.base[0], f.base[1], 0];
    local[f.ids[0]] = pos;
    let theta = 0;
    for (let s = 0; s < 3; s++) {
      theta += ((1 - ext) * MAX_FLEX_DEG[s] * Math.PI) / 180;
      const len = f.seg[s];
      // Fingers curl toward the camera (+z) because the palm faces it.
      pos = [pos[0], pos[1] + len * Math.cos(theta), pos[2] + len * Math.sin(theta)];
      local[f.ids[s + 1]] = pos;
    }
  }

  const roll = ((opts.rollDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const scale = opts.scale ?? 2.2;
  const noise = opts.noise ?? 0;
  const rand = rng(opts.seed ?? 1);
  const jitter = () => (rand() * 2 - 1) * noise;
  const screen = opts.screen ?? { x: 0.3, y: 0.7 };
  const imgX0 = 1 - screen.x; // unmirror

  const world: Vec3[] = [];
  const landmarks: Vec3[] = [];
  for (const [x, y, z] of local) {
    // Clockwise on screen in the mirrored view. Local y is up; screen y is down.
    const rx = x * cos + y * sin;
    const ry = -x * sin + y * cos;
    const wx = rx + jitter();
    const wy = ry + jitter();
    const wz = z + jitter();
    world.push({ x: wx, y: -wy, z: -wz });
    // Mirroring flips x between image and display.
    landmarks.push({ x: imgX0 - wx * scale, y: screen.y - wy * scale, z: -wz * scale });
  }
  return { landmarks, world };
}

export const POSE_FINGERS = {
  fist: { index: 0, middle: 0, ring: 0, pinky: 0 },
  index: { index: 1, middle: 0, ring: 0, pinky: 0 },
  index_middle: { index: 1, middle: 1, ring: 0, pinky: 0 },
  index_middle_ring: { index: 1, middle: 1, ring: 1, pinky: 0 },
  all_four: { index: 1, middle: 1, ring: 1, pinky: 1 },
  pinky: { index: 0, middle: 0, ring: 0, pinky: 1 },
  index_pinky: { index: 1, middle: 0, ring: 0, pinky: 1 },
} as const satisfies Record<string, FingerExtension>;

export function lerpFingers(a: FingerExtension, b: FingerExtension, k: number): FingerExtension {
  return {
    index: a.index + (b.index - a.index) * k,
    middle: a.middle + (b.middle - a.middle) * k,
    ring: a.ring + (b.ring - a.ring) * k,
    pinky: a.pinky + (b.pinky - a.pinky) * k,
  };
}
