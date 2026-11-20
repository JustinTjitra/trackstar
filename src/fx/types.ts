/** A stereo effect that processes audio in place. `frames` may be smaller than the array length. */
export interface StereoEffect {
  process(l: Float32Array, r: Float32Array, frames: number): void;
  reset(): void;
}

/** Implemented by effects whose timing follows the tempo. */
export interface TempoAware {
  setBpm(bpm: number): void;
}

/** The five Scene FX slots. */
export type SceneSlot = 0 | 1 | 2 | 3 | 4;

/** 'up' is the build-up effect of a slot, 'down' its break-down effect. */
export type SceneDirection = 'up' | 'down';

/** The three Release FX: each ends the current effects with a brake, an echo tail or a back spin. */
export type ReleaseType = 'brake' | 'echo' | 'backspin';

/** Roll length in beats. */
export type RollDivision = 1 | 0.5 | 0.25 | 0.125;
