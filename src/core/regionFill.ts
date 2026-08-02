import type { PlacedElement, Vec2, Wall } from '../types';
import { wallLen } from './validity';

/** Grid resolution for the flood fill, inches per cell. */
const CELL = 3;
const SIMPLIFY_TOL = 2; // inches
/** virtual divider band half-width (open wall ends → dividing line) */
const VIRT_R = CELL * 0.9;
/** how far an open wall end may project its dividing line */
const DIVIDER_MAX = 1200; // inches

export type FillResult = { ok: true; polygon: Vec2[] } | { ok: false; reason: 'open' | 'no-walls' | 'tiny' };

interface Grid {
  blocked: Uint8Array;
  W: number;
  H: number;
  minX: number;
  minZ: number;
}

function floorWalls(elements: PlacedElement[], floor: number): Wall[] {
  return elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === floor && wallLen(e) > 1);
}

function distPointSeg(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const ab2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * abx + (pz - a.z) * abz) / ab2));
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t));
}

/** Wall endpoints not welded to another wall (and not T-joined into one):
 * an open partition end. Each carries the direction the wall points out of. */
function danglingEnds(walls: Wall[]): { p: Vec2; dir: Vec2; thickIn: number }[] {
  const out: { p: Vec2; dir: Vec2; thickIn: number }[] = [];
  for (const w of walls) {
    for (const [p, other] of [
      [w.a, w.b],
      [w.b, w.a],
    ] as [Vec2, Vec2][]) {
      let attached = false;
      for (const o of walls) {
        if (o === w) continue;
        if (Math.hypot(o.a.x - p.x, o.a.z - p.z) <= 6 || Math.hypot(o.b.x - p.x, o.b.z - p.z) <= 6) {
          attached = true;
          break;
        }
        if (distPointSeg(p.x, p.z, o.a, o.b) <= o.thickIn / 2 + 2) {
          attached = true;
          break;
        }
      }
      if (attached) continue;
      const len = Math.hypot(p.x - other.x, p.z - other.z) || 1;
      out.push({ p, dir: { x: (p.x - other.x) / len, z: (p.z - other.z) / len }, thickIn: w.thickIn });
    }
  }
  return out;
}

/** Stamp dividing lines from open wall ends: cast along the wall direction
 * until a real wall is hit; the line becomes a thin virtual barrier. Rays
 * that never land on a wall stamp nothing (a truly open end divides nothing). */
function stampDividers(g: Grid, real: Uint8Array, walls: Wall[]): void {
  const { blocked, W, H, minX, minZ } = g;
  for (const { p, dir, thickIn } of danglingEnds(walls)) {
    const pending: number[] = [];
    let hit = false;
    // the hit test only arms past the source wall's own blocking band (the
    // first probes sit inside it), but stamping starts immediately so a small
    // gap between this end and a nearby wall still seals
    const t0 = thickIn / 2 + CELL * 1.6;
    for (let t = CELL * 0.5; t <= DIVIDER_MAX; t += CELL * 0.5) {
      const px = p.x + dir.x * t;
      const pz = p.z + dir.z * t;
      const gx = Math.floor((px - minX) / CELL);
      const gz = Math.floor((pz - minZ) / CELL);
      if (gx < 0 || gz < 0 || gx >= W || gz >= H) break; // left the build — open
      if (t >= t0 && real[gz * W + gx]) {
        hit = true;
        break;
      }
      // 2×2 stamp so the line blocks the 4-connected flood watertight
      for (const [ox, oz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const nx = Math.floor((px - minX) / CELL - 0.5) + ox;
        const nz = Math.floor((pz - minZ) / CELL - 0.5) + oz;
        if (nx >= 0 && nz >= 0 && nx < W && nz < H) pending.push(nz * W + nx);
      }
    }
    if (hit) for (const i of pending) blocked[i] = 1;
  }
}

/** Occupancy grid over a floor's walls: cells within half a wall's thickness
 * of its centerline are blocked. */
function buildOccupancy(walls: Wall[]): Grid | null {
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
  const margin = CELL * 2;
  minX -= margin;
  minZ -= margin;
  maxX += margin;
  maxZ += margin;
  const W = Math.max(4, Math.ceil((maxX - minX) / CELL));
  const H = Math.max(4, Math.ceil((maxZ - minZ) / CELL));
  if (W * H > 4_000_000) return null; // absurd extent guard

  const blocked = new Uint8Array(W * H);
  for (const w of walls) {
    const r = w.thickIn / 2 + CELL * 0.45;
    const x0 = Math.max(0, Math.floor((Math.min(w.a.x, w.b.x) - r - minX) / CELL));
    const x1 = Math.min(W - 1, Math.ceil((Math.max(w.a.x, w.b.x) + r - minX) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(w.a.z, w.b.z) - r - minZ) / CELL));
    const z1 = Math.min(H - 1, Math.ceil((Math.max(w.a.z, w.b.z) + r - minZ) / CELL));
    const abx = w.b.x - w.a.x;
    const abz = w.b.z - w.a.z;
    const ab2 = abx * abx + abz * abz || 1;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const px = minX + (gx + 0.5) * CELL;
        const pz = minZ + (gz + 0.5) * CELL;
        const t = Math.max(0, Math.min(1, ((px - w.a.x) * abx + (pz - w.a.z) * abz) / ab2));
        const dx = px - (w.a.x + abx * t);
        const dz = pz - (w.a.z + abz * t);
        if (dx * dx + dz * dz <= r * r) blocked[gz * W + gx] = 1;
      }
    }
  }
  return { blocked, W, H, minX, minZ };
}

