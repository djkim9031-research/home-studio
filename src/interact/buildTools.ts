import { DEFAULT_DOOR, DEFAULT_STAIR, DEFAULT_WALL_H, DEFAULT_WALL_T, DEFAULT_WINDOW, SNAP } from '../constants';
import { formatFeetInchesFull } from '../core/format';
import { fillRegion } from '../core/regionFill';
import { clampOpeningCenter, openingFits, projectOnWall, wallLen } from '../core/validity';
import * as store from '../state/store';
import type { FloorIndex, PlacedElement, Vec2, Wall } from '../types';

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
  pickWall(ev: PointerEvent): { wallId: string; point: Vec2 } | null;
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
    store.placeElement({
      kind: 'slab',
      floor: s.activeFloor,
      polygon: res.polygon,
      textureId: this.arm.textureId,
      color: this.arm.color,
    } as Omit<PlacedElement, 'id'>);
    this.ctx.toast('Floor placed.');
  }

  onHover(): void {}

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
