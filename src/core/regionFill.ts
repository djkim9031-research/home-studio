import type { PlacedElement, Vec2, Wall } from '../types';
import { wallLen } from './validity';

/** Grid resolution for the flood fill, inches per cell. */
const CELL = 3;
const SIMPLIFY_TOL = 2.8; // inches — over half a cell-diagonal so stair-steps flatten

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

/** Grow the region INTO the adjacent blocked band (walls + dividers) so the
 * traced outline reaches the wall centerline and adjoining fills meet across
 * a divider. Dilation can only claim already-blocked cells, so it can never
 * escape the enclosure — unconditionally stable, unlike polygon offsetting. */
function dilateIntoBlocked(mask: Uint8Array, blocked: Uint8Array, W: number, H: number, iterations: number): void {
  for (let it = 0; it < iterations; it++) {
    const grown: number[] = [];
    for (let gz = 0; gz < H; gz++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gz * W + gx;
        if (mask[i] || !blocked[i]) continue;
        if (
          (gx + 1 < W && mask[i + 1]) ||
          (gx > 0 && mask[i - 1]) ||
          (gz + 1 < H && mask[i + W]) ||
          (gz > 0 && mask[i - W])
        ) {
          grown.push(i);
        }
      }
    }
    for (const i of grown) mask[i] = 1;
  }
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
  // regions are bounded ONLY by real walls — a gap (doorway) lets the flood
  // through, so a wall that doesn't fully enclose an area doesn't divide it
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

  // reach under the walls: claim the adjacent blocked band up to ~centerline
  dilateIntoBlocked(filled, blocked, W, H, 2);

  const outline = traceMask(filled, g);
  if (!outline) return { ok: false, reason: 'tiny' };

  // ground truth: the polygon must agree with the flood's own cell area and
  // contain the click — anything degenerate is refused, never rendered
  let cells = 0;
  for (let i = 0; i < filled.length; i++) cells += filled[i];
  const cellSqIn = cells * CELL * CELL;
  const shoelace = (poly: Vec2[]): number => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      a += p.x * q.z - q.x * p.z;
    }
    return Math.abs(a) / 2;
  };
  const sane = (poly: Vec2[]): boolean => {
    const a = shoelace(poly);
    return a > cellSqIn * 0.55 && a < cellSqIn * 1.6 && pointInPoly(at, poly);
  };
  const polygon = dedupe(outline);
  if (!sane(polygon)) return { ok: false, reason: 'open' };
  return { ok: true, polygon };
}

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Drop consecutive near-duplicate vertices (degenerate triangulation fuel). */
function dedupe(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.5) out.push(p);
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.z - l.z) <= 0.5) out.pop();
  }
  return out;
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


/**
 * Every fully-enclosed region on a floor (for automatic ceilings): flood the
 * OUTSIDE from the grid border; unblocked cells the outside never reaches are
 * interior regions. Regions grow into the wall band like fills do.
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
    dilateIntoBlocked(mask, blocked, W, H, 2);
    const outline = traceMask(mask, g);
    if (outline) regions.push(dedupe(outline));
  }
  return regions;
}
