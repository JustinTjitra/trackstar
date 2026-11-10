import type { Pose } from '../types';
import type { FingerFlags } from './features';

const POSES: Record<string, Pose> = {
  '0000': 'fist',
  '1000': 'index',
  '1100': 'index_middle',
  '1110': 'index_middle_ring',
  '1111': 'all_four',
  '0001': 'pinky',
  '1001': 'index_pinky',
};

/**
 * Maps finger flags to one of the seven poses the camera can tell apart reliably.
 * Combinations involving the ring finger without the middle are left as 'none':
 * the ring finger is anatomically tied to the middle and reads badly.
 */
export function classify(f: FingerFlags): Pose {
  const key = [f.index, f.middle, f.ring, f.pinky].map((b) => (b ? '1' : '0')).join('');
  return POSES[key] ?? 'none';
}
