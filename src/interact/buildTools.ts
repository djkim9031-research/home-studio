import { DEFAULT_DOOR, DEFAULT_STAIR, DEFAULT_WALL_H, DEFAULT_WALL_T, DEFAULT_WINDOW, SNAP } from '../constants';
import { formatFeetInchesFull } from '../core/format';
import { pointInPolygon } from '../core/geometry';
import { detectEnclosedRegions, fillRegion } from '../core/regionFill';
import { cutSpans, faceGroupTarget, paintGroupPatches, regroupClearPatches } from '../core/wallGroups';
import { clampOpeningCenter, openingFits, projectOnWall, wallDir, wallLen, wallPointAt } from '../core/validity';
import * as store from '../state/store';
import type { GhostState } from '../state/store';
import { floorBaseIn, type FaceSpan, type FloorIndex, type PlacedElement, type Vec2, type Wall, type WallFace, type WallPatch } from '../types';

/** One adjustable offset in the location finetuner (a slider + a number box). */
export interface FinetuneAxis {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

/** Live result of the finetuner for the current offset values. */
export interface FinetuneResolved {
  ghost: GhostState;
  anchor: { x: number; y: number; z: number };
  element: Omit<PlacedElement, 'id'>;
  valid: boolean;
  invalidMsg?: string;
}

/** A deferred placement: preview with adjustable offsets, confirmed with ✓.
 * Reusable across categories — any tool can hand one of these to the host. */
export interface FinetuneRequest {
  title: string;
  axes: FinetuneAxis[];
  resolve(values: Record<string, number>): FinetuneResolved;
  /** run after the element is committed (e.g. mark it the main entrance) */
  after?(placedId: string): void;
  /** the session ended (confirmed or cancelled) — re-enable the tool */
  onClose?(): void;
}

/** One tool owns the canvas at a time; the router dispatches gestures to it. */
export interface Tool {
  /** true = the tool claims this press (camera stays locked out) */
  onDown(floor: Vec2 | null, ev: PointerEvent): boolean;
  onMove(floor: Vec2 | null, ev: PointerEvent): void;
  onUp(floor: Vec2 | null, ev: PointerEvent): void;
  onHover(floor: Vec2 | null, ev: PointerEvent): void;
  onWheel?(deltaY: number): boolean;
  cancel(): void;
}

export interface ToolContext {
  toast(msg: string): void;
  /** raycast the wall meshes of the active floor; plan-space hit + wall id */
  pickWall(ev: PointerEvent): { wallId: string; point: Vec2; distance: number } | null;
  /** camera distance to the active floor plane under the cursor */
  floorHitDistance(ev: PointerEvent): number | null;
  /** camera position in plan inches */
  cameraPlanePos(): Vec2;
  /** notify that the armed tool finished/cancelled (palette un-highlights) */
  onDisarm(): void;
  /** hand off a deferred placement to the location finetuner */
  beginFinetune(req: FinetuneRequest): void;
}

const grid = (v: number): number => Math.round(v / SNAP.grid) * SNAP.grid;
const gridPt = (p: Vec2): Vec2 => ({ x: grid(p.x), z: grid(p.z) });

/** True when a new segment a→b lies on top of an existing wall: collinear
 * within a couple inches and overlapping most of its own length — the case
 * of two rooms sharing an edge, which should be one wall, not two. */
function wallsCoincide(a: Vec2, b: Vec2, w: Wall): boolean {
  const dnx = b.x - a.x;
  const dnz = b.z - a.z;
  const nLen = Math.hypot(dnx, dnz) || 1;
  const dwx = w.b.x - w.a.x;
  const dwz = w.b.z - w.a.z;
  const wLen = Math.hypot(dwx, dwz) || 1;
  // parallel?
  if (Math.abs((dnx * dwz - dnz * dwx) / (nLen * wLen)) > 0.02) return false;
  const ux = dwx / wLen;
  const uz = dwz / wLen;
  // both new endpoints must sit on the existing wall's line (perp ≤ ~3")
  const perp = (p: Vec2): number => Math.abs((p.x - w.a.x) * -uz + (p.z - w.a.z) * ux);
  if (perp(a) > w.thickIn / 2 + 3 || perp(b) > w.thickIn / 2 + 3) return false;
  // overlap of the two spans projected onto the shared line
  const ta = (a.x - w.a.x) * ux + (a.z - w.a.z) * uz;
  const tb = (b.x - w.a.x) * ux + (b.z - w.a.z) * uz;
  const lo = Math.max(0, Math.min(ta, tb));
  const hi = Math.min(wLen, Math.max(ta, tb));
  return hi - lo >= nLen * 0.5; // most of the new wall overlaps the old
}

function wallsOn(floor: FloorIndex): Wall[] {
  return store.getState().elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === floor);
}

/** A perpendicular nudge that snaps a run's thickness band relative to a nearly
 * parallel existing wall: overlapping bands merge (offset → 0), a band that has
 * pulled most of the way clear snaps fully out (offset → thickness). Never a
 * partial overlap where one wall protrudes over the other. Null = leave it. */
function thicknessSnap(a: Vec2, b: Vec2, walls: Wall[], thick: number): { dx: number; dz: number } | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L;
  const uz = dz / L;
  let best: { dx: number; dz: number } | null = null;
  let bestAbs = Infinity;
  for (const w of walls) {
    const wdx = w.b.x - w.a.x;
    const wdz = w.b.z - w.a.z;
    const wL = Math.hypot(wdx, wdz) || 1;
    const wux = wdx / wL;
    const wuz = wdz / wL;
    if (Math.abs(ux * wuz - uz * wux) > 0.09) continue; // not parallel (~5°)
    const pnx = -wuz; // wall's perpendicular
    const pnz = wux;
    const perp = (((a.x - w.a.x) * pnx + (a.z - w.a.z) * pnz) + ((b.x - w.a.x) * pnx + (b.z - w.a.z) * pnz)) / 2;
    const ad = Math.abs(perp);
    if (ad < 0.3 || ad >= thick - 0.3) continue; // already merged or already clear
    // require a real length overlap so we don't snap to a far-off collinear wall
    const ta = (a.x - w.a.x) * wux + (a.z - w.a.z) * wuz;
    const tb = (b.x - w.a.x) * wux + (b.z - w.a.z) * wuz;
    const ov = Math.min(Math.max(ta, tb), wL) - Math.max(Math.min(ta, tb), 0);
    if (ov < thick) continue;
    const target = ad <= thick / 2 ? 0 : thick;
    const delta = Math.sign(perp || 1) * target - perp;
    if (Math.abs(delta) < bestAbs) {
      bestAbs = Math.abs(delta);
      best = { dx: pnx * delta, dz: pnz * delta };
    }
  }
  return best;
}

