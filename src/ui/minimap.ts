import { formatFeetInches } from '../core/format';
import { finishMaterial } from '../data/registry';
import * as store from '../state/store';
import { polygonSqft, type FloorIndex, type Wall } from '../types';

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
  panel.innerHTML = `<div class="hs-mini-head" data-k="head">Floor plan</div>`;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * 2;
  canvas.height = SIZE * 2;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  panel.appendChild(canvas);
  root.appendChild(panel);
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);

  const head = panel.querySelector('[data-k="head"]') as HTMLElement;

  const refresh = (): void => {
    const floor = getFloor();
    const tag = ({ [-1]: 'Basement', 0: 'Ground floor', 1: 'Second floor', 2: 'Third floor' } as Record<number, string>)[floor];
    head.textContent = `Floor plan · ${tag}`;
    const on = store.getState().elements.filter((e) => e.floor === floor);
    const walls = on.filter((e): e is Wall => e.kind === 'wall');

    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, SIZE, SIZE);
    if (!walls.length) {
      g.fillStyle = '#a99f8d';
      g.font = '12px system-ui';
      g.textAlign = 'center';
      g.fillText('draw walls to see the plan', SIZE / 2, SIZE / 2);
      return;
    }

    // fit the floor's content into the canvas
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const grow = (x: number, z: number): void => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
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
    const px = (x: number): number => ox + (x - minX) * scale;
    const pz = (z: number): number => oz + (z - minZ) * scale;

    // floors (slabs) as tinted fills
    for (const e of on) {
      if (e.kind !== 'slab') continue;
      const mat = finishMaterial(e.textureId, e.color);
      g.fillStyle = `#${mat.color.getHexString()}`;
      mat.map?.dispose();
      mat.dispose();
      g.globalAlpha = 0.5;
      g.beginPath();
      e.polygon.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), pz(p.z)) : g.lineTo(px(p.x), pz(p.z))));
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
      g.moveTo(px(w.a.x), pz(w.a.z));
      g.lineTo(px(w.b.x), pz(w.b.z));
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
      g.fillText(`${e.name}`, px(cx), pz(cz) - 5);
      g.fillStyle = '#8a8172';
      g.font = '9px system-ui';
      g.fillText(`${Math.round(polygonSqft(e.polygon))} ft²`, px(cx), pz(cz) + 6);
      g.fillStyle = '#7a5a2a';
      g.font = 'bold 10px system-ui';
    }

    // scale note
    g.fillStyle = '#a99f8d';
    g.font = '9px system-ui';
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillText(`${formatFeetInches(spanX)} wide`, SIZE - 4, SIZE - 3);
  };

  refresh();
  return { refresh };
}
