import type { House, Vec2 } from '../types';

/** The Matterport application key is the USER'S credential: it is never
 * committed or shipped — each browser stores its own copy locally after the
 * user pastes it once (tour panel input, or a #mpkey=… hash for QA). */
const KEY_STORE = 'hs:mpkey';

export function getMpKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}

export function setMpKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORE, key.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
}

const SDK_SRC = 'https://static.matterport.com/showcase-sdk/latest.js';
const M2IN = 39.3701;

interface SweepPoint {
  x: number; // inches, plan space
  z: number;
  floor: number;
}

interface MpSdk {
  Sweep: {
    data: {
      subscribe(observer: {
        onCollectionUpdated?(collection: Record<string, unknown>): void;
      }): { cancel(): void };
    };
  };
  Floor: { data: { subscribe(o: object): { cancel(): void } } };
  disconnect(): void;
}

declare global {
  interface Window {
    MP_SDK?: { connect(iframe: HTMLIFrameElement, key?: string, version?: string): Promise<MpSdk> };
  }
}

let sdkScript: Promise<void> | null = null;
function loadSdkScript(): Promise<void> {
  if (!sdkScript) {
    sdkScript = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SDK_SRC;
      s.onload = () => res();
      s.onerror = () => rej(new Error('could not load the Matterport SDK script'));
      document.head.appendChild(s);
    });
  }
  return sdkScript;
}

/** Spin up a hidden keyed player, connect, and collect every sweep's plan
 * position. The visible tour iframe stays key-free so a bad key or missing
 * allowlist entry can never break the walkthrough itself. */