/** Snap a straight run or a whole rectangle so its thickness band merges with,
 * or fully clears, a neighbouring parallel wall. */
function magnetThickness(shape: WallShape, ra: Vec2, rb: Vec2, walls: Wall[], thick: number): { a: Vec2; b: Vec2 } {
  if (!walls.length) return { a: ra, b: rb };
  let t: { dx: number; dz: number } | null;
  if (shape === 'rect') {
    const c = [ra, { x: rb.x, z: ra.z }, rb, { x: ra.x, z: rb.z }];
    const edges: [Vec2, Vec2][] = [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
    let best: { dx: number; dz: number } | null = null;
    let bestAbs = Infinity;
    for (const [p, q] of edges) {
      const s = thicknessSnap(p, q, walls, thick);
      if (s) {
        const m = Math.hypot(s.dx, s.dz);
        if (m < bestAbs) {
          bestAbs = m;
          best = s;
        }
      }
    }
    t = best;
  } else {
    t = thicknessSnap(ra, rb, walls, thick);
  }
  if (!t) return { a: ra, b: rb };
  return { a: { x: ra.x + t.dx, z: ra.z + t.dz }, b: { x: rb.x + t.dx, z: rb.z + t.dz } };
}

/** Magnet to existing wall endpoints on the active floor. */
function weld(p: Vec2, floor: FloorIndex, extra?: Vec2 | null): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = SNAP.weld;
  const consider = (q: Vec2, bias = 0): void => {
    const d = Math.hypot(q.x - p.x, q.z - p.z) + bias;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  };
  for (const w of wallsOn(floor)) {
    // endpoints win first (corner welds); then the nearest point on the run so a
    // new wall drawn near an existing one magnets flush onto it (a T-join)
    consider(w.a);
    consider(w.b);
    const dx = w.b.x - w.a.x;
    const dz = w.b.z - w.a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.z - w.a.z) * dz) / len2));
    consider({ x: w.a.x + dx * t, z: w.a.z + dz * t }, 1.5); // slight bias: endpoints preferred
  }
  if (extra) consider(extra);
  return best;
}

// ---------------------------------------------------------------------------
// Wall drawing: drag A→B, chained; endpoint weld > angle snap > grid.
// ---------------------------------------------------------------------------

export type WallShape = 'line' | 'rect';

export type RectAnchor = 'tl' | 'tr' | 'bl' | 'br' | 'center';

export interface WallArm {
  shape: WallShape;
  heightIn: number;
  thickIn: number;
  color: string;
  textureId: string;
  rectLenIn: number;
  rectWidIn: number;
  rectAnchor: RectAnchor;
  /** rectangle rooms can finish their inside and outside faces separately */
  rectInside?: { textureId: string; color: string };
  rectOutside?: { textureId: string; color: string };
}

export class WallTool implements Tool {
  private arm: WallArm;
  private ctx: ToolContext;
  private a: Vec2 | null = null;
  private lastB: Vec2 | null = null;

  constructor(arm: Partial<WallArm>, ctx: ToolContext) {
    this.arm = {
      shape: arm.shape ?? 'line',
      heightIn: arm.heightIn ?? DEFAULT_WALL_H,
      thickIn: arm.thickIn ?? DEFAULT_WALL_T,
      color: arm.color ?? '#f2eee6',
      textureId: arm.textureId ?? 'paint',
      rectLenIn: arm.rectLenIn ?? 144,
      rectWidIn: arm.rectWidIn ?? 120,
      rectAnchor: arm.rectAnchor ?? 'tl',
      rectInside: arm.rectInside,
      rectOutside: arm.rectOutside,
    };
    this.ctx = ctx;
  }

  /** The two opposite corners of the L×W room when the click sits at the
   * chosen anchor corner (or its center). */
  private rectCorners(click: Vec2): { a: Vec2; b: Vec2 } {
    const L = this.arm.rectLenIn;
    const W = this.arm.rectWidIn;
    switch (this.arm.rectAnchor) {
      case 'tr':
        return { a: { x: click.x - L, z: click.z }, b: { x: click.x, z: click.z + W } };
      case 'bl':
        return { a: { x: click.x, z: click.z - W }, b: { x: click.x + L, z: click.z } };
      case 'br':
        return { a: { x: click.x - L, z: click.z - W }, b: click };
      case 'center':
        return { a: { x: click.x - L / 2, z: click.z - W / 2 }, b: { x: click.x + L / 2, z: click.z + W / 2 } };
      default: // tl
        return { a: click, b: { x: click.x + L, z: click.z + W } };
    }
  }