/** Moore-neighbor boundary trace of a mask, clockwise; simplified inches. */
function traceMask(mask: Uint8Array, g: Grid): Vec2[] | null {
  const { W, H, minX, minZ } = g;
  const at2 = (gx: number, gz: number): number => (gx < 0 || gz < 0 || gx >= W || gz >= H ? 0 : mask[gz * W + gx]);
  let startX = -1;
  let startZ = -1;
  outer: for (let gz = 0; gz < H; gz++) {
    for (let gx = 0; gx < W; gx++) {
      if (at2(gx, gz)) {
        startX = gx;
        startZ = gz;
        break outer;
      }
    }
  }
  if (startX < 0) return null;

  const DIRS = [
    [1, 0], // E
    [1, 1], // SE
    [0, 1], // S
    [-1, 1], // SW
    [-1, 0], // W
    [-1, -1], // NW
    [0, -1], // N
    [1, -1], // NE
  ];
  const contour: Vec2[] = [];
  let cx = startX;
  let cz = startZ;
  // start cell is topmost-leftmost: its W neighbor is empty — treat W as the
  // backtrack direction and scan clockwise from just past it
  let back = 4;
  const maxSteps = W * H * 4;
  for (let step = 0; step < maxSteps; step++) {
    contour.push({ x: minX + (cx + 0.5) * CELL, z: minZ + (cz + 0.5) * CELL });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (back + 1 + k) % 8; // clockwise, starting next to the backtrack
      const nx = cx + DIRS[d][0];
      const nz = cz + DIRS[d][1];
      if (at2(nx, nz)) {
        back = (d + 4) % 8; // the cell we came from, seen from the new cell
        cx = nx;
        cz = nz;
        found = true;
        break;
      }
    }
    if (!found) break; // single-cell region
    if (cx === startX && cz === startZ && contour.length > 2) break;
  }
  if (contour.length < 3) return null;
  const simplified = simplify(contour, SIMPLIFY_TOL);
  return simplified.length >= 3 ? simplified : null;
}

/** Outward offset so region polygons reach the wall CENTERLINE and tuck
 * under the walls with no visible gap. */
function centerlineOffset(walls: Wall[]): number {
  const minThick = Math.min(...walls.map((w) => w.thickIn));
  return minThick / 2 + CELL * 0.95;
}

/**
 * Find the walled-in region around a click point; a flood that escapes to the
 * grid border means the area isn't enclosed.
 */
