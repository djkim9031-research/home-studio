import type { Pose, Vec2 } from '../types';

export const DEG = Math.PI / 180;

export interface OBB {
  cx: number;
  cz: number;
  hw: number; // half extent along local x
  hd: number; // half extent along local z
  yawRad: number;
}

export interface ObbEdge {
  /** midpoint */
  m: Vec2;
  /** outward unit normal */
  n: Vec2;
  /** unit tangent (perpendicular to n) */
  t: Vec2;
  /** half length of the edge */
  half: number;
  /** endpoints */
  a: Vec2;
  b: Vec2;
}

export function obbFromPose(pose: Pose, dims: { w: number; d: number }): OBB {
  return { cx: pose.x, cz: pose.z, hw: dims.w / 2, hd: dims.d / 2, yawRad: pose.yawDeg * DEG };
}

/** Rotate a local-space offset into world space. Yaw is about +Y; for our
 * top-down XZ math a positive yaw rotates +X toward -Z (right-handed, y-up). */
export function rot(dx: number, dz: number, yawRad: number): Vec2 {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

/** Inverse of rot(). */
export function unrot(dx: number, dz: number, yawRad: number): Vec2 {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function obbCorners(o: OBB): Vec2[] {
  const out: Vec2[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const r = rot(sx * o.hw, sz * o.hd, o.yawRad);
    out.push({ x: o.cx + r.x, z: o.cz + r.z });
  }
  return out;
}

export function obbEdges(o: OBB): ObbEdge[] {
  const ax = rot(1, 0, o.yawRad); // local +x in world
  const az = rot(0, 1, o.yawRad); // local +z in world
  const c = { x: o.cx, z: o.cz };
  const mk = (n: Vec2, t: Vec2, dist: number, half: number): ObbEdge => {
    const m = { x: c.x + n.x * dist, z: c.z + n.z * dist };
    return {
      m,
      n,
      t,
      half,
      a: { x: m.x - t.x * half, z: m.z - t.z * half },
      b: { x: m.x + t.x * half, z: m.z + t.z * half },
    };
  };
  return [
    mk(ax, az, o.hw, o.hd), // +x face
    mk({ x: -ax.x, z: -ax.z }, az, o.hw, o.hd), // -x face
    mk(az, ax, o.hd, o.hw), // +z face
    mk({ x: -az.x, z: -az.z }, ax, o.hd, o.hw), // -z face
  ];
}

/** Even-odd point-in-polygon (winding-agnostic). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let ii = 0, j = poly.length - 1; ii < poly.length; j = ii++) {
    const a = poly[ii];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when segment ab intersects the OBB (slab clip in the OBB's frame). */
export function segmentIntersectsOBB(a: Vec2, b: Vec2, o: OBB): boolean {
  const la = unrot(a.x - o.cx, a.z - o.cz, o.yawRad);
  const lb = unrot(b.x - o.cx, b.z - o.cz, o.yawRad);
  let t0 = 0;
  let t1 = 1;
  const d = { x: lb.x - la.x, z: lb.z - la.z };
  for (const [p, dd, h] of [
    [la.x, d.x, o.hw],
    [la.z, d.z, o.hd],
  ] as const) {
    if (Math.abs(dd) < 1e-9) {
      if (p < -h || p > h) return false;
    } else {
      let tA = (-h - p) / dd;
      let tB = (h - p) / dd;
      if (tA > tB) [tA, tB] = [tB, tA];
      t0 = Math.max(t0, tA);
      t1 = Math.min(t1, tB);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function projectOntoAxis(corners: Vec2[], axis: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners) {
    const v = c.x * axis.x + c.z * axis.z;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** SAT overlap test. Returns true when the boxes interpenetrate by more than
 * eps on every axis (flush contact with eps > 0 therefore does NOT collide). */
export function obbIntersectsOBB(a: OBB, b: OBB, eps = 0): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [rot(1, 0, a.yawRad), rot(0, 1, a.yawRad), rot(1, 0, b.yawRad), rot(0, 1, b.yawRad)];
  for (const axis of axes) {
    const [a0, a1] = projectOntoAxis(ca, axis);
    const [b0, b1] = projectOntoAxis(cb, axis);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap <= eps) return false;
  }
  return true;
}

export function aabbToOBB(cx: number, cz: number, w: number, d: number): OBB {
  return { cx, cz, hw: w / 2, hd: d / 2, yawRad: 0 };
}

export interface RayHit {
  t: number;
  point: Vec2;
  edgeIndex: number;
}

/** Nearest forward intersection of a ray with the polygon's edges. */
export function raycastPolygon(origin: Vec2, dir: Vec2, poly: Vec2[]): RayHit | null {
  let best: RayHit | null = null;
  for (let ii = 0; ii < poly.length; ii++) {
    const a = poly[ii];
    const b = poly[(ii + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denom = dir.x * ez - dir.z * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const dx = a.x - origin.x;
    const dz = a.z - origin.z;
    const t = (dx * ez - dz * ex) / denom;
    const s = (dir.x * dz - dir.z * dx) / -denom;
    if (t > 1e-6 && s >= 0 && s <= 1) {
      if (!best || t < best.t) {
        best = { t, point: { x: origin.x + dir.x * t, z: origin.z + dir.z * t }, edgeIndex: ii };
      }
    }
  }
  return best;
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Smallest signed angular difference a-b in degrees, in (-180, 180]. */
export function angleDeltaDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function normalizeDeg(a: number): number {
  let d = a % 360;
  if (d < 0) d += 360;
  return d;
}
