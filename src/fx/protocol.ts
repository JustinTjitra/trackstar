// message protocol between the page and the audio thread: message types, a validator and a dispatcher

import type { EngineState, FxEngine } from './engine';
import type { ReleaseType, RollDivision, SceneSlot } from './types';

/** A control message sent from the page to the audio thread. */
export type FxMessage =
  | { type: 'bpm'; bpm: number }
  | { type: 'autoBpm'; on: boolean }
  | { type: 'bypass'; on: boolean }
  | { type: 'sceneSlot'; slot: SceneSlot }
  | { type: 'sceneAmount'; value: number }
  | { type: 'isolator'; low: number; mid: number; high: number }
  | { type: 'rollStart'; division: RollDivision }
  | { type: 'rollStop' }
  | { type: 'release'; release: ReleaseType; beats?: number }
  | { type: 'reset' };

/** The engine methods a message can reach. */
export type FxControls = Pick<
  FxEngine,
  'setBpm' | 'setBypass' | 'setSceneSlot' | 'setSceneAmount' | 'setIsolator' | 'rollStart' | 'rollStop' | 'release' | 'reset'
>;

/** State report sent from the audio thread to the page, about ten times a second. */
export interface FxStateMessage extends EngineState {
  type: 'state';
  /** Tempo found by the detector, or null when it has none. */
  detectedBpm: number | null;
  /** Confidence of the detected tempo, 0..1. */
  bpmConfidence: number;
}

/** Sent once by the audio thread when processing failed; it passes audio through untouched from then on. */
export interface FxErrorMessage {
  type: 'error';
  message: string;
}

const SLOTS: readonly number[] = [0, 1, 2, 3, 4];
const DIVISIONS: readonly number[] = [1, 0.5, 0.25, 0.125];
const RELEASES: readonly string[] = ['brake', 'echo', 'backspin'];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * True only for a well-formed FxMessage: a non-array object whose type is known and whose fields pass
 * the rule for that type. Extra properties are ignored. Never throws, whatever it is given.
 */
export function isFxMessage(x: unknown): x is FxMessage {
  try {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
    const m = x as Record<string, unknown>;
    switch (m.type) {
      case 'bpm':
        return isFiniteNumber(m.bpm);
      case 'autoBpm':
        return typeof m.on === 'boolean';
      case 'bypass':
        return typeof m.on === 'boolean';
      case 'sceneSlot':
        return typeof m.slot === 'number' && SLOTS.includes(m.slot);
      case 'sceneAmount':
        return isFiniteNumber(m.value);
      case 'isolator':
        return isFiniteNumber(m.low) && isFiniteNumber(m.mid) && isFiniteNumber(m.high);
      case 'rollStart':
        return typeof m.division === 'number' && DIVISIONS.includes(m.division);
      case 'rollStop':
        return true;
      case 'release':
        if (typeof m.release !== 'string' || !RELEASES.includes(m.release)) return false;
        return m.beats === undefined || (isFiniteNumber(m.beats) && m.beats > 0);
      case 'reset':
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Sends a validated message to the engine: one engine call, and true. The 'autoBpm' message is not an
 * engine call; the audio processor handles it, so nothing is called and false is returned. This does
 * not validate: run isFxMessage first.
 */
export function applyMessage(engine: FxControls, msg: FxMessage): boolean {
  switch (msg.type) {
    case 'bpm':
      engine.setBpm(msg.bpm);
      return true;
    case 'autoBpm':
      return false;
    case 'bypass':
      engine.setBypass(msg.on);
      return true;
    case 'sceneSlot':
      engine.setSceneSlot(msg.slot);
      return true;
    case 'sceneAmount':
      engine.setSceneAmount(msg.value);
      return true;
    case 'isolator':
      engine.setIsolator(msg.low, msg.mid, msg.high);
      return true;
    case 'rollStart':
      engine.rollStart(msg.division);
      return true;
    case 'rollStop':
      engine.rollStop();
      return true;
    case 'release':
      engine.release(msg.release, msg.beats);
      return true;
    case 'reset':
      engine.reset();
      return true;
  }
}