export function fillRegion(elements: PlacedElement[], floor: number, at: Vec2): FillResult {
  const walls = floorWalls(elements, floor);
  if (!walls.length) return { ok: false, reason: 'no-walls' };
  const g = buildOccupancy(walls);
  if (!g) return { ok: false, reason: 'open' };
  // open partition ends divide the space along their projected line
  const real = g.blocked.slice();
  stampDividers(g, real, walls);
  const { blocked, W, H, minX, minZ } = g;

  const sx = Math.floor((at.x - minX) / CELL);
  const sz = Math.floor((at.z - minZ) / CELL);
  if (sx < 0 || sz < 0 || sx >= W || sz >= H || blocked[sz * W + sx]) return { ok: false, reason: 'open' };

  const filled = new Uint8Array(W * H);
  const queue: number[] = [sz * W + sx];
  filled[queue[0]] = 1;
  let escaped = false;
  while (queue.length) {
    const idx = queue.pop()!;
    const gx = idx % W;
    const gz = (idx - gx) / W;
    if (gx === 0 || gz === 0 || gx === W - 1 || gz === H - 1) {
      escaped = true;
      break;
    }
    for (const [nx, nz] of [
      [gx + 1, gz],
      [gx - 1, gz],
      [gx, gz + 1],
      [gx, gz - 1],
    ]) {
      const ni = nz * W + nx;
      if (!filled[ni] && !blocked[ni]) {
        filled[ni] = 1;
        queue.push(ni);
      }
    }
  }
  if (escaped) return { ok: false, reason: 'open' };

  const outline = traceMask(filled, g);
  if (!outline) return { ok: false, reason: 'tiny' };
  // walls get the tuck-under offset; divider edges just reach their line
  return { ok: true, polygon: offsetPolygonVar(outline, walls, centerlineOffset(walls), VIRT_R + CELL * 0.5) };
}

/** Per-edge outward offset: `dWall` along real walls, `dVirt` along divider
 * lines; vertices land on the intersection of the two offset edges. */
function offsetPolygonVar(poly: Vec2[], walls: Wall[], dWall: number, dVirt: number): Vec2[] {
  const n = poly.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    area2 += p.x * q.z - q.x * p.z;
  }
  const sign = area2 > 0 ? 1 : -1;

  const edgeInfo = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const len = Math.hypot(ex, ez) || 1;
    const nx = (sign * ez) / len;
    const nz = (-sign * ex) / len;
    const mx = (p.x + q.x) / 2;
    const mz = (p.z + q.z) / 2;
    const nearWall = walls.some((w) => distPointSeg(mx, mz, w.a, w.b) <= w.thickIn / 2 + CELL * 2.2);
    const d = nearWall ? dWall : dVirt;
    return { ex: ex / len, ez: ez / len, nx, nz, d };
  });

  const out: Vec2[] = [];
  const maxD = Math.max(dWall, dVirt);
  for (let i = 0; i < n; i++) {
    const e1 = edgeInfo[(i - 1 + n) % n];
    const e2 = edgeInfo[i];
    const cur = poly[i];
    // lines: (cur + n1·d1) + t·e1  and  (cur + n2·d2) + s·e2
    const p1x = cur.x + e1.nx * e1.d;
    const p1z = cur.z + e1.nz * e1.d;
    const p2x = cur.x + e2.nx * e2.d;
    const p2z = cur.z + e2.nz * e2.d;
    const cross = e1.ex * e2.ez - e1.ez * e2.ex;
    let vx: number;
    let vz: number;
    if (Math.abs(cross) < 1e-4) {
      // near-parallel edges — average the two offsets
      vx = cur.x + (e1.nx * e1.d + e2.nx * e2.d) / 2;
      vz = cur.z + (e1.nz * e1.d + e2.nz * e2.d) / 2;
    } else {
      const t = ((p2x - p1x) * e2.ez - (p2z - p1z) * e2.ex) / cross;
      vx = p1x + e1.ex * t;
      vz = p1z + e1.ez * t;
      // miter cap for sharp corners
      const dx = vx - cur.x;
      const dz = vz - cur.z;
      const m = Math.hypot(dx, dz);
      const cap = maxD * 3;
      if (m > cap) {
        vx = cur.x + (dx / m) * cap;
        vz = cur.z + (dz / m) * cap;
      }
    }
    out.push({ x: vx, z: vz });
  }
  return out;
}

