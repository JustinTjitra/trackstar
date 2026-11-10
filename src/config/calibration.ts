export type CalibrationResult = { ok: true; on: number; off: number } | { ok: false; reason: string };

const MIN_SAMPLES = 10;
const MIN_GAP = 0.08;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Picks clutch thresholds from two captures of the clutch ratio: thumb pressed
 * (engaged) and thumb relaxed. The midpoint splits them; a band of a quarter of
 * the gap gives hysteresis so the clutch does not flicker at the boundary.
 */
export function computeClutchThresholds(engaged: number[], relaxed: number[]): CalibrationResult {
  const e = engaged.filter(Number.isFinite);
  const r = relaxed.filter(Number.isFinite);
  if (e.length < MIN_SAMPLES || r.length < MIN_SAMPLES) {
    return { ok: false, reason: 'Keep one hand in view for the whole capture.' };
  }
  const me = median(e);
  const mr = median(r);
  const gap = mr - me;
  if (gap < MIN_GAP) {
    return {
      ok: false,
      reason: 'The two poses looked too similar. Press your thumb firmly against the side of your index knuckle, then move it well away.',
    };
  }
  const mid = (me + mr) / 2;
  const band = gap / 4;
  return { ok: true, on: mid - band / 2, off: mid + band / 2 };
}