  /** The wall runs the current drag describes, plus a chip label. */
  private runsFor(a: Vec2, b: Vec2): { runs: { a: Vec2; b: Vec2 }[]; label: string; valid: boolean } {
    if (this.arm.shape === 'rect') {
      const w = Math.abs(b.x - a.x);
      const d = Math.abs(b.z - a.z);
      const c0 = { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z) };
      const c1 = { x: c0.x + w, z: c0.z };
      const c2 = { x: c0.x + w, z: c0.z + d };
      const c3 = { x: c0.x, z: c0.z + d };
      return {
        runs: [
          { a: c0, b: c1 },
          { a: c1, b: c2 },
          { a: c2, b: c3 },
          { a: c3, b: c0 },
        ],
        label: `${formatFeetInchesFull(w)} × ${formatFeetInchesFull(d)}`,
        valid: w >= 24 && d >= 24,
      };
    }
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { runs: [{ a, b }], label: formatFeetInchesFull(len), valid: len >= 6 };
  }

  private snapA(p: Vec2): Vec2 {
    const floor = store.getState().activeFloor;
    return weld(p, floor, this.lastB) ?? gridPt(p);
  }

  private snapB(p: Vec2): Vec2 {
    const s = store.getState();
    const welded = weld(p, s.activeFloor, null);
    if (welded) return welded;
    if (!this.a) return gridPt(p);
    if (!s.settings.angleSnap) return gridPt(p);
    const dx = p.x - this.a.x;
    const dz = p.z - this.a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return gridPt(p);
    let ang = (Math.atan2(dz, dx) * 180) / Math.PI;
    const step = Math.round(ang / SNAP.angleDeg) * SNAP.angleDeg;
    // 0/45/90 win close to them
    const cardinal = Math.round(ang / 45) * 45;
    ang = Math.abs(ang - cardinal) <= SNAP.rightAngleWinDeg ? cardinal : step;
    const rad = (ang * Math.PI) / 180;
    const L = grid(len);
    return { x: this.a.x + Math.cos(rad) * L, z: this.a.z + Math.sin(rad) * L };
  }

  onDown(floor: Vec2 | null): boolean {
    if (!floor) return false;
    this.a = this.snapA(floor);
    return true;
  }

  onMove(floor: Vec2 | null): void {
    if (!this.a || !floor) return;
    let ra = this.a;
    let rb: Vec2;
    if (this.arm.shape === 'line') rb = this.snapB(floor);
    else {
      const end = gridPt(floor);
      if (Math.hypot(end.x - this.a.x, end.z - this.a.z) >= 12) rb = end; // dragging a rect
      else ({ a: ra, b: rb } = this.rectCorners(this.a)); // click-place at anchor
    }
    ({ a: ra, b: rb } = magnetThickness(this.arm.shape, ra, rb, wallsOn(store.getState().activeFloor), this.arm.thickIn));
    const { runs, label, valid } = this.runsFor(ra, rb);
    store.setGhost({
      kind: 'wall',
      floor: store.getState().activeFloor,
      runs,
      heightIn: this.arm.heightIn,
      thickIn: this.arm.thickIn,
      valid,
      label,
    });
  }

  onUp(floor: Vec2 | null): void {
    if (!this.a) return;
    const anchor = this.a;
    this.a = null;
    store.setGhost(null);
    if (!floor) return;
    let ra = anchor;
    let rb: Vec2;
    if (this.arm.shape === 'line') rb = this.snapB(floor);
    else {
      const end = gridPt(floor);
      if (Math.hypot(end.x - anchor.x, end.z - anchor.z) >= 12) rb = end;
      else ({ a: ra, b: rb } = this.rectCorners(anchor));
    }
    ({ a: ra, b: rb } = magnetThickness(this.arm.shape, ra, rb, wallsOn(store.getState().activeFloor), this.arm.thickIn));
    const { runs, valid } = this.runsFor(ra, rb);
    if (!valid) return; // a bare click never places
    const b = rb;
    const floorIdx = store.getState().activeFloor;
    // where a new edge lands on an existing wall (rooms placed side by side),
    // reuse the existing wall instead of stacking a second one on top
    const existing = wallsOn(floorIdx);
    const fresh = runs.filter((r) => !existing.some((w) => wallsCoincide(r.a, r.b, w)));
    if (!fresh.length) {
      this.ctx.toast('That room shares its walls with existing ones.');
      if (this.arm.shape === 'line') this.lastB = b;
      return;
    }
    // rectangle rooms may finish inside and outside faces separately: the
    // face toward the room center is the inside one
    const center = this.arm.shape === 'rect' ? { x: (ra.x + rb.x) / 2, z: (ra.z + rb.z) / 2 } : null;
    const faceFor = (r: { a: Vec2; b: Vec2 }): { facePos?: WallFace; faceNeg?: WallFace } => {
      if (!center || (!this.arm.rectInside && !this.arm.rectOutside)) return {};
      const dx = r.b.x - r.a.x;
      const dz = r.b.z - r.a.z;
      const nx = -dz;
      const nz = dx;
      const mid = { x: (r.a.x + r.b.x) / 2, z: (r.a.z + r.b.z) / 2 };
      // facePos renders on the -normal side (the box's yaw-mapped -z face), so
      // the face toward the room centre is faceNeg when the centre is on +normal
      const insideIsPos = (center.x - mid.x) * nx + (center.z - mid.z) * nz >= 0;
      const inside = this.arm.rectInside;
      const outside = this.arm.rectOutside;
      return insideIsPos ? { faceNeg: inside, facePos: outside } : { faceNeg: outside, facePos: inside };
    };
    // where a new run merges onto an existing wall, that overlapping stretch is
    // rebuilt: it loses its paint on both faces and any door/window sitting there
    const mergeUpdates: { id: string; patch: Partial<PlacedElement> }[] = [];
    const droppedOpenings: string[] = [];
    for (const r of runs) {
      for (const w of existing) {
        if (!wallsCoincide(r.a, r.b, w)) continue;
        const d = wallDir(w);
        const wL = wallLen(w);
        const ta = (r.a.x - w.a.x) * d.x + (r.a.z - w.a.z) * d.z;
        const tb = (r.b.x - w.a.x) * d.x + (r.b.z - w.a.z) * d.z;
        const lo = Math.max(0, Math.min(ta, tb));
        const hi = Math.min(wL, Math.max(ta, tb));
        if (hi - lo < 1) continue;
        const patch: Partial<PlacedElement> = {};
        (patch as { facePosSpans?: FaceSpan[] }).facePosSpans = cutSpans(w.facePosSpans, w.facePos, wL, [[lo, hi]]);
        (patch as { faceNegSpans?: FaceSpan[] }).faceNegSpans = cutSpans(w.faceNegSpans, w.faceNeg, wL, [[lo, hi]]);
        // wallpaper patches whose surface run falls in the overlap are dropped too
        if (w.patches?.length) {
          (patch as { patches?: WallPatch[] }).patches = w.patches.filter((p) => !(p.toT > lo && p.fromT < hi));
        }
        mergeUpdates.push({ id: w.id, patch });
        for (const e of existing.length ? store.getState().elements : []) {
          if ((e.kind === 'door' || e.kind === 'window') && e.wallId === w.id && e.centerIn >= lo && e.centerIn <= hi) droppedOpenings.push(e.id);
        }
      }
    }

    const before = store.getState().elements;
    store.placeElementsBatch(
      fresh.map((r) => ({
        kind: 'wall' as const,
        floor: floorIdx,
        a: r.a,
        b: r.b,
        heightIn: this.arm.heightIn,
        thickIn: this.arm.thickIn,
        color: this.arm.color,
        textureId: this.arm.textureId,
        ...faceFor(r),
      })),
    );
    if (mergeUpdates.length) store.updateElementsBatch(mergeUpdates);
    if (droppedOpenings.length) store.deleteElements(droppedOpenings);
    // a new room can turn a wall's exterior face into an interior one; drop the
    // now-stale exterior paint on those stretches so it doesn't linger
    const clears = regroupClearPatches(before, store.getState().elements, floorIdx);
    if (clears.length) {
      store.updateElementsBatch(
        clears.map((pt) => {
          const patch: Partial<PlacedElement> = {};
          if (pt.facePosSpans) (patch as { facePosSpans?: FaceSpan[] }).facePosSpans = pt.facePosSpans;
          if (pt.faceNegSpans) (patch as { faceNegSpans?: FaceSpan[] }).faceNegSpans = pt.faceNegSpans;
          return { id: pt.id, patch };
        }),
      );
    }
    if (this.arm.shape === 'line') this.lastB = b; // chain: next segment starts here
  }

  onHover(floor: Vec2 | null): void {
    if (this.a || !floor) return;
    if (this.arm.shape === 'rect') {
      // preview the L×W room the next click will drop, at the chosen anchor —
      // magnet-snapped so the ghost visibly clings to a wall it would merge with
      const c = this.rectCorners(gridPt(floor));
      const { a: ra, b: rb } = magnetThickness('rect', c.a, c.b, wallsOn(store.getState().activeFloor), this.arm.thickIn);
      const { runs, label, valid } = this.runsFor(ra, rb);
      store.setGhost({
        kind: 'wall',
        floor: store.getState().activeFloor,
        runs,
        heightIn: this.arm.heightIn,
        thickIn: this.arm.thickIn,
        valid,
        label,
      });
      return;
    }
    // straight: hint where the run would start
    const p = this.snapA(floor);
    store.setGhost({
      kind: 'wall',
      floor: store.getState().activeFloor,
      runs: [{ a: p, b: { x: p.x + 0.1, z: p.z } }],
      heightIn: this.arm.heightIn,
      thickIn: this.arm.thickIn,
      valid: true,
      label: '',
    });
  }

  cancel(): void {
    this.a = null;
    this.lastB = null;
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Door / window placement on a wall.
// ---------------------------------------------------------------------------

export interface OpeningArm {
  door: boolean;
  widthIn: number;
  heightIn: number;
  sillIn: number;
  styleId: string;
  color: string;
  mainEntrance?: boolean;
}

export class OpeningTool implements Tool {
  private arm: OpeningArm;
  private ctx: ToolContext;
  private hover: { wallId: string; centerIn: number; valid: boolean } | null = null;
  private downAt: { x: number; y: number } | null = null;
  private suspended = false; // true while the finetuner owns the placement

  constructor(arm: Partial<OpeningArm> & { door: boolean }, ctx: ToolContext) {
    const d = arm.door ? DEFAULT_DOOR : DEFAULT_WINDOW;
    this.arm = {
      door: arm.door,
      widthIn: arm.widthIn ?? d.w,
      heightIn: arm.heightIn ?? d.h,
      sillIn: arm.sillIn ?? (arm.door ? 0 : DEFAULT_WINDOW.sill),
      styleId: arm.styleId ?? (arm.door ? 'panel' : 'singleHung'),
      color: arm.color ?? '#f5f2ea',
      mainEntrance: arm.mainEntrance,
    };
    this.ctx = ctx;
  }

  private track(ev: PointerEvent): void {
    const hit = this.ctx.pickWall(ev);
    if (!hit) {
      this.hover = null;
      store.setGhost(null);
      return;
    }
    const s = store.getState();
    const wall = s.elements.find((e): e is Wall => e.kind === 'wall' && e.id === hit.wallId);
    if (!wall) return;
    const { t } = projectOnWall(wall, hit.point);
    const centerIn = clampOpeningCenter(wall, this.arm.widthIn, grid(t));
    const valid = openingFits(wall, s.elements, centerIn, this.arm.widthIn, this.arm.heightIn, this.arm.sillIn);
    this.hover = { wallId: wall.id, centerIn, valid };
    store.setGhost({
      kind: 'opening',
      wallId: wall.id,
      centerIn,
      widthIn: this.arm.widthIn,
      heightIn: this.arm.heightIn,
      sillIn: this.arm.sillIn,
      door: this.arm.door,
      valid,
    });
  }

  onDown(_floor: Vec2 | null, ev: PointerEvent): boolean {
    if (this.suspended) return false;
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.track(ev);
    return this.hover !== null;
  }

  onMove(_floor: Vec2 | null, ev: PointerEvent): void {
    if (this.suspended) return;
    this.track(ev);
  }

  onUp(_floor: Vec2 | null, ev: PointerEvent): void {
    if (this.suspended) return;
    const down = this.downAt;
    this.downAt = null;
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    this.track(ev);
    const hover = this.hover;
    if (!hover?.valid) {
      if (hover) this.ctx.toast("It doesn't fit there — try another spot on the wall.");
      return;
    }
    const s = store.getState();
    const wall = s.elements.find((e): e is Wall => e.kind === 'wall' && e.id === hover.wallId);
    if (!wall) return;

    // hand off to the location finetuner instead of placing straight away
    const len = wallLen(wall);
    const width = this.arm.widthIn;
    const height = this.arm.heightIn;
    const door = this.arm.door;
    const baseY = floorBaseIn(s.elements, wall.floor);
    const nearEndA = hover.centerIn <= len / 2; // measure from the closer corner
    const initFromEnd = Math.max(0, Math.min(len - width, (nearEndA ? hover.centerIn : len - hover.centerIn) - width / 2));
    const styleId = this.arm.styleId;
    const color = this.arm.color;
    const armSill = this.arm.sillIn;
    const asMain = door && !!this.arm.mainEntrance;

    const axes: FinetuneAxis[] = [
      { key: 'x', label: 'From nearest corner (in)', min: 0, max: Math.max(0, len - width), step: 1, value: initFromEnd },
    ];
    if (!door) axes.push({ key: 'y', label: 'Height from floor (in)', min: 0, max: Math.max(0, wall.heightIn - height), step: 1, value: armSill });

    this.suspended = true;
    store.setGhost(null);
    this.ctx.beginFinetune({
      title: door ? 'Position door' : 'Position window',
      axes,
      resolve: (v) => {
        const fromEnd = Math.max(0, Math.min(len - width, v.x));
        const centerIn = nearEndA ? fromEnd + width / 2 : len - fromEnd - width / 2;
        const sill = door ? 0 : Math.max(0, Math.min(wall.heightIn - height, v.y ?? armSill));
        const valid = openingFits(wall, store.getState().elements, centerIn, width, height, sill);
        const p = wallPointAt(wall, nearEndA ? fromEnd : len - fromEnd);
        return {
          ghost: { kind: 'opening', wallId: wall.id, centerIn, widthIn: width, heightIn: height, sillIn: sill, door, valid },
          anchor: { x: p.x, y: baseY + sill, z: p.z },
          valid,
          invalidMsg: "It doesn't fit there — nudge it along the wall.",
          element: {
            kind: door ? 'door' : 'window',
            floor: wall.floor,
            wallId: wall.id,
            centerIn,
            widthIn: width,
            heightIn: height,
            sillIn: sill,
            styleId,
            color,
          } as Omit<PlacedElement, 'id'>,
        };
      },
      after: (id) => {
        if (asMain) store.setMainEntrance(id);
      },
      onClose: () => {
        this.suspended = false;
      },
    });
  }

  onHover(_floor: Vec2 | null, ev: PointerEvent): void {
    if (this.suspended) return;
    this.track(ev);
  }

  cancel(): void {
    this.hover = null;
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Stairs: ghost follows the cursor; wheel rotates; click places.
// ---------------------------------------------------------------------------

export interface StairArm {
  widthIn: number;
  runIn: number;
  flights: 1 | 2;
  styleId: string;
  textureId: string;
  color: string;
}

export class StairTool implements Tool {
  private arm: StairArm;
  private ctx: ToolContext;
  private yawDeg = 0;
  private at: Vec2 | null = null;
  private downAt: { x: number; y: number } | null = null;
  private suspended = false;

  constructor(arm: Partial<StairArm>, ctx: ToolContext) {
    this.arm = {
      widthIn: arm.widthIn ?? DEFAULT_STAIR.w,
      runIn: arm.runIn ?? DEFAULT_STAIR.run,
      flights: arm.flights ?? 1,
      styleId: arm.styleId ?? 'openStraight',
      textureId: arm.textureId ?? 'oakPlank',
      color: arm.color ?? '#ffffff',
    };
    this.ctx = ctx;
  }

  private show(floor: Vec2 | null): void {
    if (!floor) {
      store.setGhost(null);
      this.at = null;
      return;
    }
    const s = store.getState();
    this.at = gridPt(floor);
    if (s.activeFloor === 2) {
      // top floor: no upstairs to reach
      store.setGhost({ kind: 'stair', floor: s.activeFloor, x: this.at.x, z: this.at.z, yawDeg: this.yawDeg, widthIn: this.arm.widthIn, runIn: this.arm.runIn, flights: this.arm.flights, valid: false });
      return;
    }
    store.setGhost({
      kind: 'stair',
      floor: s.activeFloor,
      x: this.at.x,
      z: this.at.z,
      yawDeg: this.yawDeg,
      widthIn: this.arm.widthIn,
      runIn: this.arm.runIn,
      flights: this.arm.flights,
      valid: true,
    });
  }

  onDown(floor: Vec2 | null, ev: PointerEvent): boolean {
    if (this.suspended) return false;
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.show(floor);
    return floor !== null;
  }

  onMove(floor: Vec2 | null): void {
    if (this.suspended) return;
    this.show(floor);
  }

  onUp(floor: Vec2 | null, ev: PointerEvent): void {
    if (this.suspended) return;
    const down = this.downAt;
    this.downAt = null;
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    this.show(floor);
    const s = store.getState();
    if (!this.at) return;
    if (s.activeFloor === 2) {
      this.ctx.toast('The top floor has no upstairs — stairs go on a lower floor.');
      return;
    }

    // anchor at the nearest corner of this floor's wall footprint; offsets are
    // the stair's distance from that corner along each axis
    const walls = s.elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === s.activeFloor);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const w of walls) {
      minX = Math.min(minX, w.a.x, w.b.x);
      maxX = Math.max(maxX, w.a.x, w.b.x);
      minZ = Math.min(minZ, w.a.z, w.b.z);
      maxZ = Math.max(maxZ, w.a.z, w.b.z);
    }
    if (!walls.length) {
      minX = maxX = minZ = maxZ = 0;
    }
    const corners = [
      { x: minX, z: minZ },
      { x: maxX, z: minZ },
      { x: minX, z: maxZ },
      { x: maxX, z: maxZ },
    ];
    const click = this.at;
    const corner = corners.reduce((best, c) => (Math.hypot(c.x - click.x, c.z - click.z) < Math.hypot(best.x - click.x, best.z - click.z) ? c : best), corners[0]);
    const signX = click.x >= corner.x ? 1 : -1;
    const signZ = click.z >= corner.z ? 1 : -1;
    const baseY = floorBaseIn(s.elements, s.activeFloor);
    const yaw = this.yawDeg;
    const { widthIn, runIn, flights, styleId, textureId, color } = this.arm;
    const floorIdx = s.activeFloor;

    this.suspended = true;
    store.setGhost(null);
    this.ctx.beginFinetune({
      title: 'Position stairs',
      axes: [
        { key: 'x', label: 'From corner · X (in)', min: 0, max: 1200, step: 1, value: Math.round(Math.abs(click.x - corner.x)) },
        { key: 'y', label: 'From corner · Z (in)', min: 0, max: 1200, step: 1, value: Math.round(Math.abs(click.z - corner.z)) },
      ],
      resolve: (v) => {
        const x = corner.x + signX * v.x;
        const z = corner.z + signZ * v.y;
        return {
          ghost: { kind: 'stair', floor: floorIdx, x, z, yawDeg: yaw, widthIn, runIn, flights, valid: true },
          anchor: { x: corner.x, y: baseY, z: corner.z },
          valid: true,
          element: {
            kind: 'stair',
            floor: floorIdx,
            x,
            z,
            yawDeg: yaw,
            widthIn,
            runIn,
            flights,
            styleId,
            textureId,
            color,
          } as Omit<PlacedElement, 'id'>,
        };
      },
      onClose: () => {
        this.suspended = false;
      },
    });
  }

  onHover(floor: Vec2 | null): void {
    if (this.suspended) return;
    this.show(floor);
  }

  onWheel(deltaY: number): boolean {
    this.yawDeg = (this.yawDeg + (deltaY > 0 ? 15 : -15) + 360) % 360;
    if (this.at) this.show(this.at);
    return true;
  }

  cancel(): void {
    this.at = null;
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Flooring fill: click inside an enclosed area.
// ---------------------------------------------------------------------------

export interface FillArm {
  textureId: string;
  color: string;
}

export class FloorFillTool implements Tool {
  private arm: FillArm;
  private ctx: ToolContext;
  private downAt: { x: number; y: number } | null = null;

  constructor(arm: Partial<FillArm>, ctx: ToolContext) {
    this.arm = { textureId: arm.textureId ?? 'oakPlank', color: arm.color ?? '#ffffff' };
    this.ctx = ctx;
  }

  onDown(_floor: Vec2 | null, ev: PointerEvent): boolean {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    return true;
  }

  onMove(): void {}

  onUp(floor: Vec2 | null, ev: PointerEvent): void {
    const down = this.downAt;
    this.downAt = null;
    if (!floor || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    const s = store.getState();
    const res = fillRegion(s.elements, s.activeFloor, floor);
    if (!res.ok) {
      this.ctx.toast(
        res.reason === 'no-walls'
          ? 'Draw some walls first — flooring fills a walled-in area.'
          : "That area isn't enclosed by walls yet.",
      );
      return;
    }
    // a new floor over an already-floored area replaces the old slab
    const centroid = polyCentroid(res.polygon);
    const replaced = store.placeReplacing(
      {
        kind: 'slab',
        floor: s.activeFloor,
        polygon: res.polygon,
        textureId: this.arm.textureId,
        color: this.arm.color,
      } as Omit<PlacedElement, 'id'>,
      (e) =>
        e.kind === 'slab' &&
        e.floor === s.activeFloor &&
        (pointInPolygon(centroid, e.polygon) || pointInPolygon(polyCentroid(e.polygon), res.polygon)),
    );
    void replaced;
    this.ctx.toast('Floor placed.');
  }

  onHover(): void {}

  cancel(): void {
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Wallpaper: apply a rectangular patch to a chosen area of a wall face,
// sized W×H and offset (x from the nearest wall edge, y from the floor).
// ---------------------------------------------------------------------------

export interface WallpaperArm {
  textureId: string;
  color: string;
  widthIn: number;
  heightIn: number;
  offXIn: number;
  offYIn: number;
}

function segPointDist(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const ab2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * abx + (pz - a.z) * abz) / ab2));
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t));
}

function polyCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

/** Overwrite existing face spans with new painted ranges (repaint replaces). */
function mergeSpans(
  existing: FaceSpan[] | undefined,
  ranges: [number, number][],
  finish: { textureId: string; color: string },
): FaceSpan[] {
  const out: FaceSpan[] = [];
  // keep the parts of old spans not covered by any new range
  for (const sp of existing ?? []) {
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

/** Walls whose run hugs the region polygon's boundary. */
function wallsBoundingRegion(walls: Wall[], polygon: Vec2[]): Wall[] {
  const near = (px: number, pz: number, tol: number): boolean => {
    for (let i = 0; i < polygon.length; i++) {
      if (segPointDist(px, pz, polygon[i], polygon[(i + 1) % polygon.length]) <= tol) return true;
    }
    return false;
  };
  return walls.filter((w) => {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    const steps = Math.max(2, Math.ceil(len / 12));
    const tol = w.thickIn / 2 + 7;
    let hugged = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (near(w.a.x + (w.b.x - w.a.x) * t, w.a.z + (w.b.z - w.a.z) * t, tol)) hugged += 1;
    }
    return hugged / (steps + 1) > 0.5; // most of the wall lies on the boundary
  });
}

/** Every wall reachable from `seed` through welded ends or T-joins. */
function connectedWalls(walls: Wall[], seedId: string): Wall[] {
  const touching = (a: Wall, b: Wall): boolean => {
    for (const p of [a.a, a.b]) {
      if (Math.hypot(b.a.x - p.x, b.a.z - p.z) <= 6 || Math.hypot(b.b.x - p.x, b.b.z - p.z) <= 6) return true;
      if (segPointDist(p.x, p.z, b.a, b.b) <= b.thickIn / 2 + 2) return true;
    }
    for (const p of [b.a, b.b]) {
      if (segPointDist(p.x, p.z, a.a, a.b) <= a.thickIn / 2 + 2) return true;
    }
    return false;
  };
  const seed = walls.find((w) => w.id === seedId);
  if (!seed) return [];
  const group = new Set<string>([seed.id]);
  const queue = [seed];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const w of walls) {
      if (!group.has(w.id) && touching(cur, w)) {
        group.add(w.id);
        queue.push(w);
      }
    }
  }
  return walls.filter((w) => group.has(w.id));
}