export async function collectSweeps(modelId: string, mount?: HTMLElement): Promise<SweepPoint[]> {
  await loadSdkScript();
  if (!window.MP_SDK) throw new Error('Matterport SDK unavailable');
  const key = getMpKey();
  if (!key) throw new Error('no SDK key saved — paste it in the tour panel first');

  const iframe = document.createElement('iframe');
  // the player must be VISIBLE to boot (offscreen iframes get throttled and
  // never stream sweeps) — overlay it on the tour panel while measuring
  if (mount) {
    iframe.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:300px;border:0;z-index:5;background:#111;';
    mount.style.position = 'relative';
    mount.appendChild(iframe);
  } else {
    iframe.style.cssText = 'position:fixed;right:8px;bottom:8px;width:420px;height:280px;border:1px solid #999;z-index:80;background:#111;';
    document.body.appendChild(iframe);
  }
  iframe.allow = 'fullscreen; vr; xr-spatial-tracking';
  iframe.src = `https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&brand=0&play=1&applicationKey=${encodeURIComponent(key)}`;
  const cleanup = (): void => iframe.remove();

  const host = location.hostname || 'localhost';
  let sdk: MpSdk;
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('the keyed player never loaded')), 60000);
      iframe.addEventListener('load', () => {
        clearTimeout(t);
        res();
      });
    });
    // modern latest.js: the key rides the iframe URL and connect takes just
    // the iframe; older builds want (iframe, key, sdkVersion)
    try {
      sdk = await withTimeout(window.MP_SDK.connect(iframe), 60000);
    } catch (e) {
      if (isTimeout(e)) throw e;
      sdk = await withTimeout(window.MP_SDK.connect(iframe, key, '3.10'), 60000);
    }
  } catch (e) {
    cleanup();
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `could not connect (${detail}). Check the key, and make sure "${host}" is on its allow list at my.matterport.com → Settings → Developer Tools.`,
    );
  }
  try {
    const sweeps = await new Promise<SweepPoint[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.cancel();
        reject(new Error('tour loaded no scan points (the space may block SDK access)'));
      }, 30000);
      let settle: ReturnType<typeof setTimeout> | null = null;
      let latest: SweepPoint[] = [];
      const sub = sdk.Sweep.data.subscribe({
        onCollectionUpdated(collection) {
          const pts: SweepPoint[] = [];
          for (const key of Object.keys(collection)) {
            const s = collection[key] as {
              position?: { x: number; y: number; z: number };
              floorInfo?: { sequence?: number };
              floor?: number;
            };
            if (!s?.position) continue;
            const floor = s.floorInfo?.sequence ?? s.floor ?? 0;
            pts.push({ x: s.position.x * M2IN, z: s.position.z * M2IN, floor: Number(floor) || 0 });
          }
          if (!pts.length) return;
          latest = pts;
          if (settle) clearTimeout(settle);
          settle = setTimeout(() => {
            clearTimeout(timer);
            sub.cancel();
            resolve(latest);
          }, 1500); // collection streams in — take it once it stops growing
        },
      });
    });
    return sweeps;
  } finally {
    try {
      sdk.disconnect();
    } catch {
      /* player may already be gone */
    }
    cleanup();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`SDK connect timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e) => {
        clearTimeout(t);
        rej(e);
      },
    );
  });
}

const isTimeout = (e: unknown): boolean => e instanceof Error && e.message.includes('timed out');

// ---------------------------------------------------------------------------
// Sweep cloud → floor outline: occupancy grid, dilation (walls sit beyond the
// walkable scan points), marching-squares boundary, simplification.
// ---------------------------------------------------------------------------

const CELL = 18; // inches per grid cell
const DILATE = 2; // cells (~3' from outermost sweep to the wall line)

export function hullFromPoints(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return [];
  const minX = Math.min(...pts.map((p) => p.x)) - CELL * (DILATE + 2);
  const minZ = Math.min(...pts.map((p) => p.z)) - CELL * (DILATE + 2);
  const maxX = Math.max(...pts.map((p) => p.x)) + CELL * (DILATE + 2);
  const maxZ = Math.max(...pts.map((p) => p.z)) + CELL * (DILATE + 2);
  const W = Math.ceil((maxX - minX) / CELL);
  const H = Math.ceil((maxZ - minZ) / CELL);
  const grid = new Uint8Array(W * H);
  for (const p of pts) {
    const gx = Math.floor((p.x - minX) / CELL);
    const gz = Math.floor((p.z - minZ) / CELL);
    grid[gz * W + gx] = 1;
  }
  // close small gaps between sweeps, then dilate out to the wall line
  for (let pass = 0; pass < DILATE + 1; pass++) {
    const next = grid.slice();
    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        if (grid[z * W + x]) continue;
        const n =
          grid[z * W + x - 1] + grid[z * W + x + 1] + grid[(z - 1) * W + x] + grid[(z + 1) * W + x];
        if (n >= (pass === 0 ? 2 : 1)) next[z * W + x] = 1;
      }
    }
    grid.set(next);
  }
  // marching squares: walk the outer contour
  let sx = -1;
  let sz = -1;
  outer: for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (grid[z * W + x]) {
        sx = x;
        sz = z;
        break outer;
      }
    }
  }
  if (sx < 0) return [];
  const at = (x: number, z: number): number =>
    x >= 0 && z >= 0 && x < W && z < H ? grid[z * W + x] : 0;
  // boundary follow (Moore neighborhood)
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const contour: Vec2[] = [];
  let cx = sx;
  let cz = sz;
  let dir = 6;
  for (let steps = 0; steps < W * H * 4; steps++) {
    contour.push({ x: minX + cx * CELL + CELL / 2, z: minZ + cz * CELL + CELL / 2 });
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8; // start looking backwards-left
      const nx = cx + dirs[d][0];
      const nz = cz + dirs[d][1];
      if (at(nx, nz)) {
        cx = nx;
        cz = nz;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cz === sz && contour.length > 3) break;
  }
  return simplify(contour, 10);
}

/** Douglas-Peucker. */
function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const ax = pts[a].x;
    const az = pts[a].z;
    const bx = pts[b].x;
    const bz = pts[b].z;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i].z) - (ax - pts[i].x) * (bz - az)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

// ---------------------------------------------------------------------------
// Apply to the house: one story per detected floor, raster shows the measured
// outline + sweep dots as the tracing reference.
// ---------------------------------------------------------------------------

export interface ExtractResult {
  floors: number;
  applied: number;
  widthFt: number;
  depthFt: number;
}

export function applySweepsToHouse(house: House, sweeps: SweepPoint[]): ExtractResult {
  const byFloor = new Map<number, SweepPoint[]>();
  for (const s of sweeps) {
    const arr = byFloor.get(s.floor) ?? [];
    arr.push(s);
    byFloor.set(s.floor, arr);
  }
  const floors = [...byFloor.entries()].sort((a, b) => a[0] - b[0]);
  let applied = 0;
  let widthFt = 0;
  let depthFt = 0;
  // one shared coordinate frame for every floor — the sweeps are all measured
  // in the same model space, and stories must stack in the shell, so each
  // raster/boundary is offset by the GLOBAL extents rather than its own
  const hulls = floors.map(([, pts]) => ({ pts, hull: hullFromPoints(pts) }));
  const allPts = hulls.filter((f) => f.hull.length >= 3).flatMap((f) => f.hull);
  if (allPts.length < 3) return { floors: floors.length, applied: 0, widthFt: 0, depthFt: 0 };
  const minX = Math.min(...allPts.map((p) => p.x));
  const minZ = Math.min(...allPts.map((p) => p.z));
  const maxX = Math.max(...allPts.map((p) => p.x));
  const maxZ = Math.max(...allPts.map((p) => p.z));
  const pad = 24;
  const w = Math.ceil(maxX - minX) + pad * 2;
  const h = Math.ceil(maxZ - minZ) + pad * 2;
  hulls.forEach(({ pts, hull }, idx) => {
    const plan = house.plans[idx];
    if (!plan) return;
    if (hull.length < 3) return;
    if (idx === 0) {
      widthFt = (Math.max(...hull.map((p) => p.x)) - Math.min(...hull.map((p) => p.x))) / 12;
      depthFt = (Math.max(...hull.map((p) => p.z)) - Math.min(...hull.map((p) => p.z))) / 12;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f8f6f1';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a352e';
    g.lineWidth = 5;
    g.beginPath();
    hull.forEach((p, i) => {
      if (i === 0) g.moveTo(p.x - minX + pad, p.z - minZ + pad);
      else g.lineTo(p.x - minX + pad, p.z - minZ + pad);
    });
    g.closePath();
    g.stroke();
    g.fillStyle = '#b08d57';
    for (const p of pts) {
      g.beginPath();
      g.arc(p.x - minX + pad, p.z - minZ + pad, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#8b8172';
    g.font = '14px system-ui';
    g.textAlign = 'center';
    g.fillText('measured from the Matterport tour — dots are scan points', w / 2, h - 8);

    plan.imageData = c.toDataURL('image/png');
    plan.imageW = w;
    plan.imageH = h;
    plan.inPerPx = 1;
    plan.boundaryPx = hull.map((p) => ({ x: p.x - minX + pad, z: p.z - minZ + pad }));
    plan.wallsPx = [];
    plan.openingsPx = [];
    applied++;
  });
  return { floors: floors.length, applied, widthFt, depthFt };
}
