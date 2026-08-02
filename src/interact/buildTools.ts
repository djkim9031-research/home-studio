import { DEFAULT_DOOR, DEFAULT_STAIR, DEFAULT_WALL_H, DEFAULT_WALL_T, DEFAULT_WINDOW, SNAP } from '../constants';
import { formatFeetInchesFull } from '../core/format';
import { pointInPolygon } from '../core/geometry';
import { detectEnclosedRegions, fillRegion } from '../core/regionFill';
import { clampOpeningCenter, openingFits, projectOnWall, wallDir, wallLen, wallPointAt } from '../core/validity';
import * as store from '../state/store';
import type { FaceSpan, FloorIndex, PlacedElement, Vec2, Wall } from '../types';

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
}

const grid = (v: number): number => Math.round(v / SNAP.grid) * SNAP.grid;
const gridPt = (p: Vec2): Vec2 => ({ x: grid(p.x), z: grid(p.z) });

function wallsOn(floor: FloorIndex): Wall[] {
  return store.getState().elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === floor);
}

/** Magnet to existing wall endpoints on the active floor. */
function weld(p: Vec2, floor: FloorIndex, extra?: Vec2 | null): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = SNAP.weld;
  const consider = (q: Vec2): void => {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  };
  for (const w of wallsOn(floor)) {
    consider(w.a);
    consider(w.b);
  }
  if (extra) consider(extra);
  return best;
}

// ---------------------------------------------------------------------------
// Wall drawing: drag A→B, chained; endpoint weld > angle snap > grid.
// ---------------------------------------------------------------------------

export type WallShape = 'line' | 'rect' | 'circle';

export interface WallArm {
  shape: WallShape;
  heightIn: number;
  thickIn: number;
  color: string;
  textureId: string;
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
    };
    this.ctx = ctx;
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
    if (this.arm.shape === 'circle') {
      const r = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.min(48, Math.max(12, Math.round((2 * Math.PI * r) / 24)));
      const runs: { a: Vec2; b: Vec2 }[] = [];
      const pt = (k: number): Vec2 => ({
        x: Math.round(a.x + Math.cos((k / n) * 2 * Math.PI) * r),
        z: Math.round(a.z + Math.sin((k / n) * 2 * Math.PI) * r),
      });
      for (let k = 0; k < n; k++) runs.push({ a: pt(k), b: pt(k + 1) });
      return { runs, label: `r ${formatFeetInchesFull(r)}`, valid: r >= 24 };
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
    this.a = this.arm.shape === 'circle' ? gridPt(floor) : this.snapA(floor);
    return true;
  }

  onMove(floor: Vec2 | null): void {
    if (!this.a || !floor) return;
    const b = this.arm.shape === 'line' ? this.snapB(floor) : gridPt(floor);
    const { runs, label, valid } = this.runsFor(this.a, b);
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
    const b = floor ? (this.arm.shape === 'line' ? this.snapB(floor) : gridPt(floor)) : null;
    const a = this.a;
    this.a = null;
    store.setGhost(null);
    if (!b) return;
    const { runs, valid } = this.runsFor(a, b);
    if (!valid) return; // a bare click never places
    const floorIdx = store.getState().activeFloor;
    store.placeElementsBatch(
      runs.map((r) => ({
        kind: 'wall' as const,
        floor: floorIdx,
        a: r.a,
        b: r.b,
        heightIn: this.arm.heightIn,
        thickIn: this.arm.thickIn,
        color: this.arm.color,
        textureId: this.arm.textureId,
      })),
    );
    if (this.arm.shape === 'line') this.lastB = b; // chain: next segment starts here
  }

  onHover(floor: Vec2 | null): void {
    if (this.a || !floor) return;
    // idle hint: show where the run would start
    const p = this.arm.shape === 'line' ? this.snapA(floor) : gridPt(floor);
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
}

export class OpeningTool implements Tool {
  private arm: OpeningArm;
  private ctx: ToolContext;
  private hover: { wallId: string; centerIn: number; valid: boolean } | null = null;
  private downAt: { x: number; y: number } | null = null;

