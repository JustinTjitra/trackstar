// which app page the deck screen follows when more than one is sending: the id of a source, and the rule

import type { DisplayState } from './bus';

/** How long a followed source may stay quiet before another one is taken over, in milliseconds. Same as the deck screen's stale limit. */
export const SOURCE_STALE_MS = 3000;

/** A fresh id for one app page: a UUID where the browser has one, otherwise time and a random number. */
export function newSourceId(
  cryptoLike?: { randomUUID?: () => string } | null,
  now: () => number = Date.now,
  random: () => number = Math.random,
): string {
  const c = cryptoLike === undefined ? (globalThis.crypto as { randomUUID?: () => string } | undefined) : cryptoLike;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return now().toString(36) + '-' + Math.floor(random() * 0x100000000).toString(36);
}

/** Decides which received messages the deck screen shows when several app pages send at once. Pure: the caller passes the time. */
export class SourceFollower {
  readonly #staleMs: number;
  #src: string | null = null;
  #born = 0;
  #seenAt = 0;
  #otherSeenAt = -Infinity;

  /** A stale limit that is not a finite number or is not above 0 becomes 3000. */
  constructor(staleMs: number = SOURCE_STALE_MS) {
    this.#staleMs = Number.isFinite(staleMs) && staleMs > 0 ? staleMs : SOURCE_STALE_MS;
  }

  /** Offers a received message. True means: show it. False means: it comes from a source that is not being followed. */
  offer(state: DisplayState, now: number): boolean {
    const src = state.src ?? '';
    const born = state.born ?? 0;
    if (this.#src === null) {
      this.#follow(src, born, now);
      return true;
    }
    if (src === this.#src) {
      this.#seenAt = now;
      return true;
    }
    if (now - this.#seenAt > this.#staleMs) {
      this.#follow(src, born, now);
      this.#otherSeenAt = -Infinity;
      return true;
    }
    if (born < this.#born || (born === this.#born && src < this.#src)) {
      this.#otherSeenAt = now;
      this.#follow(src, born, now);
      return true;
    }
    this.#otherSeenAt = now;
    return false;
  }

  /** True while a second source has been heard within the stale limit. */
  conflict(now: number): boolean {
    return now - this.#otherSeenAt <= this.#staleMs;
  }

  /** The id of the source being followed, or null before the first message. */
  get followed(): string | null {
    return this.#src;
  }

  /** Forgets everything. */
  reset(): void {
    this.#src = null;
    this.#born = 0;
    this.#seenAt = 0;
    this.#otherSeenAt = -Infinity;
  }

  #follow(src: string, born: number, now: number): void {
    this.#src = src;
    this.#born = born;
    this.#seenAt = now;
  }
}
