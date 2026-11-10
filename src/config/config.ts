import { DEFAULT_POSE_MAP } from '../gestures/stabilizer';
import type { Action, PoseMap } from '../types';

export interface Config {
  outPort: string | null;
  /** null = the input with the same name as the output. */
  inPort: string | null;
  feedbackEnabled: boolean;
  clutchOn: number;
  clutchOff: number;
  calibrated: boolean;
  holdMs: number;
  speedGate: number;
  poseMap: PoseMap;
  showSkeleton: boolean;
  /** 0 = camera at full brightness, 1 = black. */
  cameraDim: number;
  blind: Partial<Record<Action, boolean>>;
  invert: Partial<Record<Action, boolean>>;
}

export const DEFAULT_CONFIG: Config = Object.freeze({
  outPort: null,
  inPort: null,
  feedbackEnabled: true,
  clutchOn: 0.32,
  clutchOff: 0.4,
  calibrated: false,
  holdMs: 80,
  speedGate: 3,
  poseMap: Object.freeze({ ...DEFAULT_POSE_MAP }) as PoseMap,
  showSkeleton: true,
  cameraDim: 0.35,
  blind: Object.freeze({}),
  invert: Object.freeze({}),
}) as Config;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'trackstar.config.v1';

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function fresh(): Config {
  return {
    ...DEFAULT_CONFIG,
    poseMap: { ...DEFAULT_CONFIG.poseMap },
    blind: { ...DEFAULT_CONFIG.blind },
    invert: { ...DEFAULT_CONFIG.invert },
  };
}

export function loadConfig(storage: StorageLike | undefined = defaultStorage()): Config {
  const base = fresh();
  if (!storage) return base;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<Config>;
    if (!stored || typeof stored !== 'object') return base;
    return {
      ...base,
      ...stored,
      poseMap: { ...base.poseMap, ...(stored.poseMap ?? {}) },
      blind: { ...(stored.blind ?? {}) },
      invert: { ...(stored.invert ?? {}) },
    };
  } catch {
    return base;
  }
}

export function saveConfig(cfg: Config, storage: StorageLike | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // Storage blocked or full: settings just will not persist this session.
  }
}