  constructor(arm: Partial<OpeningArm> & { door: boolean }, ctx: ToolContext) {
    const d = arm.door ? DEFAULT_DOOR : DEFAULT_WINDOW;
    this.arm = {
      door: arm.door,
      widthIn: arm.widthIn ?? d.w,
      heightIn: arm.heightIn ?? d.h,
      sillIn: arm.sillIn ?? (arm.door ? 0 : DEFAULT_WINDOW.sill),
      styleId: arm.styleId ?? (arm.door ? 'panel' : 'singleHung'),
      color: arm.color ?? '#f5f2ea',
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
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.track(ev);
    return this.hover !== null;
  }

  onMove(_floor: Vec2 | null, ev: PointerEvent): void {
    this.track(ev);
  }

  onUp(_floor: Vec2 | null, ev: PointerEvent): void {
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
    store.placeElement({
      kind: this.arm.door ? 'door' : 'window',
      floor: wall.floor,
      wallId: wall.id,
      centerIn: hover.centerIn,
      widthIn: this.arm.widthIn,
      heightIn: this.arm.heightIn,
      sillIn: this.arm.sillIn,
      styleId: this.arm.styleId,
      color: this.arm.color,
    } as Omit<PlacedElement, 'id'>);
  }

  onHover(_floor: Vec2 | null, ev: PointerEvent): void {
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
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.show(floor);
    return floor !== null;
  }

  onMove(floor: Vec2 | null): void {
    this.show(floor);
  }

  onUp(floor: Vec2 | null, ev: PointerEvent): void {
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
    store.placeElement({
      kind: 'stair',
      floor: s.activeFloor,
      x: this.at.x,
      z: this.at.z,
      yawDeg: this.yawDeg,
      widthIn: this.arm.widthIn,
      runIn: this.arm.runIn,
      flights: this.arm.flights,
      styleId: this.arm.styleId,
      textureId: this.arm.textureId,
      color: this.arm.color,
    } as Omit<PlacedElement, 'id'>);
  }

  onHover(floor: Vec2 | null): void {
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
// Wallpaper: click inside a room to paint its bounding walls; click a wall
// directly to paint every wall continuously connected to it (the exterior
// shell paints as one).
// ---------------------------------------------------------------------------

export interface WallpaperArm {
  textureId: string;
  color: string;
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
    this.arm = { textureId: arm.textureId ?? 'paint', color: arm.color ?? '#f2eee6' };
    this.ctx = ctx;
  }

  onDown(_floor: Vec2 | null, ev: PointerEvent): boolean {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    return true;
  }

  onMove(): void {}

  /** Preview which surface a click would paint: the room polygon when the
   * cursor is over an interior target, nothing over the outside shell. */
  onHover(floor: Vec2 | null, ev: PointerEvent): void {
    const s = store.getState();
    const nPos = (w: Wall): Vec2 => {
      const d = wallDir(w);
      return { x: -d.z, z: d.x };
    };
    const hit = this.ctx.pickWall(ev);
    const floorDist = this.ctx.floorHitDistance(ev);
    let seed: Vec2 | null = floor;
    if (hit && (floorDist === null || hit.distance < floorDist - 0.02)) {
      const w = s.elements.find((x): x is Wall => x.kind === 'wall' && x.id === hit.wallId);
      if (w) {
        const n = nPos(w);
        const proj = projectOnWall(w, hit.point);
        const at = wallPointAt(w, Math.max(0, Math.min(wallLen(w), proj.t)));
        const cam = this.ctx.cameraPlanePos();
        const sign = (cam.x - at.x) * n.x + (cam.z - at.z) * n.z >= 0 ? 1 : -1;
        seed = { x: at.x + n.x * (w.thickIn / 2 + 5) * sign, z: at.z + n.z * (w.thickIn / 2 + 5) * sign };
      }
    }
    const region = seed ? fillRegion(s.elements, s.activeFloor, seed) : ({ ok: false } as const);
    if (region.ok) {
      store.setGhost({ kind: 'region', floor: s.activeFloor, polygon: region.polygon, valid: true });
    } else {
      store.setGhost(null);
    }
  }

  onUp(floor: Vec2 | null, ev: PointerEvent): void {
    const down = this.downAt;
    this.downAt = null;
    store.setGhost(null);
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
    const s = store.getState();
    const walls = wallsOn(s.activeFloor);
    const nPosOf = (w: Wall): Vec2 => {
      const d = wallDir(w);
      return { x: -d.z, z: d.x };
    };

    let targets: Wall[] = [];
    let regionPolygon: Vec2[] | null = null;
    // Clicking a wall face paints THE SIDE YOU CLICKED: if that side faces a
    // room, the whole room papers; if it faces outdoors, the wall's whole
    // connected run paints its outward faces. Clicking open floor inside a
    // room papers that room.
    const hit = this.ctx.pickWall(ev);
    const floorDist = this.ctx.floorHitDistance(ev);
    let clickedRegionSeed: Vec2 | null = floor;
    let exteriorRun = false;
    if (hit && (floorDist === null || hit.distance < floorDist - 0.02)) {
      const w = walls.find((x) => x.id === hit.wallId);
      if (!w) return;
      const n = nPosOf(w);
      const proj = projectOnWall(w, hit.point);
      const at = wallPointAt(w, Math.max(0, Math.min(wallLen(w), proj.t)));
      // the visible face is always on the CAMERA's side of the wall plane
      // (hit-point offsets mislead on top-cap hits)
      const cam = this.ctx.cameraPlanePos();
      const sideSign: 1 | -1 = (cam.x - at.x) * n.x + (cam.z - at.z) * n.z >= 0 ? 1 : -1;
      // a point just off the clicked face
      clickedRegionSeed = {
        x: at.x + n.x * (w.thickIn / 2 + 5) * sideSign,
        z: at.z + n.z * (w.thickIn / 2 + 5) * sideSign,
      };
      const region = fillRegion(s.elements, s.activeFloor, clickedRegionSeed);
      if (region.ok) {
        // the clicked side faces a room — paper every wall bordering it,
        // interior partitions included (the per-length matching filters faces)
        targets = walls;
        regionPolygon = region.polygon;
      } else {
        // exterior face — paint the whole connected shell's outward faces
        targets = connectedWalls(walls, hit.wallId);
        exteriorRun = true;
      }
    } else {
      const region = floor ? fillRegion(s.elements, s.activeFloor, floor) : ({ ok: false } as const);
      if (region.ok) {
        targets = walls;
        regionPolygon = region.polygon;
      } else if (hit) {
        targets = connectedWalls(walls, hit.wallId);
        exteriorRun = true;
      } else {
        this.ctx.toast(
          walls.length
            ? 'Click inside a walled area to paper a room, or click a wall to paint its whole run.'
            : 'Draw some walls first.',
        );
        return;
      }
    }
    void exteriorRun;
    void clickedRegionSeed;
    if (!targets.length) {
      this.ctx.toast('No walls there to paint.');
      return;
    }

    // Paint each wall FACE run by run. Walk the length; a run matches when a
    // point just off that face satisfies the paint context (interior: inside
    // the clicked room; exterior: outside every room). A wall that is partly
    // in and partly out therefore gets two spans, split at the crossing.
    const finish = { textureId: this.arm.textureId, color: this.arm.color };
    const regions = detectEnclosedRegions(s.elements, s.activeFloor);
    const matches = (p: Vec2): boolean =>
      regionPolygon ? pointInPolygon(p, regionPolygon) : !regions.some((r) => pointInPolygon(p, r));
    const faceSampleAt = (w: Wall, towardPos: boolean, t: number): Vec2 => {
      const d = wallDir(w);
      const n = { x: -d.z, z: d.x };
      const sign = towardPos ? 1 : -1;
      const at = wallPointAt(w, t);
      const off = w.thickIn / 2 + 6;
      return { x: at.x + n.x * off * sign, z: at.z + n.z * off * sign };
    };
    const matchingRanges = (w: Wall, towardPos: boolean): [number, number][] => {
      const L = wallLen(w);
      const step = 4; // inches
      const ranges: [number, number][] = [];
      let runStart: number | null = null;
      for (let t = 0; t <= L + 0.001; t += step) {
        const tt = Math.min(t, L);
        const on = matches(faceSampleAt(w, towardPos, tt));
        if (on && runStart === null) runStart = tt;
        else if (!on && runStart !== null) {
          ranges.push([runStart, tt]);
          runStart = null;
        }
      }
      if (runStart !== null) ranges.push([runStart, L]);
      return ranges;
    };

    const updates: { id: string; patch: Partial<PlacedElement> }[] = [];
    for (const w of targets) {
      const patch: Partial<Wall> = {};
      let painted = false;
      for (const towardPos of [true, false]) {
        const ranges = matchingRanges(w, towardPos);
        if (!ranges.length) continue;
        const spans = mergeSpans(towardPos ? w.facePosSpans : w.faceNegSpans, ranges, finish);
        if (towardPos) patch.facePosSpans = spans;
        else patch.faceNegSpans = spans;
        painted = true;
      }
      if (painted) updates.push({ id: w.id, patch: patch as Partial<PlacedElement> });
    }
    if (!updates.length) {
      this.ctx.toast(
        regionPolygon ? 'Nothing to paper there.' : 'Those walls sit between rooms — paper them from inside a room.',
      );
      return;
    }
    const ids = new Set(updates.map((u) => u.id));
    const originals = structuredClone(targets.filter((w) => ids.has(w.id))) as PlacedElement[];
    store.updateElementsLive(updates);
    store.commitLiveEdit(originals);
    this.ctx.toast(`Painted ${updates.length} wall${updates.length > 1 ? 's' : ''}.`);
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
