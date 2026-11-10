import type { Vec3 } from '../types';

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function len(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

export function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle at `b` in degrees (180 = a, b, c in a straight line). */
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const denom = len(u) * len(v);
  if (denom === 0) return 180;
  const cos = Math.min(1, Math.max(-1, dot(u, v) / denom));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Distance from point p to the segment a-b. */
export function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  const t = denom === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / denom));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t });
}
