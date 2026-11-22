// the display state bus: the message the main app sends to the deck screen page, and a publish/subscribe wrapper around BroadcastChannel

import type { DeckSnapshot, ControlView } from '../state/deckStore';
import { ACTIONS, DECKS } from '../types';
import type { Action, Deck } from '../types';

/** Name of the BroadcastChannel both pages use. */
export const DISPLAY_CHANNEL = 'trackstar-display';

/** The effects part of the display state. */
export interface DisplayFxState {
  slot: number;
  amount: number;
  rollActive: boolean;
  releaseActive: boolean;
  bypass: boolean;
}

/** Everything the deck screen shows. `v` is the format version, `t` the sender's clock in milliseconds. */
export interface DisplayState {
  v: 1;
  t: number;
  mode: 'deck' | 'fx';
  decks: DeckSnapshot;
  fx: DisplayFxState | null;
  bpm: number | null;
}

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function readControl(x: unknown): ControlView | null {
  if (!isObj(x)) return null;
  const { value, pending, unconfirmed, blind } = x;
  if (value !== true && value !== false && value !== null) return null;
  if (typeof pending !== 'boolean' || typeof unconfirmed !== 'boolean' || typeof blind !== 'boolean') return null;
  return { value, pending, unconfirmed, blind };
}

function readDecks(x: unknown): DeckSnapshot | null {
  if (!isObj(x)) return null;
  const out = {} as Record<Deck, Record<Action, ControlView>>;
  for (const d of DECKS) {
    const row = x[d];
    if (!isObj(row)) return null;
    const copy = {} as Record<Action, ControlView>;
    for (const a of ACTIONS) {
      const c = readControl(row[a]);
      if (c === null) return null;
      copy[a] = c;
    }
    out[d] = copy;
  }
  return out;
}

function readFx(x: unknown): DisplayFxState | null | undefined {
  if (x === null) return null;
  if (!isObj(x)) return undefined;
  const { slot, amount, rollActive, releaseActive, bypass } = x;
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 4) return undefined;
  if (!isFiniteNumber(amount)) return undefined;
  if (typeof rollActive !== 'boolean' || typeof releaseActive !== 'boolean' || typeof bypass !== 'boolean') return undefined;
  return { slot, amount, rollActive, releaseActive, bypass };
}

/** Turns a display state into a string, so the same message can travel over other transports later. */
export function encode(state: DisplayState): string {
  return JSON.stringify(state);
}

/**
 * Reads a message (a JSON string or an already parsed object) into a new, clean DisplayState, or null
 * when it is not exactly the version 1 format. Unknown properties are dropped. Never throws.
 */
export function decode(raw: unknown): DisplayState | null {
  try {
    let x: unknown = raw;
    if (typeof raw === 'string') {
      try {
        x = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!isObj(x)) return null;
    if (x.v !== 1) return null;
    const t = x.t;
    if (!isFiniteNumber(t)) return null;
    const mode = x.mode;
    if (mode !== 'deck' && mode !== 'fx') return null;
    const decks = readDecks(x.decks);
    if (decks === null) return null;
    const fx = readFx(x.fx);
    if (fx === undefined) return null;
    const bpm = x.bpm;
    if (bpm !== null && !(isFiniteNumber(bpm) && bpm > 0)) return null;
    return { v: 1, t, mode, decks, fx, bpm };
  } catch {
    return null;
  }
}

/** The part of BroadcastChannel the bus uses; tests pass a fake. */
export interface ChannelLike {
  postMessage(data: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

/** A publish/subscribe handle on the display channel. */
export interface DisplayBus {
  /** Sends a state to the other pages. Never throws; does nothing after close. */
  publish(state: DisplayState): void;
  /** Calls fn with every valid state received. Returns a function that removes it. */
  subscribe(fn: (state: DisplayState) => void): () => void;
  /** Shuts the channel and forgets all listeners. Safe to call twice. */
  close(): void;
}

const noop = (): void => {};

/**
 * Opens the display channel at once. A BroadcastChannel does not deliver a message to the object that
 * posted it, only to other channel objects of the same name (other pages or tabs), which is what this
 * bus is for: a bus does not hear its own publishes. If the channel cannot be created (no
 * BroadcastChannel in this browser, or it is blocked) the bus does nothing and throws nothing.
 */
export function createBus(
  factory: (name: string) => ChannelLike = (name) => new BroadcastChannel(name) as unknown as ChannelLike,
): DisplayBus {
  let channel: ChannelLike;
  try {
    channel = factory(DISPLAY_CHANNEL);
  } catch {
    return { publish: noop, subscribe: () => noop, close: noop };
  }

  const listeners = new Set<(state: DisplayState) => void>();
  let closed = false;

  channel.onmessage = (event) => {
    const state = decode(event.data);
    if (state === null) return;
    for (const fn of [...listeners]) {
      try {
        fn(state);
      } catch {
        // one failing listener must not stop the others
      }
    }
  };

  return {
    publish(state) {
      if (closed) return;
      try {
        channel.postMessage(encode(state));
      } catch {
        // a closed or failing channel is not the caller's problem
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // already closed
      }
      listeners.clear();
    },
  };
}
