import type { HandFrame, Vec3 } from '../types';
import { angleAt, dist, dist2d, pointSegmentDistance } from './geometry';

export interface FeatureConfig {
  /** Clutch engages when the clutch ratio drops below this. */
  clutchOn: number;
  /** Clutch releases when the clutch ratio rises above this. */
  clutchOff: number;
}

export interface FingerFlags {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface HandFeatures {
  fingers: FingerFlags;
  clutch: boolean;
  clutchRatio: number;
  /** Wrist position in the mirrored display, 0..1. */
  mirroredX: number;
  mirroredY: number;
  /** Smoothed wrist speed in hand-lengths per second. */
  speed: number;
}

/** Landmark ids: [MCP, PIP, TIP] per finger. */
const FINGER_JOINTS: Record<keyof FingerFlags, [number, number, number]> = {
  index: [5, 6, 8],
  middle: [9, 10, 12],
  ring: [13, 14, 16],
  pinky: [17, 18, 20],
};

/** A finger becomes extended above this PIP angle... */
const EXTEND_DEG = 150;
/** ...and only counts as folded again below this one. */
const FOLD_DEG = 125;
const SPEED_SMOOTHING = 0.5;

export function fingerAngle(world: Vec3[], mcp: number, pip: number, tip: number): number {
  return angleAt(world[mcp], world[pip], world[tip]);
}

/** Hand length used to normalise distances: wrist to middle-finger knuckle. */
export function handSize(points: Vec3[]): number {
  return dist(points[0], points[9]);
}

/** Thumb tip distance to the index finger's first segment, in hand lengths. */
export function clutchRatio(world: Vec3[]): number {
  const size = handSize(world);
  if (size === 0) return Infinity;
  return pointSegmentDistance(world[4], world[5], world[6]) / size;
}

export class FeatureExtractor {
  private cfg: FeatureConfig;
  private fingers: FingerFlags = { index: false, middle: false, ring: false, pinky: false };
  private clutch = false;
  private prevWrist: Vec3 | null = null;
  private prevT = 0;
  private speed = 0;

  constructor(cfg: FeatureConfig) {
    this.cfg = { ...cfg };
  }

  setConfig(cfg: FeatureConfig): void {
    this.cfg = { ...cfg };
  }

  reset(): void {
    this.fingers = { index: false, middle: false, ring: false, pinky: false };
    this.clutch = false;
    this.prevWrist = null;
    this.speed = 0;
  }

  update(hand: HandFrame, t: number): HandFeatures {
    const { world, landmarks } = hand;

    const next = { ...this.fingers };
    for (const name of Object.keys(FINGER_JOINTS) as (keyof FingerFlags)[]) {
      const [mcp, pip, tip] = FINGER_JOINTS[name];
      const angle = fingerAngle(world, mcp, pip, tip);
      if (angle > EXTEND_DEG) next[name] = true;
      else if (angle < FOLD_DEG) next[name] = false;
    }
    this.fingers = next;

    const ratio = clutchRatio(world);
    if (ratio < this.cfg.clutchOn) this.clutch = true;
    else if (ratio > this.cfg.clutchOff) this.clutch = false;

    const wrist = landmarks[0];
    if (this.prevWrist && t > this.prevT) {
      const size = Math.max(1e-6, dist2d(landmarks[0], landmarks[9]));
      const raw = dist2d(wrist, this.prevWrist) / size / ((t - this.prevT) / 1000);
      this.speed = this.speed + SPEED_SMOOTHING * (raw - this.speed);
    }
    this.prevWrist = wrist;
    this.prevT = t;

    return {
      fingers: { ...this.fingers },
      clutch: this.clutch,
      clutchRatio: ratio,
      mirroredX: 1 - wrist.x,
      mirroredY: wrist.y,
      speed: this.speed,
    };
  }
}
