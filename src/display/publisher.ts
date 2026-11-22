// decides when the main app sends its state to the deck screen: on a change, not too often, and as a heartbeat when nothing changes

import type { DisplayBus, DisplayState } from './bus';

/** What the app hands over; the publisher adds the version and the time. */
export type DisplayContent = Omit<DisplayState, 'v' | 't'>;

/** The fastest a changed state is sent, in milliseconds (about 15 messages a second at most). */
export const DEFAULT_MIN_INTERVAL_MS = 66;

/** How long without a message before the unchanged state is sent again, in milliseconds. */
export const DEFAULT_HEARTBEAT_MS = 1000;

/**
 * Sends the state to the bus when it changed (at most once per minimum interval) and, when nothing
 * changed, once per heartbeat. It has no timers: it only acts when `update` is called.
 */
export class DisplayPublisher {
  readonly #bus: Pick<DisplayBus, 'publish'>;
  readonly #now: () => number;
  readonly #minIntervalMs: number;
  readonly #heartbeatMs: number;
  #lastKey: string | null = null;
  #lastT = -Infinity;

  /** A minimum interval that is not a finite number or is negative becomes 66; a bad heartbeat becomes 1000. */
  constructor(
    bus: Pick<DisplayBus, 'publish'>,
    now: () => number,
    minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS,
    heartbeatMs: number = DEFAULT_HEARTBEAT_MS,
  ) {
    this.#bus = bus;
    this.#now = now;
    this.#minIntervalMs = Number.isFinite(minIntervalMs) && minIntervalMs >= 0 ? minIntervalMs : DEFAULT_MIN_INTERVAL_MS;
    this.#heartbeatMs = Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : DEFAULT_HEARTBEAT_MS;
  }

  /** Call this often (on every change and on a timer). It publishes only when something should be sent. */
  update(content: DisplayContent): void {
    const t = this.#now();
    const key = JSON.stringify({ mode: content.mode, decks: content.decks, fx: content.fx, bpm: content.bpm });
    const changed = key !== this.#lastKey;
    let elapsed = t - this.#lastT;
    if (elapsed < 0) elapsed = Infinity;
    const due = changed ? elapsed >= this.#minIntervalMs : elapsed >= this.#heartbeatMs;
    if (!due) return;
    this.#bus.publish({ v: 1, t, mode: content.mode, decks: content.decks, fx: content.fx, bpm: content.bpm });
    this.#lastKey = key;
    this.#lastT = t;
  }
}
