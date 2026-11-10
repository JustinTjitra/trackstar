import { describe, expect, it, vi } from 'vitest';
import { DeckStore } from '../src/state/deckStore';

function setup() {
  let now = 0;
  const store = new DeckStore({ now: () => now, confirmMs: 300 });
  return { store, advance: (ms: number) => (now += ms) };
}

describe('DeckStore', () => {
  it('starts with every control unknown', () => {
    const { store } = setup();
    expect(store.get('A', 'loop2')).toEqual({ value: null, pending: false, unconfirmed: false, blind: false });
  });

  it('marks a sent control pending until feedback arrives', () => {
    const { store, advance } = setup();
    store.sent('A', 'loop2');
    expect(store.get('A', 'loop2').pending).toBe(true);
    advance(5);
    store.feedback('A', 'loop2', true);
    expect(store.get('A', 'loop2')).toMatchObject({ value: true, pending: false, unconfirmed: false });
  });

  it('flags unconfirmed after the timeout and leaves the value alone', () => {
    const { store, advance } = setup();
    store.feedback('B', 'drums', false);
    store.sent('B', 'drums');
    advance(299);
    store.tick();
    expect(store.get('B', 'drums').pending).toBe(true);
    advance(2);
    store.tick();
    expect(store.get('B', 'drums')).toMatchObject({ value: false, pending: false, unconfirmed: true });
  });

  it('clears unconfirmed when feedback finally arrives', () => {
    const { store, advance } = setup();
    store.sent('A', 'vocals');
    advance(400);
    store.tick();
    store.feedback('A', 'vocals', true);
    expect(store.get('A', 'vocals')).toMatchObject({ value: true, unconfirmed: false, pending: false });
  });

  it('flips blind controls optimistically without going pending', () => {
    const { store, advance } = setup();
    store.setBlind('inst', true);
    store.sent('A', 'inst');
    expect(store.get('A', 'inst')).toEqual({ value: true, pending: false, unconfirmed: false, blind: true });
    store.sent('A', 'inst');
    advance(1000);
    store.tick();
    expect(store.get('A', 'inst')).toEqual({ value: false, pending: false, unconfirmed: false, blind: true });
  });

  it('accepts feedback that was not caused by a gesture, such as an FLX2 press', () => {
    const { store } = setup();
    store.feedback('B', 'loop4', true);
    expect(store.get('B', 'loop4').value).toBe(true);
  });

  it('keeps decks separate', () => {
    const { store } = setup();
    store.feedback('A', 'loop1', true);
    expect(store.get('B', 'loop1').value).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const { store, advance } = setup();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.sent('A', 'loop1');
    advance(400);
    store.tick();
    store.tick(); // nothing changed this time
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    store.feedback('A', 'loop1', true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns snapshots that do not change underneath the caller', () => {
    const { store } = setup();
    const snap = store.snapshot();
    store.feedback('A', 'loop1', true);
    expect(snap.A.loop1.value).toBeNull();
    expect(store.snapshot().A.loop1.value).toBe(true);
  });
});