/**
 * Every fully-enclosed region on a floor (for automatic ceilings): flood the
 * OUTSIDE from the grid border; unblocked cells the outside never reaches are
 * interior regions. Returns one centerline-offset polygon per region.
 */
export function detectEnclosedRegions(elements: PlacedElement[], floor: number): Vec2[][] {
  const walls = floorWalls(elements, floor);
  if (walls.length < 3) return [];
  const g = buildOccupancy(walls);
  if (!g) return [];
  const { blocked, W, H } = g;

  const visited = new Uint8Array(W * H);
  const queue: number[] = [];
  const pushIf = (gx: number, gz: number): void => {
    if (gx < 0 || gz < 0 || gx >= W || gz >= H) return;
    const i = gz * W + gx;
    if (!visited[i] && !blocked[i]) {
      visited[i] = 1;
      queue.push(i);
    }
  };
  for (let gx = 0; gx < W; gx++) {
    pushIf(gx, 0);
    pushIf(gx, H - 1);
  }
  for (let gz = 0; gz < H; gz++) {
    pushIf(0, gz);
    pushIf(W - 1, gz);
  }
  while (queue.length) {
    const idx = queue.pop()!;
    const gx = idx % W;
    const gz = (idx - gx) / W;
    pushIf(gx + 1, gz);
    pushIf(gx - 1, gz);
    pushIf(gx, gz + 1);
    pushIf(gx, gz - 1);
  }

  const off = centerlineOffset(walls);
  const regions: Vec2[][] = [];
  const MIN_CELLS = 32; // ~2 sqft — ignore slivers between double walls
  for (let start = 0; start < W * H; start++) {
    if (visited[start] || blocked[start]) continue;
    // flood this interior component
    const comp: number[] = [start];
    const mask = new Uint8Array(W * H);
    mask[start] = 1;
    let count = 0;
    while (comp.length) {
      const idx = comp.pop()!;
      count += 1;
      visited[idx] = 1;
      const gx = idx % W;
      const gz = (idx - gx) / W;
      for (const [nx, nz] of [
        [gx + 1, gz],
        [gx - 1, gz],
        [gx, gz + 1],
        [gx, gz - 1],
      ]) {
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (!mask[ni] && !blocked[ni] && !visited[ni]) {
          mask[ni] = 1;
          comp.push(ni);
        }
      }
    }
    if (count < MIN_CELLS) continue;
    const outline = traceMask(mask, g);
    if (outline) regions.push(offsetPolygon(outline, off));
  }
  return regions;
}

/** Douglas-Peucker. */
function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    if (i1 <= i0 + 1) continue;
    const a = pts[i0];
    const b = pts[i1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const ab = Math.hypot(abx, abz) || 1;
    let maxD = -1;
    let maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i].x - a.x) * abz - (pts[i].z - a.z) * abx) / ab;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol) {
      keep[maxI] = 1;
      stack.push([i0, maxI], [maxI, i1]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  // drop the duplicate closing point if present
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.z - l.z) < CELL) out.pop();
  }
  return out;
}

/** Push every vertex outward along its angle bisector by `d` inches. */
function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  // orientation: positive shoelace = CCW in (x, z) math axes
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    area2 += p.x * q.z - q.x * p.z;
  }
  const sign = area2 > 0 ? 1 : -1;
  const outward = (a: Vec2, b: Vec2): Vec2 => {
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    return { x: (sign * ez) / len, z: (-sign * ex) / len };
  };
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const n1 = outward(prev, cur);
    const n2 = outward(cur, next);
    let bx = n1.x + n2.x;
    let bz = n1.z + n2.z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) {
      // 180° spike — offset along one normal
      bx = n1.x;
      bz = n1.z;
    } else {
      bx /= bl;
      bz /= bl;
    }
    // miter length so straight edges stay parallel; capped for sharp corners
    const cosHalf = Math.max(0.34, Math.sqrt(Math.max(0.05, (1 + (n1.x * n2.x + n1.z * n2.z)) / 2)));
    const m = Math.min(d / cosHalf, d * 3);
    out.push({ x: cur.x + bx * m, z: cur.z + bz * m });
  }
  return out;
}
