import { describe, expect, it } from 'vitest';
import { computeClutchThresholds } from '../src/config/calibration';

const around = (center: number, n = 30, spread = 0.02) =>
  Array.from({ length: n }, (_, i) => center + ((i % 5) - 2) * (spread / 2));

describe('computeClutchThresholds', () => {
  it('puts the thresholds around the midpoint with a band of a quarter of the gap', () => {
    const r = computeClutchThresholds(around(0.2), around(0.6));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.on).toBeCloseTo(0.35, 5);
    expect(r.off).toBeCloseTo(0.45, 5);
  });

  it('uses medians so a few bad frames do not move the result', () => {
    const engaged = [...around(0.2), 0.9, 0.95];
    const r = computeClutchThresholds(engaged, around(0.6));
    expect(r.ok && r.on).toBeCloseTo(0.35, 1);
  });

  it('fails when the two poses are too close to tell apart', () => {
    const r = computeClutchThresholds(around(0.3), around(0.35));
    expect(r).toMatchObject({ ok: false });
  });

  it('fails when the clutch pose reads further away than the relaxed one', () => {
    expect(computeClutchThresholds(around(0.6), around(0.2))).toMatchObject({ ok: false });
  });

  it('fails without enough samples, for example when the hand left the frame', () => {
    expect(computeClutchThresholds(around(0.2, 5), around(0.6))).toMatchObject({ ok: false });
  });
});
