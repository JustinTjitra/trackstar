// the deck screen's view model: a pure function from the last received state, the time and the screen size to what the page shows

import { CHIP_NAMES, chipClasses } from '../ui/labels';
import { DECK_COLOR } from '../ui/colors';
import { DECKS, LOOP_ACTIONS, STEM_ACTIONS } from '../types';
import type { Action, Deck } from '../types';
import type { DeckSnapshot } from '../state/deckStore';
import type { DisplayFxState, DisplayState } from './bus';

/** 'wide' is the bar layout for very wide screens; 'standard' is everything else. */
export type DisplayLayout = 'wide' | 'standard';
/** 'waiting': nothing received yet. 'live': a recent state. 'stale': the app stopped sending. */
export type DisplayStatus = 'waiting' | 'live' | 'stale';

/** One chip: the action, the text on it and its CSS classes. */
export interface ChipView {
  action: Action;
  label: string;
  classes: string;
}

/** One deck's panel. */
export interface DeckPanelView {
  deck: Deck;
  title: string;
  color: string;
  loops: ChipView[];
  stems: ChipView[];
}

/** The effects summary. */
export interface FxView {
  slotLabel: string;
  direction: 'up' | 'down' | 'off';
  amountPercent: number;
  roll: boolean;
  release: boolean;
  bypass: boolean;
}

/** Everything the page needs to draw one frame. */
export interface DisplayView {
  layout: DisplayLayout;
  status: DisplayStatus;
  /** The line shown in place of, or above, the panels; null when live. */
  message: string | null;
  /** A second line telling the user what to do; only while waiting. */
  hint: string | null;
  /** 'DECK' or 'FX'; null while waiting. */
  mode: 'DECK' | 'FX' | null;
  /** The tempo with one decimal, for example '124.0'; null when unknown or while waiting. */
  bpm: string | null;
  /** Deck A then deck B; empty while waiting. */
  decks: DeckPanelView[];
  /** The effects summary; null when the state has none or while waiting. */
  fx: FxView | null;
  /** A warning line; null when there is nothing to warn about. */
  notice: string | null;
}

/** A state older than this many milliseconds is stale. */
export const STALE_AFTER_MS = 3000;
/** Width over height from which the wide layout is used. */
export const WIDE_ASPECT = 3;
/** The message shown before any state arrived. */
export const WAITING_MESSAGE = 'Waiting for Trackstar';
/** The instruction shown before any state arrived. */
export const WAITING_HINT = 'Open the Trackstar app in another tab of this browser.';

/** The warning shown when two copies of the app are open. */
export const CONFLICT_NOTICE = 'Trackstar is open in two tabs. Showing the one that was opened first.';

function layoutFor(width: number, height: number): DisplayLayout {
  const ok = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  return ok && width / height >= WIDE_ASPECT ? 'wide' : 'standard';
}

function chips(actions: readonly Action[], deck: Deck, decks: DeckSnapshot): ChipView[] {
  return actions.map((action) => ({
    action,
    label: CHIP_NAMES[action],
    classes: chipClasses(action, decks[deck][action]),
  }));
}

function fxView(fx: DisplayFxState): FxView {
  const percent = Math.round(Math.abs(fx.amount) * 100);
  return {
    slotLabel: 'FX ' + (fx.slot + 1),
    direction: fx.amount > 0 ? 'up' : fx.amount < 0 ? 'down' : 'off',
    amountPercent: Math.min(100, Math.max(0, percent)),
    roll: fx.rollActive,
    release: fx.releaseActive,
    bypass: fx.bypass,
  };
}

/** Turns the last received state, the current time and the screen size into what the page shows. `conflict` adds the two-tabs notice to a state. */
export function buildView(state: DisplayState | null, now: number, width: number, height: number, conflict = false): DisplayView {
  const layout = layoutFor(width, height);
  if (state === null) {
    return {
      layout,
      status: 'waiting',
      message: WAITING_MESSAGE,
      hint: WAITING_HINT,
      mode: null,
      bpm: null,
      decks: [],
      fx: null,
      notice: null,
    };
  }
  let age = now - state.t;
  if (!Number.isFinite(age) || age < 0) age = 0;
  const stale = age > STALE_AFTER_MS;
  return {
    layout,
    status: stale ? 'stale' : 'live',
    message: stale ? 'Trackstar stopped sending ' + Math.floor(age / 1000) + ' s ago' : null,
    hint: null,
    mode: state.mode === 'fx' ? 'FX' : 'DECK',
    bpm: typeof state.bpm === 'number' ? state.bpm.toFixed(1) : null,
    decks: DECKS.map((deck) => ({
      deck,
      title: 'DECK ' + deck,
      color: DECK_COLOR[deck],
      loops: chips(LOOP_ACTIONS, deck, state.decks),
      stems: chips(STEM_ACTIONS, deck, state.decks),
    })),
    fx: state.fx === null ? null : fxView(state.fx),
    notice: conflict ? CONFLICT_NOTICE : null,
  };
}

/** The local time as HH:MM, 24-hour, or '--:--' for an invalid date. */
export function formatClock(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  if (Number.isNaN(h) || Number.isNaN(m)) return '--:--';
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
