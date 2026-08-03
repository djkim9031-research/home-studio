import type { Opening, PlacedElement, Stair, Vec2, Wall } from '../types';

/** The plan-footprint rectangle a stair occupies (4 world-space corners), padded
 * a little so a stairwell opening clears the treads. A 2-flight U-turn is two
 * lanes wide; a single flight is one. */
export function stairFootprint(st: Stair, pad = 2): Vec2[] {
  const a = -st.yawDeg * (Math.PI / 180);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const halfW = (st.flights === 2 ? st.widthIn + 1 : st.widthIn / 2) + pad;
  const halfD = st.runIn / 2 + pad;
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([lx, lz]) => ({ x: st.x + lx * ca + lz * sa, z: st.z - lx * sa + lz * ca }));
}

export function wallLen(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function growBounds(b: Bounds, pts: Vec2[], pad = 0): void {
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x - pad);
    b.maxX = Math.max(b.maxX, p.x + pad);
    b.minZ = Math.min(b.minZ, p.z - pad);
    b.maxZ = Math.max(b.maxZ, p.z + pad);
  }
}

/** Plan bounds of everything solid on a floor — the footprint the storey above
 * has to sit on. null when the floor is empty. */
export function floorSupportBounds(elements: PlacedElement[], floor: number): Bounds | null {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  let any = false;
  for (const e of elements) {
    if (e.floor !== floor) continue;
    if (e.kind === 'wall') {
      growBounds(b, [e.a, e.b], e.thickIn / 2);
      any = true;
    } else if (e.kind === 'slab') {
      growBounds(b, e.polygon);
      any = true;
    }
  }
  return any ? b : null;
}

/** A wall/floor on an upper storey must sit (mostly) over the storey below: it may
 * overhang the floor-below footprint by at most 20% of that footprint per axis,
 * else it's an unsupported cantilever. Ground and basement rest on grade. */
export function cantileverOk(elements: PlacedElement[], floor: number, pts: Vec2[]): boolean {
  if (floor <= 0) return true;
  const below = floorSupportBounds(elements, floor - 1);
  if (!below) return false; // nothing underneath to carry it
  const mx = (below.maxX - below.minX) * 0.2;
  const mz = (below.maxZ - below.minZ) * 0.2;
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  growBounds(b, pts);
  return b.minX >= below.minX - mx && b.maxX <= below.maxX + mx && b.minZ >= below.minZ - mz && b.maxZ <= below.maxZ + mz;
}

export function wallDir(w: Wall): Vec2 {
  const len = wallLen(w) || 1;
  return { x: (w.b.x - w.a.x) / len, z: (w.b.z - w.a.z) / len };
}

export function wallPointAt(w: Wall, t: number): Vec2 {
  const d = wallDir(w);
  return { x: w.a.x + d.x * t, z: w.a.z + d.z * t };
}

/** Project a plan point onto a wall: distance along from `a` + perpendicular offset. */
export function projectOnWall(w: Wall, p: Vec2): { t: number; d: number } {
  const d = wallDir(w);
  const t = (p.x - w.a.x) * d.x + (p.z - w.a.z) * d.z;
  const perp = Math.abs((p.x - w.a.x) * -d.z + (p.z - w.a.z) * d.x);
  return { t, d: perp };
}

export function openingsOf(elements: PlacedElement[], wallId: string): Opening[] {
  return elements.filter((e): e is Opening => (e.kind === 'door' || e.kind === 'window') && e.wallId === wallId);
}

const CLEAR = 1; // inches between openings / wall ends

/** Can an opening of this size sit at centerIn on the wall? */
export function openingFits(
  wall: Wall,
  elements: PlacedElement[],
  centerIn: number,
  widthIn: number,
  heightIn: number,
  sillIn: number,
  ignoreId?: string,
): boolean {
  const len = wallLen(wall);
  if (centerIn - widthIn / 2 < CLEAR || centerIn + widthIn / 2 > len - CLEAR) return false;
  if (sillIn + heightIn > wall.heightIn) return false;
  for (const o of openingsOf(elements, wall.id)) {
    if (o.id === ignoreId) continue;
    const gap = Math.abs(o.centerIn - centerIn) - (o.widthIn + widthIn) / 2;
    if (gap < CLEAR) return false;
  }
  return true;
}

/** Clamp an opening center so the opening stays inside the wall. */
export function clampOpeningCenter(wall: Wall, widthIn: number, t: number): number {
  const len = wallLen(wall);
  const half = widthIn / 2 + CLEAR;
  if (len <= 2 * half) return len / 2;
  return Math.min(len - half, Math.max(half, t));
}
