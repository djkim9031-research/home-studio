import { formatFeetInches } from '../core/format';
import * as store from '../state/store';
import { polygonSqft, type FloorIndex, type Opening, type Wall } from '../types';

export interface Minimap {
  refresh(): void;
}

const SIZE = 220;
const PAD = 14;

/** A little top-down plan of the floor you're building — walls, floors and
 * room labels, redrawn as you place things. */
export function buildMinimap(root: HTMLElement, getFloor: () => FloorIndex): Minimap {
  const panel = document.createElement('div');
  panel.className = 'hs-minimap';
  panel.innerHTML = `<div class="hs-mini-head" data-k="head"><span data-k="title">Floor plan</span><button class="hs-collapse" data-k="toggle" title="Collapse">▾</button></div>`;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * 2;
  canvas.height = SIZE * 2;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  panel.appendChild(canvas);
  root.appendChild(panel);
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);

  const head = panel.querySelector('[data-k="title"]') as HTMLElement;
  const toggle = panel.querySelector('[data-k="toggle"]') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    canvas.style.display = collapsed ? 'none' : '';
    toggle.textContent = collapsed ? '▸' : '▾';
  });

  const refresh = (): void => {
    const floor = getFloor();
    const tag = ({ [-1]: 'Basement', 0: 'Ground floor', 1: 'Second floor', 2: 'Third floor' } as Record<number, string>)[floor];
    const all = store.getState().elements;
    const on = all.filter((e) => e.floor === floor);
    const walls = on.filter((e): e is Wall => e.kind === 'wall');

    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, SIZE, SIZE);
    if (!walls.length) {
      head.textContent = `Floor plan · ${tag}`;
      g.fillStyle = '#a99f8d';
      g.font = '12px system-ui';
      g.textAlign = 'center';
      g.fillText('draw walls to see the plan', SIZE / 2, SIZE / 2);
      drawCompass(0);
      return;
    }

    // rotation center = plan centroid of this floor's walls
    let ccx = 0;
    let ccz = 0;
    for (const w of walls) {
      ccx += w.a.x + w.b.x;
      ccz += w.a.z + w.b.z;
    }
    ccx /= walls.length * 2;
    ccz /= walls.length * 2;

    // north-up by default; once a main entrance is set, spin the plan so that
    // door faces the bottom of the panel (its outward normal points south)
    let alpha = 0;
    const mainDoor = all.find((e): e is Opening => e.kind === 'door' && !!e.isMainEntrance);
    const mainWall = mainDoor && all.find((e): e is Wall => e.kind === 'wall' && e.id === mainDoor.wallId);
    if (mainDoor && mainWall) {
      const len = Math.hypot(mainWall.b.x - mainWall.a.x, mainWall.b.z - mainWall.a.z) || 1;
      const dx = (mainWall.b.x - mainWall.a.x) / len;
      const dz = (mainWall.b.z - mainWall.a.z) / len;
      let nx = -dz;
      let nz = dx;
      const doorX = mainWall.a.x + dx * mainDoor.centerIn;
      const doorZ = mainWall.a.z + dz * mainDoor.centerIn;
      if ((doorX - ccx) * nx + (doorZ - ccz) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      alpha = -Math.atan2(nx, nz); // rotate the outward normal onto +z (screen down)
    }
    head.textContent = `Floor plan · ${tag}${mainDoor ? ' · entrance ↓' : ' · N ↑'}`;

    const cos = Math.cos(alpha);
    const sin = Math.sin(alpha);
    // rotate a plan point about the centroid (screen down = +z)
    const R = (x: number, z: number): { x: number; z: number } => {
      const ax = x - ccx;
      const az = z - ccz;
      return { x: ccx + az * sin + ax * cos, z: ccz + az * cos - ax * sin };
    };

    // fit the rotated content into the canvas
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const grow = (x: number, z: number): void => {
      const r = R(x, z);
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x);
      minZ = Math.min(minZ, r.z);
      maxZ = Math.max(maxZ, r.z);
    };
    for (const w of walls) {
      grow(w.a.x, w.a.z);
      grow(w.b.x, w.b.z);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((SIZE - PAD * 2) / spanX, (SIZE - PAD * 2) / spanZ);
    const ox = (SIZE - spanX * scale) / 2;
    const oz = (SIZE - spanZ * scale) / 2;
    const px = (x: number, z: number): number => ox + (R(x, z).x - minX) * scale;
    const pz = (x: number, z: number): number => oz + (R(x, z).z - minZ) * scale;

    // floors (slabs) as tinted fills
    for (const e of on) {
      if (e.kind !== 'slab') continue;
      g.fillStyle = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#cbb892';
      g.globalAlpha = 0.5;
      g.beginPath();
      e.polygon.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x, p.z), pz(p.x, p.z)) : g.lineTo(px(p.x, p.z), pz(p.x, p.z))));
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }

    // walls
    g.strokeStyle = '#4a443d';
    g.lineWidth = Math.max(1.5, 3 * scale);
    g.lineCap = 'round';
    for (const w of walls) {
      g.beginPath();
      g.moveTo(px(w.a.x, w.a.z), pz(w.a.x, w.a.z));
      g.lineTo(px(w.b.x, w.b.z), pz(w.b.x, w.b.z));
      g.stroke();
    }

    // openings: a light gap marker; the main entrance gets a bold red tick
    const openings = on.filter((e): e is Opening => e.kind === 'door' || e.kind === 'window');
    for (const e of openings) {
      const wl = walls.find((w) => w.id === e.wallId);
      if (!wl) continue;
      const len = Math.hypot(wl.b.x - wl.a.x, wl.b.z - wl.a.z) || 1;
      const dx = (wl.b.x - wl.a.x) / len;
      const dz = (wl.b.z - wl.a.z) / len;
      const ax = wl.a.x + dx * (e.centerIn - e.widthIn / 2);
      const az = wl.a.z + dz * (e.centerIn - e.widthIn / 2);
      const bx = wl.a.x + dx * (e.centerIn + e.widthIn / 2);
      const bz = wl.a.z + dz * (e.centerIn + e.widthIn / 2);
      const isMain = e.kind === 'door' && e.isMainEntrance;
      g.strokeStyle = isMain ? '#b6472e' : '#cdbfa4';
      g.lineWidth = isMain ? 4 : Math.max(1.5, 3 * scale);
      g.beginPath();
      g.moveTo(px(ax, az), pz(ax, az));
      g.lineTo(px(bx, bz), pz(bx, bz));
      g.stroke();
    }

    // room labels
    g.fillStyle = '#7a5a2a';
    g.font = 'bold 10px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const e of on) {
      if (e.kind !== 'room') continue;
      let cx = 0;
      let cz = 0;
      for (const p of e.polygon) {
        cx += p.x;
        cz += p.z;
      }
      cx /= e.polygon.length;
      cz /= e.polygon.length;
      g.fillText(`${e.name}`, px(cx, cz), pz(cx, cz) - 5);
      g.fillStyle = '#8a8172';
      g.font = '9px system-ui';
      g.fillText(`${Math.round(polygonSqft(e.polygon))} ft²`, px(cx, cz), pz(cx, cz) + 6);
      g.fillStyle = '#7a5a2a';
      g.font = 'bold 10px system-ui';
    }

    // scale note (bottom-left, clear of the compass)
    g.fillStyle = '#a99f8d';
    g.font = '9px system-ui';
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(`${formatFeetInches(spanX)} wide`, 4, SIZE - 3);

    drawCompass(alpha);
  };

  // little compass, bottom-right of the plan; N points where true north sits
  // after the plan's rotation (screen: x→right, z→down; north world dir = −z)
  const drawCompass = (alpha: number): void => {
    const cx = SIZE - 22;
    const cy = SIZE - 22;
    const r = 13;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.82)';
    g.fill();
    g.strokeStyle = '#cdbfa4';
    g.lineWidth = 1;
    g.stroke();
    const nx = -Math.sin(alpha);
    const nz = -Math.cos(alpha);
    g.beginPath();
    g.moveTo(cx - nx * r * 0.7, cy - nz * r * 0.7);
    g.lineTo(cx + nx * r * 0.8, cy + nz * r * 0.8);
    g.strokeStyle = '#b6472e';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#b6472e';
    g.font = 'bold 9px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', cx + nx * (r + 5), cy + nz * (r + 5));
    g.restore();
  };

  refresh();
  return { refresh };
}
