import { describe, expect, it } from 'vitest';
import { coverTransform } from '../src/ui/overlay';

describe('coverTransform', () => {
  it('mirrors: the right edge of the camera image lands on the left of the canvas', () => {
    const t = coverTransform(1280, 720, 1280, 720);
    expect(t.toCanvas({ x: 1, y: 0, z: 0 }).x).toBeCloseTo(0);
    expect(t.toCanvas({ x: 0, y: 1, z: 0 })).toEqual({ x: 1280, y: 720 });
  });

  it('keeps the camera centre on the canvas centre when cropping, so the deck split lines up', () => {
    const t = coverTransform(1000, 1000, 1280, 720); // tall window, wide camera: sides cropped
    expect(t.toCanvas({ x: 0.5, y: 0.5, z: 0 })).toEqual({ x: 500, y: 500 });
    expect(t.scale).toBeCloseTo(1000 / 720);
  });
});
