import { DEFAULT_POSE_MAP } from '../gestures/stabilizer';
import type { Action, PoseMap } from '../types';
import type { ReleaseType, SceneSlot } from '../fx/types';

/** Settings of the effects (FX) mode. */
export interface FxConfig {
  /** Label of the chosen audio input device, or null for none chosen yet. */
  inputLabel: string | null;
  /** Label of the chosen audio output device, or null for the default output. */
  outputLabel: string | null;
  /** Where the music comes from: the built-in demo loop or a live input device. */
  source: 'demo' | 'input';
  /** Which release effect the release gesture triggers. */
  releaseType: ReleaseType;
  /** Length of the release effect in beats, 0.25 to 8. */
  releaseBeats: number;
  /** The scene slot selected at start, 0 to 4. */
  sceneSlot: SceneSlot;
  /** Whether the tempo follows the music automatically. */
  autoBpm: boolean;
}

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
  /** Settings of the effects mode. */
  fx: FxConfig;
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
  // rekordbox's ActiveStem functions light up while a stem is playing, the
  // opposite of "muted", so stems are inverted by default.
  invert: Object.freeze({ drums: true, vocals: true, inst: true }),
  fx: Object.freeze({ inputLabel: null, outputLabel: null, source: 'demo', releaseType: 'brake', releaseBeats: 2, sceneSlot: 1, autoBpm: true }) as FxConfig,
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
    fx: { ...DEFAULT_CONFIG.fx },
  };
}

/** Stored effects settings merged over the defaults; a field that is missing or not valid keeps its default. */
function mergeFx(base: FxConfig, stored: unknown): FxConfig {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return { ...base };
  const s = stored as Record<string, unknown>;
  const label = (v: unknown, fallback: string | null): string | null =>
    typeof v === 'string' || v === null ? v : fallback;
  const beats =
    typeof s.releaseBeats === 'number' && Number.isFinite(s.releaseBeats)
      ? Math.min(8, Math.max(0.25, s.releaseBeats))
      : base.releaseBeats;
  return {
    inputLabel: label(s.inputLabel, base.inputLabel),
    outputLabel: label(s.outputLabel, base.outputLabel),
    source: s.source === 'demo' || s.source === 'input' ? s.source : base.source,
    releaseType:
      s.releaseType === 'brake' || s.releaseType === 'echo' || s.releaseType === 'backspin'
        ? s.releaseType
        : base.releaseType,
    releaseBeats: beats,
    sceneSlot: s.sceneSlot === 0 || s.sceneSlot === 1 || s.sceneSlot === 2 || s.sceneSlot === 3 || s.sceneSlot === 4 ? s.sceneSlot : base.sceneSlot,
    autoBpm: typeof s.autoBpm === 'boolean' ? s.autoBpm : base.autoBpm,
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
      invert: { ...base.invert, ...(stored.invert ?? {}) },
      fx: mergeFx(base.fx, stored.fx),
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
