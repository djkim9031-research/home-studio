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
  const samples: { t: number; r: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = margin + (span * i) / n;
    samples.push({ t, r: faceRegionAt(wall, plusSide, t, rooms) });
  }
  // adjacent segments ABUT at the midpoint between the differing samples — never
  // leaving an unpainted gap at a region transition; ends snap out to 0/len
  const segs: { region: number; from: number; to: number }[] = [{ region: samples[0].r, from: 0, to: samples[0].t }];
  for (let i = 1; i < samples.length; i++) {
    const cur = segs[segs.length - 1];
    if (samples[i].r !== cur.region) {
      const mid = (samples[i - 1].t + samples[i].t) / 2;
      cur.to = mid;
      segs.push({ region: samples[i].r, from: mid, to: samples[i].t });
    } else cur.to = samples[i].t;
  }
  segs[segs.length - 1].to = len;
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

export function spanFinishAt(spans: FaceSpan[] | undefined, whole: WallFace | undefined, t: number): { textureId: string; color: string } | null {
  if (spans) {
    const sp = spans.find((s) => t >= Math.min(s.from, s.to) - 0.01 && t <= Math.max(s.from, s.to) + 0.01);
    if (sp) return { textureId: sp.textureId, color: sp.color };
    // fall into a small gap between painted spans → use the nearest one
    let best: FaceSpan | null = null;
    let bestD = 14;
    for (const s of spans) {
      const d = t < s.from ? s.from - t : t - s.to;
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? { textureId: best.textureId, color: best.color } : whole ? { textureId: whole.textureId, color: whole.color } : null;
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

/** The finish painted on a region: the building exterior for -1, else the finish
 * on any wall face bordering that room (what the thickness edges facing it wear). */
export function regionFinish(elements: PlacedElement[], floor: number, region: number): { textureId: string; color: string } | null {
  if (region < 0) return buildingExteriorFinish(elements, floor);
  const rooms = roomsFor(elements, floor);
  for (const w of floorWalls(elements, floor)) {
    const len = wallLen(w);
    const n = Math.max(2, Math.ceil(len / SAMPLE_STEP_IN));
    for (let i = 0; i <= n; i++) {
      const t = (len * i) / n;
      if (faceRegionAt(w, true, t, rooms) === region) {
        const f = spanFinishAt(w.faceNegSpans, w.faceNeg, t); // +normal side is faceNeg*
        if (f) return f;
      }
      if (faceRegionAt(w, false, t, rooms) === region) {
        const f = spanFinishAt(w.facePosSpans, w.facePos, t); // -normal side is facePos*
        if (f) return f;
      }
    }
  }
  return null;
}

/** The finish a vertical thickness edge at `p` should wear: whatever region sits
 * just off it — the building exterior outside, or that room's interior finish. */
export function finishFacingPoint(elements: PlacedElement[], floor: number, p: Vec2): { textureId: string; color: string } | null {
  const rooms = roomsFor(elements, floor);
  return regionFinish(elements, floor, regionAt(rooms, p));
}

/** Resolve the finish a single wall face shows at length `t`, EXACTLY as the
 * renderer's `faceAt` does: a covering span wins, else the nearest span within a
 * small gap, else the wall's own base finish. (The legacy whole-face finish is
 * used only when the face has no spans array at all.) Keeping this in lockstep
 * with the renderer is what stops a corner post/cap from disagreeing with the
 * wall surface it continues. */
function resolveFaceFinish(
  spans: FaceSpan[] | undefined,
  whole: WallFace | undefined,
  base: { textureId: string; color: string },
  t: number,
): { textureId: string; color: string } {
  if (spans) {
    const sp = spans.find((s) => t >= Math.min(s.from, s.to) - 0.01 && t <= Math.max(s.from, s.to) + 0.01);
    if (sp) return { textureId: sp.textureId, color: sp.color };
    let best: FaceSpan | null = null;
    let bestD = 14;
    for (const s of spans) {
      const d = t < s.from ? s.from - t : t - s.to;
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? { textureId: best.textureId, color: best.color } : base;
  }
  return whole ? { textureId: whole.textureId, color: whole.color } : base;
}

/** The finish of the wall face that meets `p` and points along (dirx,dirz) — a
 * corner post's side is coplanar with exactly such a face and must continue it.
 * A post side facing a given space must wear the finish of the wall face that
 * actually borders THAT space: among every wall meeting the corner it prefers the
 * one whose (dirx,dirz)-facing side borders the same region the post side faces
 * (so a brick exterior face never bleeds onto a post edge that fronts an interior
 * room, even when an exterior wall runs collinear with the interior one), and
 * among those picks the best-aligned. Returns that neighbour's own rendered
 * finish — never the owning wall's colour. */
export function edgeFinishFacing(
  elements: PlacedElement[],
  floor: number,
  p: Vec2,
  dirx: number,
  dirz: number,
  radius = 6,
): { textureId: string; color: string } | null {
  const walls = floorWalls(elements, floor);
  const rooms = roomsFor(elements, floor);
  const SAMP = 6; // sample a few inches off the corner to read the space each side fronts
  const region = regionAt(rooms, { x: p.x + dirx * SAMP, z: p.z + dirz * SAMP });
  // a post side facing OUTSIDE that is actually a thin gap wedged against another
  // wall just ahead is "blocked", not open exterior: leave it bare rather than let
  // an exterior (e.g. brick) face bleed through the seam between mis-aligned walls.
  if (region < 0) {
    const ahead = { x: p.x + dirx * (radius + 3), z: p.z + dirz * (radius + 3) };
    const capped = walls.some((w) => {
      if (Math.hypot(w.a.x - p.x, w.a.z - p.z) <= radius || Math.hypot(w.b.x - p.x, w.b.z - p.z) <= radius) return false;
      const abx = w.b.x - w.a.x;
      const abz = w.b.z - w.a.z;
      const l2 = abx * abx + abz * abz || 1;
      const u = Math.max(0, Math.min(1, ((ahead.x - w.a.x) * abx + (ahead.z - w.a.z) * abz) / l2));
      return Math.hypot(w.a.x + abx * u - ahead.x, w.a.z + abz * u - ahead.z) <= w.thickIn;
    });
    if (capped) return null;
  }
  let best: { textureId: string; color: string } | null = null;
  let bestScore = 0.7; // must be reasonably coplanar with the post side
  for (const w of walls) {
    const atA = Math.hypot(w.a.x - p.x, w.a.z - p.z) <= radius;
    const atB = Math.hypot(w.b.x - p.x, w.b.z - p.z) <= radius;
    if (!atA && !atB) continue; // this wall doesn't meet the corner
    const d = wallDir(w);
    const nx = -d.z; // +normal
    const nz = d.x;
    const len = wallLen(w);
    const t = atA ? 0 : len;
    // read each face's region a little inside the run, where it's unambiguous
    const tin = atA ? Math.min(SAMP, len / 2) : len - Math.min(SAMP, len / 2);
    const base = { textureId: w.textureId, color: w.color };
    // +normal side of the wall is painted by faceNeg*, -normal side by facePos*.
    // A region match dominates alignment so the coplanar-but-wrong-side face loses.
    const dotPos = nx * dirx + nz * dirz;
    if (dotPos > 0.7) {
      const score = (faceRegionAt(w, true, tin, rooms) === region ? 1000 : 0) + dotPos;
      if (score > bestScore) {
        bestScore = score;
        best = resolveFaceFinish(w.faceNegSpans, w.faceNeg, base, t);
      }
    }
    if (-dotPos > 0.7) {
      const score = (faceRegionAt(w, false, tin, rooms) === region ? 1000 : 0) - dotPos;
      if (score > bestScore) {
        bestScore = score;
        best = resolveFaceFinish(w.facePosSpans, w.facePos, base, t);
      }
    }
  }
  return best;
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

/** Every face span that belongs to `target`'s group — for previewing the whole
 * continuous patch a paint click would cover. `plusSide` = the +normal side. */
export function groupFaces(elements: PlacedElement[], floor: number, target: number): { wallId: string; plusSide: boolean; from: number; to: number }[] {
  const rooms = roomsFor(elements, floor);
  const out: { wallId: string; plusSide: boolean; from: number; to: number }[] = [];
  for (const w of floorWalls(elements, floor)) {
    const len = wallLen(w);
    if (len < 1) continue;
    for (const plusSide of [true, false]) {
      for (const s of faceSegments(w, plusSide, rooms, len)) {
        if (s.region === target && s.to - s.from > 1) out.push({ wallId: w.id, plusSide, from: s.from, to: s.to });
      }
    }
  }
  return out;
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
