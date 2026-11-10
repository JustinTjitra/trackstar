import { ACTIONS, DECKS, type Action, type Deck } from '../types';

/**
 * What the UI knows about one control. `value` means the rekordbox function is
 * engaged: a loop is active, or a stem is muted. `null` means not reported yet.
 */
export interface ControlView {
  value: boolean | null;
  pending: boolean;
  unconfirmed: boolean;
  blind: boolean;
}

export type DeckSnapshot = Record<Deck, Record<Action, ControlView>>;

interface Control extends ControlView {
  sentAt: number;
}

export interface DeckStoreOptions {
  now: () => number;
  /** How long to wait for rekordbox before flagging a control as unconfirmed. */
  confirmMs: number;
}

/**
 * Source of truth for deck state. Values only change from rekordbox feedback,
 * except for controls marked blind, which flip optimistically.
 */
export class DeckStore {
  private readonly opts: DeckStoreOptions;
  private readonly controls: Record<Deck, Record<Action, Control>>;
  private readonly blind = new Set<Action>();
  private readonly listeners = new Set<() => void>();

  constructor(opts: DeckStoreOptions) {
    this.opts = opts;
    const make = () =>
      Object.fromEntries(
        ACTIONS.map((a) => [a, { value: null, pending: false, unconfirmed: false, blind: false, sentAt: 0 }]),
      ) as Record<Action, Control>;
    this.controls = { A: make(), B: make() };
  }

  setBlind(action: Action, blind: boolean): void {
    if (blind) this.blind.add(action);
    else this.blind.delete(action);
    for (const deck of DECKS) {
      const c = this.controls[deck][action];
      c.blind = blind;
      if (blind) {
        c.pending = false;
        c.unconfirmed = false;
      }
    }
    this.emit();
  }

  sent(deck: Deck, action: Action): void {
    const c = this.controls[deck][action];
    if (c.blind) {
      c.value = !c.value;
    } else {
      c.pending = true;
      c.unconfirmed = false;
      c.sentAt = this.opts.now();
    }
    this.emit();
  }

  feedback(deck: Deck, action: Action, on: boolean): void {
    const c = this.controls[deck][action];
    c.value = on;
    c.pending = false;
    c.unconfirmed = false;
    this.emit();
  }

  /** Call regularly (every frame is fine) to time out pending controls. */
  tick(): void {
    const now = this.opts.now();
    let changed = false;
    for (const deck of DECKS) {
      for (const action of ACTIONS) {
        const c = this.controls[deck][action];
        if (c.pending && now - c.sentAt >= this.opts.confirmMs) {
          c.pending = false;
          c.unconfirmed = true;
          changed = true;
        }
      }
    }
    if (changed) this.emit();
  }

  get(deck: Deck, action: Action): ControlView {
    const { value, pending, unconfirmed, blind } = this.controls[deck][action];
    return { value, pending, unconfirmed, blind };
  }

  snapshot(): DeckSnapshot {
    const deck = (d: Deck) =>
      Object.fromEntries(ACTIONS.map((a) => [a, this.get(d, a)])) as Record<Action, ControlView>;
    return { A: deck('A'), B: deck('B') };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
