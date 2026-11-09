export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Deck = 'A' | 'B';
export const DECKS: readonly Deck[] = ['A', 'B'];

/** One tracked hand. Image landmarks are normalised 0..1 and NOT mirrored. World landmarks are metres. */
export interface HandFrame {
  landmarks: Vec3[];
  world: Vec3[];
}

export type Pose =
  | 'fist'
  | 'index'
  | 'index_middle'
  | 'index_middle_ring'
  | 'all_four'
  | 'pinky'
  | 'index_pinky'
  | 'none';

export type ActionPose = Exclude<Pose, 'fist' | 'none'>;
export const ACTION_POSES: readonly ActionPose[] = [
  'index',
  'index_middle',
  'index_middle_ring',
  'all_four',
  'pinky',
  'index_pinky',
];

export type Action = 'loop1' | 'loop2' | 'loop4' | 'drums' | 'vocals' | 'inst';
export const ACTIONS: readonly Action[] = ['loop1', 'loop2', 'loop4', 'drums', 'vocals', 'inst'];
export const LOOP_ACTIONS: readonly Action[] = ['loop1', 'loop2', 'loop4'];
export const STEM_ACTIONS: readonly Action[] = ['drums', 'vocals', 'inst'];

export type PoseMap = Record<ActionPose, Action | null>;

export interface ActionEvent {
  deck: Deck;
  action: Action;
  t: number;
}

export type RingPhase = 'idle' | 'armed' | 'forming' | 'fired' | 'rearm';

export interface RingState {
  phase: RingPhase;
  action: Action | null;
  /** 0..1, how far through the hold time a forming pose is. */
  progress: number;
}
