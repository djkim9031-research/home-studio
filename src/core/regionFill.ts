import type { PlacedElement, Vec2, Wall } from '../types';
import { wallLen } from './validity';

/** Grid resolution for the flood fill, inches per cell. */
const CELL = 3;
const SIMPLIFY_TOL = 2; // inches

export type FillResult = { ok: true; polygon: Vec2[] } | { ok: false; reason: 'open' | 'no-walls' | 'tiny' };

/**
 * Find the walled-in region around a click point: occupancy grid over the
 * floor's walls, BFS flood from the click; a flood that escapes to the grid
 * border means the area isn't enclosed. The boundary comes back as a
 * simplified polygon in plan inches.
 */
export function fillRegion(elements: PlacedElement[], floor: number, at: Vec2): FillResult {
  const walls = elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === floor && wallLen(e) > 1);
  if (!walls.length) return { ok: false, reason: 'no-walls' };

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
  if (W * H > 4_000_000) return { ok: false, reason: 'open' }; // absurd extent guard

  // blocked cells: center within half the wall thickness of a wall segment
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

  const sx = Math.floor((at.x - minX) / CELL);
  const sz = Math.floor((at.z - minZ) / CELL);
  if (sx < 0 || sz < 0 || sx >= W || sz >= H || blocked[sz * W + sx]) return { ok: false, reason: 'open' };

  // BFS flood
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

  // Moore-neighborhood contour trace around the filled mask
  const at2 = (gx: number, gz: number): number => (gx < 0 || gz < 0 || gx >= W || gz >= H ? 0 : filled[gz * W + gx]);
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
  if (startX < 0) return { ok: false, reason: 'tiny' };

  // Moore-neighbor boundary trace, clockwise (screen coords: x right, z down)
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
  if (contour.length < 3) return { ok: false, reason: 'tiny' };

  const simplified = simplify(contour, SIMPLIFY_TOL);
  if (simplified.length < 3) return { ok: false, reason: 'tiny' };
  return { ok: true, polygon: simplified };
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
