import type { Opening, PlacedElement, Vec2, Wall } from '../types';

export function wallLen(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
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