export class WallpaperTool implements Tool {
  private arm: WallpaperArm;
  private ctx: ToolContext;
  private downAt: { x: number; y: number } | null = null;

  constructor(arm: Partial<WallpaperArm>, ctx: ToolContext) {
    this.arm = {
      textureId: arm.textureId ?? 'paint',
      color: arm.color ?? '#f2eee6',
      widthIn: arm.widthIn ?? 48,
      heightIn: arm.heightIn ?? 48,
      offXIn: arm.offXIn ?? 12,
      offYIn: arm.offYIn ?? 24,
    };
    this.ctx = ctx;
  }

  onDown(_floor: Vec2 | null, ev: PointerEvent): boolean {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    return true;
  }

  onMove(): void {}

  onHover(_floor: Vec2 | null, ev: PointerEvent): void {
    const p = this.resolve(ev);
    if (!p) {
      store.setGhost(null);
      return;
    }
    store.setGhost({ kind: 'patch', floor: store.getState().activeFloor, wallId: p.wall.id, face: p.face, fromT: p.fromT, toT: p.toT, y0: p.y0, y1: p.y1, valid: true });
  }

  onUp(_floor: Vec2 | null, ev: PointerEvent): void {
    const down = this.downAt;
    this.downAt = null;
    store.setGhost(null);
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    const p = this.resolve(ev);
    if (!p) {
      this.ctx.toast('Click a wall face to apply the wallpaper patch.');
      return;
    }
    store.updateElement(p.wall.id, {
      patches: [
        ...(p.wall.patches ?? []),
        { face: p.face, fromT: p.fromT, toT: p.toT, y0: p.y0, y1: p.y1, textureId: this.arm.textureId, color: this.arm.color },
      ],
    });
    this.ctx.toast('Wallpaper applied.');
  }

