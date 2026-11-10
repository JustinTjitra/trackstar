import type { Action, Pose, PoseMap, RingState } from '../types';

export interface StabilizerConfig {
  /** How long a pose must be held before it fires. */
  holdMs: number;
  /** How long the fired flash shows before the ring asks for a fist. */
  firedMs: number;
  /** Wrist speed (hand lengths per second) above which nothing can form. */
  speedGate: number;
  poseMap: PoseMap;
}

export const DEFAULT_POSE_MAP: PoseMap = {
  index: 'loop1',
  index_middle: 'loop2',
  all_four: 'loop4',
  index_pinky: 'drums',
  pinky: 'vocals',
  index_middle_ring: 'inst',
};

export interface StabilizerInput {
  pose: Pose;
  clutch: boolean;
  speed: number;
  t: number;
}

export interface StabilizerOutput {
  ring: RingState;
  fired: Action | null;
}

type Phase = RingState['phase'];

/**
 * One per deck. Discrete actions can only fire by going from an armed fist
 * (clutch held) into a mapped pose and holding it. After firing, nothing else
 * fires until the hand closes back into the armed fist.
 */
export class Stabilizer {
  private cfg: StabilizerConfig;
  private phase: Phase = 'idle';
  private action: Action | null = null;
  private formingPose: Pose | null = null;
  private since = 0;

  constructor(cfg: StabilizerConfig) {
    this.cfg = { ...cfg };
  }

  setConfig(cfg: StabilizerConfig): void {
    this.cfg = { ...cfg };
  }

  reset(): void {
    this.phase = 'idle';
    this.action = null;
    this.formingPose = null;
  }

  update({ pose, clutch, speed, t }: StabilizerInput): StabilizerOutput {
    let fired: Action | null = null;

    switch (this.phase) {
      case 'idle':
        if (clutch && pose === 'fist') this.go('armed', t);
        break;

      case 'armed':
        if (!clutch) this.go('idle', t);
        else this.tryForm(pose, speed, t);
        break;

      case 'forming':
        if (!clutch) {
          this.go('idle', t);
        } else if (pose !== this.formingPose || speed > this.cfg.speedGate) {
          this.go('armed', t);
          this.tryForm(pose, speed, t);
        } else if (t - this.since >= this.cfg.holdMs) {
          fired = this.action;
          this.go('fired', t);
        }
        break;

      case 'fired':
        if (t - this.since >= this.cfg.firedMs) {
          this.go(clutch ? 'rearm' : 'idle', t);
        }
        break;

      case 'rearm':
        if (!clutch) this.go('idle', t);
        else if (pose === 'fist') this.go('armed', t);
        break;
    }

    return { ring: this.ring(t), fired };
  }

  private tryForm(pose: Pose, speed: number, t: number): void {
    if (pose === 'fist' || pose === 'none' || speed > this.cfg.speedGate) return;
    const action = this.cfg.poseMap[pose];
    if (!action) return;
    this.formingPose = pose;
    this.action = action;
    this.go('forming', t);
  }

  private go(phase: Phase, t: number): void {
    if (phase === 'idle' || phase === 'armed') {
      this.action = null;
      this.formingPose = null;
    }
    this.phase = phase;
    this.since = t;
  }

  private ring(t: number): RingState {
    const progress =
      this.phase === 'forming' ? Math.min(1, (t - this.since) / Math.max(1, this.cfg.holdMs)) : this.phase === 'fired' ? 1 : 0;
    return { phase: this.phase, action: this.action, progress };
  }
}
