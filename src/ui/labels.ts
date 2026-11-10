import type { ControlView } from '../state/deckStore';
import { STEM_ACTIONS, type Action } from '../types';

const NAMES: Record<Action, string> = {
  loop1: 'LOOP 1',
  loop2: 'LOOP 2',
  loop4: 'LOOP 4',
  drums: 'DRUMS',
  vocals: 'VOCALS',
  inst: 'INST',
};

export const CHIP_NAMES: Record<Action, string> = {
  loop1: '1B',
  loop2: '2B',
  loop4: '4B',
  drums: 'DRUMS',
  vocals: 'VOCALS',
  inst: 'INST',
};

export function isStem(action: Action): boolean {
  return STEM_ACTIONS.includes(action);
}

export function actionLabel(action: Action): string {
  return NAMES[action];
}

/** Text under the ring after a gesture fired. `sent` is false when no MIDI port took the message. */
export function firedLabel(action: Action, view: ControlView, sent: boolean): string {
  if (!sent) return 'NO MIDI';
  if (view.unconfirmed) return 'NO REPLY';
  if (view.pending || view.value === null) return NAMES[action];
  if (isStem(action)) return `${NAMES[action]} ${view.value ? 'MUTED' : 'ON'}`;
  return `${NAMES[action]} ${view.value ? 'ON' : 'OFF'}`;
}

/** CSS classes for a console chip. Stems are lit while audible. */
export function chipClasses(action: Action, view: ControlView): string {
  const cls = ['chip'];
  if (view.pending) cls.push('pending');
  else if (view.unconfirmed) cls.push('unconfirmed');
  else if (view.value === null) cls.push('unknown');
  else if (isStem(action)) cls.push(view.value ? 'muted' : 'on');
  else if (view.value) cls.push('on');
  if (view.blind) cls.push('blind');
  return cls.join(' ');
}
