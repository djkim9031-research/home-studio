import { pointInPolygon } from './geometry';
import { detectEnclosedRegions } from './regionFill';
import { wallDir, wallLen } from './validity';
import type { FaceSpan, PlacedElement, Vec2, Wall, WallFace } from '../types';

/**
 * Interior/exterior wall grouping as an internal representation.
 *
 * Each enclosed room is one interior group; everything facing outside is the
 * single exterior group. A wall face belongs to whichever region the space just
 * off it sits in — so when two rooms join, the shared wall is correctly interior
 * on both sides and drops out of the exterior group. Groups are derived live
 * from the current walls, so painting always targets the up-to-date grouping.
 *
 * A group is identified by a target: a room index (0..n-1) or -1 for exterior.
 * Side convention matches the renderer: `facePos*` paints the -normal side,
 * `faceNeg*` the +normal side (normal = (-dz, dx)).
 */

const SAMPLE_STEP_IN = 4; // sample the face every few inches to find its spans

function floorWalls(elements: PlacedElement[], floor: number): Wall[] {
  return elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === floor);
}

function regionAt(rooms: Vec2[][], p: Vec2): number {
  for (let i = 0; i < rooms.length; i++) if (pointInPolygon(p, rooms[i])) return i;
  return -1; // exterior
}

/** The region a wall face borders at length `t` along the wall. */
function faceRegionAt(wall: Wall, plusSide: boolean, t: number, rooms: Vec2[][]): number {
  const d = wallDir(wall);
  const s = plusSide ? 1 : -1;
  const off = wall.thickIn / 2 + 3;
  const nx = -d.z * s;
  const nz = d.x * s;
  return regionAt(rooms, { x: wall.a.x + d.x * t + nx * off, z: wall.a.z + d.z * t + nz * off });
}

/** Room polygons dilate into the wall band, so they briefly overlap at a shared
 * corner; sample only the interior of the run and snap the ends out to the
 * corners, so a face is classified by the room it actually borders, not the
 * ambiguous corner. Returns contiguous (region, from, to) segments. */
function faceSegments(wall: Wall, plusSide: boolean, rooms: Vec2[][], len: number): { region: number; from: number; to: number }[] {
  const margin = Math.min(len * 0.25, wall.thickIn + 2);
  const span = Math.max(0, len - 2 * margin);
  const n = Math.max(1, Math.ceil(span / SAMPLE_STEP_IN));
  const segs: { region: number; from: number; to: number }[] = [];
  let cur: { region: number; from: number; to: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const t = margin + (span * i) / n;
    const r = faceRegionAt(wall, plusSide, t, rooms);
    if (!cur || cur.region !== r) {
      if (cur) segs.push(cur);
      cur = { region: r, from: t, to: t };
    } else cur.to = t;
  }
  if (cur) segs.push(cur);
  if (segs.length) {
    segs[0].from = 0;
    segs[segs.length - 1].to = len; // corners inherit the nearest interior region
  }
  return segs;
}

// memoise the room detection within one mesh rebuild (called once per wall)
let regionMemo: { key: string; rooms: Vec2[][] } | null = null;
function roomsFor(elements: PlacedElement[], floor: number): Vec2[][] {
  const ws = floorWalls(elements, floor);
  let key = `${floor}:${ws.length}`;
  for (const w of ws) key += `|${w.a.x},${w.a.z},${w.b.x},${w.b.z}`;
  if (regionMemo && regionMemo.key === key) return regionMemo.rooms;
  const rooms = detectEnclosedRegions(elements, floor);
  regionMemo = { key, rooms };
  return rooms;
}

/** Which physical side of a wall faces the exterior: 'pos' = the +normal side,
 * 'neg' = the -normal side, or null when both sides are interior (a wall shared
 * between two rooms). Used to decide what finish the thickness edges take. */
export function wallExteriorSide(elements: PlacedElement[], floor: number, wall: Wall): 'pos' | 'neg' | null {
  const rooms = roomsFor(elements, floor);
  const t = wallLen(wall) / 2;
  const posInterior = faceRegionAt(wall, true, t, rooms) >= 0;
  const negInterior = faceRegionAt(wall, false, t, rooms) >= 0;
  if (posInterior && negInterior) return null; // shared wall — no exterior face
  if (posInterior) return 'neg'; // interior on +normal ⇒ exterior on -normal
  return 'pos'; // -normal interior (or freestanding) ⇒ treat +normal as exterior
}

