// turns the deck screen's view model into an HTML string; pure, so it is tested without a browser

import type { ChipView, DeckPanelView, DisplayView, FxView } from './view';

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** Escapes text for use in HTML text and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chipHtml(deck: string, chip: ChipView): string {
  return (
    '<span class="' + escapeHtml(chip.classes) + '" data-deck="' + escapeHtml(deck) +
    '" data-action="' + escapeHtml(chip.action) + '">' + escapeHtml(chip.label) + '</span>'
  );
}

function groupHtml(label: string, deck: string, chips: ChipView[]): string {
  return (
    '<div class="d-grp"><span class="d-grp-label">' + label + '</span><div class="d-row">' +
    chips.map((c) => chipHtml(deck, c)).join('') + '</div></div>'
  );
}

function deckHtml(panel: DeckPanelView): string {
  const style = HEX_COLOR.test(panel.color) ? ' style="--c:' + panel.color + '"' : '';
  return (
    '<div class="d-deck" data-deck="' + escapeHtml(panel.deck) + '"' + style + '>' +
    '<div class="d-deck-title"><i></i>' + escapeHtml(panel.title) + '</div>' +
    groupHtml('LOOP', panel.deck, panel.loops) +
    groupHtml('STEMS', panel.deck, panel.stems) +
    '</div>'
  );
}

function flagHtml(label: string, on: boolean): string {
  return '<span class="d-flag' + (on ? ' on' : '') + '">' + label + '</span>';
}

function fxHtml(fx: FxView): string {
  return (
    '<footer class="d-fx"><span class="d-fx-slot">' + escapeHtml(fx.slotLabel) + '</span>' +
    '<span class="d-fx-dir">' + fx.direction.toUpperCase() + '</span>' +
    '<span class="d-fx-amt">' + fx.amountPercent + '%</span>' +
    flagHtml('ROLL', fx.roll) + flagHtml('RELEASE', fx.release) + flagHtml('BYPASS', fx.bypass) +
    '</footer>'
  );
}

/** The inner HTML of the deck screen for one view and a clock text such as '09:05'. */
export function renderHtml(view: DisplayView, clock: string): string {
  let html = '<header class="d-top"><span class="d-brand">TRACKSTAR</span>';
  if (view.mode !== null) html += '<span class="d-mode">' + escapeHtml(view.mode) + '</span>';
  if (view.status !== 'waiting') {
    html += '<span class="d-bpm"><b>' + (view.bpm === null ? '--' : escapeHtml(view.bpm)) + '</b> BPM</span>';
  }
  html += '<span class="d-clock">' + escapeHtml(clock) + '</span></header>';
  if (view.message !== null) html += '<p class="d-message">' + escapeHtml(view.message) + '</p>';
  if (view.hint !== null) html += '<p class="d-hint">' + escapeHtml(view.hint) + '</p>';
  if (view.decks.length > 0) html += '<section class="d-decks">' + view.decks.map(deckHtml).join('') + '</section>';
  if (view.fx !== null) html += fxHtml(view.fx);
  return html;
}

/** The class names for the page's root element: 'd-root d-<layout> d-<status>'. */
export function rootClass(view: DisplayView): string {
  return 'd-root d-' + view.layout + ' d-' + view.status;
}
