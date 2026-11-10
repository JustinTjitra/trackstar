import { describe, expect, it } from 'vitest';
import { classify } from '../src/gestures/classifier';
import type { Pose } from '../src/types';

const NAMED: Record<string, Pose> = {
  '0000': 'fist',
  '1000': 'index',
  '1100': 'index_middle',
  '1110': 'index_middle_ring',
  '1111': 'all_four',
  '0001': 'pinky',
  '1001': 'index_pinky',
};

describe('classify', () => {
  for (let bits = 0; bits < 16; bits++) {
    const key = [8, 4, 2, 1].map((b) => (bits & b ? '1' : '0')).join('');
    const expected = NAMED[key] ?? 'none';
    it(`maps index/middle/ring/pinky ${key} to ${expected}`, () => {
      const [index, middle, ring, pinky] = key.split('').map((c) => c === '1');
      expect(classify({ index, middle, ring, pinky })).toBe(expected);
    });
  }
});
