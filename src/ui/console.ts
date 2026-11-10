import type { DeckSnapshot } from '../state/deckStore';
import { DECKS, LOOP_ACTIONS, STEM_ACTIONS, type Action, type Deck } from '../types';
import { DECK_COLOR } from './colors';
import { CHIP_NAMES, chipClasses } from './labels';

const TITLES: Partial<Record<string, string>> = {
  unknown: 'Waiting for rekordbox to report this control',
  pending: 'Sent, waiting for rekordbox',
  unconfirmed: 'No reply from rekordbox. Check the MIDI OUT mapping for this control.',
  blind: 'No feedback for this control, so this display is a best guess',
};

/** Renders the two deck panels of the bottom console from a store snapshot. */
export function renderConsole(root: HTMLElement, snap: DeckSnapshot): void {
  if (!root.dataset.built) build(root);
  for (const deck of DECKS) {
    for (const action of [...LOOP_ACTIONS, ...STEM_ACTIONS]) {
      const el = root.querySelector<HTMLElement>(`[data-deck="${deck}"][data-action="${action}"]`);
      if (!el) continue;
      const cls = chipClasses(action, snap[deck][action]);
      if (el.className !== cls) {
        el.className = cls;
        const key = cls.split(' ').find((c) => c in TITLES);
        el.title = key ? TITLES[key]! : '';
      }
    }
  }
}

function build(root: HTMLElement): void {
  root.dataset.built = '1';
  root.innerHTML = DECKS.map(
    (deck) => `
    <div class="deck" style="--c:${DECK_COLOR[deck]}">
      <div class="deck-title"><i></i>DECK ${deck}</div>
      <div class="grp"><span class="grp-label">LOOP</span><div class="row">${chips(deck, LOOP_ACTIONS)}</div></div>
      <div class="grp"><span class="grp-label">STEMS</span><div class="row">${chips(deck, STEM_ACTIONS)}</div></div>
    </div>`,
  ).join('');
}

function chips(deck: Deck, actions: readonly Action[]): string {
  return actions
    .map((a) => `<span class="chip unknown" data-deck="${deck}" data-action="${a}">${CHIP_NAMES[a]}</span>`)
    .join('');
}