  /** Resolve the clicked wall + face + the patch rectangle (clamped to fit). */
  private resolve(ev: PointerEvent): { wall: Wall; face: 'pos' | 'neg'; fromT: number; toT: number; y0: number; y1: number } | null {
    const s = store.getState();
    const hit = this.ctx.pickWall(ev);
    const floorDist = this.ctx.floorHitDistance(ev);
    if (!hit || (floorDist !== null && hit.distance >= floorDist - 0.02)) return null;
    const w = s.elements.find((x): x is Wall => x.kind === 'wall' && x.id === hit.wallId && x.floor === s.activeFloor);
    if (!w) return null;
    const L = wallLen(w);
    const d = wallDir(w);
    const n = { x: -d.z, z: d.x };
    const t = Math.max(0, Math.min(L, projectOnWall(w, hit.point).t));
    const at = wallPointAt(w, t);
    // which face: the hit point's side of the wall plane, camera as fallback
    const perp = (hit.point.x - at.x) * n.x + (hit.point.z - at.z) * n.z;
    let sign: 1 | -1;
    if (Math.abs(perp) > 1) sign = perp >= 0 ? 1 : -1;
    else {
      const cam = this.ctx.cameraPlanePos();
      sign = (cam.x - at.x) * n.x + (cam.z - at.z) * n.z >= 0 ? 1 : -1;
    }
    const face: 'pos' | 'neg' = sign >= 0 ? 'pos' : 'neg';
    // horizontal: offset from the wall end nearest the click, patch extends inward
    const width = Math.min(this.arm.widthIn, L);
    let fromT: number;
    if (t < L / 2) fromT = this.arm.offXIn;
    else fromT = L - this.arm.offXIn - width;
    fromT = Math.max(0, Math.min(L - width, fromT));
    const toT = fromT + width;
    // vertical: offset up from the floor
    const y0 = Math.max(0, Math.min(w.heightIn - 1, this.arm.offYIn));
    const y1 = Math.min(w.heightIn, y0 + this.arm.heightIn);
    if (toT - fromT < 1 || y1 - y0 < 1) return null;
    return { wall: w, face, fromT, toT, y0, y1 };
  }