function spanFinishAt(spans: FaceSpan[] | undefined, whole: WallFace | undefined, t: number): { textureId: string; color: string } | null {
  if (spans) {
    const sp = spans.find((s) => t >= Math.min(s.from, s.to) - 0.01 && t <= Math.max(s.from, s.to) + 0.01);
    return sp ? { textureId: sp.textureId, color: sp.color } : null;
  }
  return whole ? { textureId: whole.textureId, color: whole.color } : null;
}

/** The finish covering the exterior face of a representative exterior wall —
 * what the thickness edges of interior divider walls should wear so the outside
 * envelope reads continuously (never an interior colour). */
export function buildingExteriorFinish(elements: PlacedElement[], floor: number): { textureId: string; color: string } | null {
  const rooms = roomsFor(elements, floor);
  for (const w of floorWalls(elements, floor)) {
    const t = wallLen(w) / 2;
    const posInterior = faceRegionAt(w, true, t, rooms) >= 0;
    const negInterior = faceRegionAt(w, false, t, rooms) >= 0;
    if (posInterior && negInterior) continue; // shared wall has no exterior face
    // exterior side: +normal exterior ⇒ faceNeg*, -normal exterior ⇒ facePos*
    const f = posInterior ? spanFinishAt(w.facePosSpans, w.facePos, t) : spanFinishAt(w.faceNegSpans, w.faceNeg, t);
    if (f) return f;
  }
  return null;
}

/** For a wall with no exterior face: 'partition' when the SAME room sits on both
 * sides (a free-standing divider inside one room — its thickness edges are all
 * interior surface), 'divider' when it separates two DIFFERENT rooms (its
 * thickness is part of the building envelope), or null if it has an exterior face. */
export function wallSharedInterior(elements: PlacedElement[], floor: number, wall: Wall): 'partition' | 'divider' | null {
  const rooms = roomsFor(elements, floor);
  const t = wallLen(wall) / 2;
  const rPos = faceRegionAt(wall, true, t, rooms);
  const rNeg = faceRegionAt(wall, false, t, rooms);
  if (rPos === -1 || rNeg === -1) return null; // has an exterior face
  return rPos === rNeg ? 'partition' : 'divider';
}

/** Which group the clicked face belongs to: a room index, or -1 for exterior. */
export function faceGroupTarget(elements: PlacedElement[], floor: number, wall: Wall, plusSide: boolean, tClick: number): number {
  const rooms = detectEnclosedRegions(elements, floor);
  const len = wallLen(wall);
  const margin = Math.min(len * 0.25, wall.thickIn + 2);
  const t = Math.max(margin, Math.min(len - margin, tClick));
  return faceRegionAt(wall, plusSide, t, rooms);
}

/** Overwrite the ranges covered by `ranges` with `finish`, keep the rest. */
function mergeSpans(existing: FaceSpan[] | undefined, whole: WallFace | undefined, len: number, ranges: [number, number][], finish: { textureId: string; color: string }): FaceSpan[] {
  // seed from the whole-face finish so parts outside the painted group keep it
  const base: FaceSpan[] = existing ? [...existing] : whole ? [{ from: 0, to: len, textureId: whole.textureId, color: whole.color }] : [];
  const out: FaceSpan[] = [];
  for (const sp of base) {
    let pieces: [number, number][] = [[sp.from, sp.to]];
    for (const [rf, rt] of ranges) {
      const next: [number, number][] = [];
      for (const [pf, pt] of pieces) {
        if (rt <= pf || rf >= pt) {
          next.push([pf, pt]);
          continue;
        }
        if (rf > pf) next.push([pf, rf]);
        if (rt < pt) next.push([rt, pt]);
      }
      pieces = next;
    }
    for (const [pf, pt] of pieces) if (pt - pf > 1) out.push({ ...sp, from: pf, to: pt });
  }
  for (const [rf, rt] of ranges) if (rt - rf > 1) out.push({ from: rf, to: rt, ...finish });
  return out.sort((a, b) => a.from - b.from);
}

export interface GroupPatch {
  id: string;
  facePosSpans?: FaceSpan[];
  faceNegSpans?: FaceSpan[];
}