  cancel(): void {
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Wall paint: click a wall face to fill its whole interior/exterior group,
// classified live from the current rooms (so joined walls regroup correctly).
// ---------------------------------------------------------------------------

export interface WallPaintArm {
  textureId: string;
  color: string;
}

export class WallPaintTool implements Tool {
  private arm: WallPaintArm;
  private ctx: ToolContext;
  private downAt: { x: number; y: number } | null = null;

  constructor(arm: Partial<WallPaintArm>, ctx: ToolContext) {
    this.arm = { textureId: arm.textureId ?? 'paint', color: arm.color ?? '#e8dfd0' };
    this.ctx = ctx;
  }

  private resolve(ev: PointerEvent): { wall: Wall; plusSide: boolean; t: number } | null {
    const hit = this.ctx.pickWall(ev);
    if (!hit) return null;
    const wall = store.getState().elements.find((e): e is Wall => e.kind === 'wall' && e.id === hit.wallId);
    if (!wall) return null;
    const d = wallDir(wall);
    const relx = hit.point.x - wall.a.x;
    const relz = hit.point.z - wall.a.z;
    const plusSide = relx * -d.z + relz * d.x > 0;
    const t = Math.max(0, Math.min(wallLen(wall), relx * d.x + relz * d.z));
    return { wall, plusSide, t };
  }

  onHover(_floor: Vec2 | null, ev: PointerEvent): void {
    const p = this.resolve(ev);
    if (!p) {
      store.setGhost(null);
      return;
    }
    store.setGhost({ kind: 'patch', floor: store.getState().activeFloor, wallId: p.wall.id, face: p.plusSide ? 'pos' : 'neg', fromT: 0, toT: wallLen(p.wall), y0: 0, y1: p.wall.heightIn, valid: true });
  }

  onDown(_floor: Vec2 | null, ev: PointerEvent): boolean {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    return this.resolve(ev) !== null;
  }

  onMove(_floor: Vec2 | null, ev: PointerEvent): void {
    this.onHover(_floor, ev);
  }

  onUp(_floor: Vec2 | null, ev: PointerEvent): void {
    const down = this.downAt;
    this.downAt = null;
    store.setGhost(null);
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    const p = this.resolve(ev);
    if (!p) {
      this.ctx.toast('Click a wall face to paint its group.');
      return;
    }
    const s = store.getState();
    const target = faceGroupTarget(s.elements, s.activeFloor, p.wall, p.plusSide, p.t);
    const patches = paintGroupPatches(s.elements, s.activeFloor, target, this.arm);
    if (!patches.length) {
      this.ctx.toast('Nothing to paint here.');
      return;
    }
    store.updateElementsBatch(
      patches.map((pt) => {
        const patch: Partial<PlacedElement> = {};
        if (pt.facePosSpans) (patch as { facePosSpans?: FaceSpan[] }).facePosSpans = pt.facePosSpans;
        if (pt.faceNegSpans) (patch as { faceNegSpans?: FaceSpan[] }).faceNegSpans = pt.faceNegSpans;
        return { id: pt.id, patch };
      }),
    );
    this.ctx.toast(target < 0 ? 'Painted the exterior.' : 'Painted the room interior.');
  }

  cancel(): void {
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Room labeling: click inside an enclosed area, name it; sqft comes free.
// ---------------------------------------------------------------------------

export class RoomTool implements Tool {
  private ctx: ToolContext;
  private downAt: { x: number; y: number } | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onDown(_floor: Vec2 | null, ev: PointerEvent): boolean {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    return true;
  }

  onMove(): void {}

  onUp(floor: Vec2 | null, ev: PointerEvent): void {
    const down = this.downAt;
    this.downAt = null;
    if (!floor || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    const s = store.getState();
    const res = fillRegion(s.elements, s.activeFloor, floor);
    if (!res.ok) {
      this.ctx.toast(
        res.reason === 'no-walls'
          ? 'Draw some walls first — rooms live inside walls.'
          : "That area isn't enclosed by walls yet.",
      );
      return;
    }
    // one label per enclosed area — refuse if this area is already named
    const centroid = polyCentroid(res.polygon);
    const existing = s.elements.find(
      (e) =>
        e.kind === 'room' &&
        e.floor === s.activeFloor &&
        (pointInPolygon(centroid, e.polygon) || pointInPolygon(polyCentroid(e.polygon), res.polygon)),
    );
    if (existing && existing.kind === 'room') {
      this.ctx.toast(`Already labeled “${existing.name}” — rename it from the panel on the right.`);
      store.select(existing.id);
      return;
    }
    const count = s.elements.filter((e) => e.kind === 'room').length;
    const name = (prompt('Room name:', `Room ${count + 1}`) ?? '').trim();
    if (!name) return;
    store.placeElement({
      kind: 'room',
      floor: s.activeFloor,
      polygon: res.polygon,
      name,
      color: '#b08d57',
    } as Omit<PlacedElement, 'id'>);
    this.ctx.toast(`“${name}” labeled.`);
  }

  onHover(): void {}

  cancel(): void {
    store.setGhost(null);
  }
}

// ---------------------------------------------------------------------------
// Select (default tool): click to select; drag moves stairs only.
// ---------------------------------------------------------------------------

export class SelectTool implements Tool {
  private ctx: ToolContext & { pickElement(ev: PointerEvent): string | null };
  private dragging: { id: string; start: Vec2; orig: PlacedElement[] } | null = null;
  private moved = false;

  constructor(ctx: ToolContext & { pickElement(ev: PointerEvent): string | null }) {
    this.ctx = ctx;
  }

  onDown(floor: Vec2 | null, ev: PointerEvent): boolean {
    const id = this.ctx.pickElement(ev);
    this.moved = false;
    if (!id) return false; // let the camera orbit
    const s = store.getState();
    store.select(id);
    const el = s.elements.find((e) => e.id === id);
    if (el && el.kind === 'stair' && floor) {
      this.dragging = { id, start: { x: floor.x - el.x, z: floor.z - el.z }, orig: structuredClone(s.elements) };
    }
    return true;
  }

  onMove(floor: Vec2 | null): void {
    if (!this.dragging || !floor) return;
    this.moved = true;
    store.updateElementsLive([
      { id: this.dragging.id, patch: { x: grid(floor.x - this.dragging.start.x), z: grid(floor.z - this.dragging.start.z) } },
    ]);
  }

  onUp(): void {
    if (this.dragging && this.moved) store.commitLiveEdit(this.dragging.orig);
    this.dragging = null;
  }

  onHover(): void {}

  onWheel(deltaY: number): boolean {
    const s = store.getState();
    const el = s.elements.find((e) => e.id === s.selectedId);
    if (el && el.kind === 'stair') {
      store.updateElement(el.id, { yawDeg: (el.yawDeg + (deltaY > 0 ? 15 : -15) + 360) % 360 });
      return true;
    }
    return false;
  }

  cancel(): void {
    this.dragging = null;
    store.select(null);
  }
}