/** Remove the finish over `ranges` (revert those stretches to bare wall). */
export function cutSpans(existing: FaceSpan[] | undefined, whole: WallFace | undefined, len: number, ranges: [number, number][]): FaceSpan[] {
  const base: FaceSpan[] = existing ? [...existing] : whole ? [{ from: 0, to: len, textureId: whole.textureId, color: whole.color }] : [];
  const out: FaceSpan[] = [];
  for (const sp of base) {
    let pieces: [number, number][] = [[sp.from, sp.to]];
    for (const [rf, rt] of ranges) {
      const next: [number, number][] = [];
      for (const [pf, pt] of pieces) {
        if (rt <= pf || rf >= pt) {
          next.push([pf, pt]);
          continue;
        }
        if (rf > pf) next.push([pf, rf]);
        if (rt < pt) next.push([rt, pt]);
      }
      pieces = next;
    }
    for (const [pf, pt] of pieces) if (pt - pf > 1) out.push({ ...sp, from: pf, to: pt });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** After a change, drop paint on any face stretch that flipped from exterior to
 * a room interior (its old exterior finish should vanish there). Returns patches
 * for the walls whose finish must be trimmed. */
export function regroupClearPatches(before: PlacedElement[], after: PlacedElement[], floor: number): GroupPatch[] {
  const roomsBefore = detectEnclosedRegions(before, floor);
  const roomsAfter = roomsFor(after, floor);
  const beforeById = new Map(floorWalls(before, floor).map((w) => [w.id, w]));
  const patches: GroupPatch[] = [];
  for (const w of floorWalls(after, floor)) {
    const wb = beforeById.get(w.id);
    if (!wb) continue; // brand-new wall — nothing stale to clear
    const len = wallLen(w);
    if (len < 1) continue;
    const margin = Math.min(len * 0.25, w.thickIn + 2);
    const span = Math.max(0, len - 2 * margin);
    const n = Math.max(1, Math.ceil(span / SAMPLE_STEP_IN));
    const patch: GroupPatch = { id: w.id };
    let touched = false;
    for (const plusSide of [true, false]) {
      const ranges: [number, number][] = [];
      let runStart: number | null = null;
      for (let i = 0; i <= n; i++) {
        const t = margin + (span * i) / n;
        const wasExterior = faceRegionAt(wb, plusSide, t, roomsBefore) === -1;
        const nowInterior = faceRegionAt(w, plusSide, t, roomsAfter) >= 0;
        const flipped = wasExterior && nowInterior;
        if (flipped && runStart === null) runStart = t;
        if (!flipped && runStart !== null) {
          ranges.push([runStart, t]);
          runStart = null;
        }
      }
      if (runStart !== null) ranges.push([runStart, len]);
      if (!ranges.length) continue;
      if (ranges[0][0] <= margin + 0.01) ranges[0][0] = 0;
      if (ranges[ranges.length - 1][1] >= len - margin - 0.01) ranges[ranges.length - 1][1] = len;
      touched = true;
      if (plusSide) patch.faceNegSpans = cutSpans(w.faceNegSpans, w.faceNeg, len, ranges);
      else patch.facePosSpans = cutSpans(w.facePosSpans, w.facePos, len, ranges);
    }
    if (touched) patches.push(patch);
  }
  return patches;
}

/** Span patches that paint every face in `target`'s group with `finish`. */
export function paintGroupPatches(elements: PlacedElement[], floor: number, target: number, finish: { textureId: string; color: string }): GroupPatch[] {
  const rooms = detectEnclosedRegions(elements, floor);
  const patches: GroupPatch[] = [];
  for (const w of floorWalls(elements, floor)) {
    const len = wallLen(w);
    if (len < 1) continue;
    const patch: GroupPatch = { id: w.id };
    let touched = false;
    for (const plusSide of [true, false]) {
      // ranges where this face borders the target group (ends snapped to corners)
      const ranges = faceSegments(w, plusSide, rooms, len)
        .filter((s) => s.region === target)
        .map((s) => [s.from, s.to] as [number, number]);
      if (!ranges.length) continue;
      touched = true;
      // +normal side is faceNeg*, -normal side is facePos* (renderer convention)
      if (plusSide) patch.faceNegSpans = mergeSpans(w.faceNegSpans, w.faceNeg, len, ranges, finish);
      else patch.facePosSpans = mergeSpans(w.facePosSpans, w.facePos, len, ranges, finish);
    }
    if (touched) patches.push(patch);
  }
  return patches;
}
