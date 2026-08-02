import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { COLORS, i2m, IN, JOIST_T } from '../constants';
import { finishMaterial, finishRepeatPerIn } from '../data/registry';
import { openingsOf, wallDir, wallLen, wallPointAt } from '../core/validity';
import {
  floorBaseIn,
  polygonSqft,
  storyHeightIn,
  type FloorSlab,
  type Opening,
  type PlacedElement,
  type Room,
  type Stair,
  type Wall,
} from '../types';

/** Everything the cutaway/highlight controllers need about one element's mesh. */
interface Entry {
  group: THREE.Group;
  key: string;
  /** materials that receive cutaway clipping planes */
  clipMats: THREE.Material[];
}

const wallUp = new THREE.Vector3(0, 1, 0);

function scaleBoxUV(geo: THREE.BoxGeometry, uMul: number, vMul: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uMul, uv.getY(i) * vMul);
  uv.needsUpdate = true;
}

export class ElementMeshes {
  private parent: THREE.Group;
  private entries = new Map<string, Entry>();
  private outlineMat = new THREE.LineBasicMaterial({ color: COLORS.brass });

  constructor(parent: THREE.Group) {
    this.parent = parent;
  }

  getGroup(id: string): THREE.Group | undefined {
    return this.entries.get(id)?.group;
  }

  clipMats(id: string): THREE.Material[] {
    return this.entries.get(id)?.clipMats ?? [];
  }

  allEntries(): Map<string, { group: THREE.Group; clipMats: THREE.Material[] }> {
    return this.entries;
  }

  /** Rebuild what changed; `key` captures every geometry-affecting input. */
  sync(elements: PlacedElement[]): void {
    const wanted = new Map<string, PlacedElement>();
    for (const e of elements) wanted.set(e.id, e);

    for (const [id, entry] of [...this.entries]) {
      if (!wanted.has(id)) {
        this.parent.remove(entry.group);
        disposeGroup(entry.group);
        this.entries.delete(id);
      }
    }

    for (const e of elements) {
      const key = buildKey(e, elements);
      const cur = this.entries.get(e.id);
      if (cur && cur.key === key) continue;
      if (cur) {
        this.parent.remove(cur.group);
        disposeGroup(cur.group);
      }
      const built = buildElement(e, elements);
      built.group.traverse((o) => {
        o.userData.itemId = e.id;
      });
      built.group.userData.itemId = e.id;
      built.group.userData.kind = e.kind;
      built.group.userData.floor = e.floor;
      this.parent.add(built.group);
      this.entries.set(e.id, { group: built.group, key, clipMats: built.clipMats });
    }
  }

  setSelected(ids: string[]): void {
    const sel = new Set(ids);
    for (const [id, entry] of this.entries) {
      let line = entry.group.getObjectByName('sel-outline') as THREE.LineSegments | undefined;
      if (sel.has(id)) {
        if (!line) {
          const box = new THREE.Box3().setFromObject(entry.group);
          if (box.isEmpty()) continue;
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.02, size.y + 0.02, size.z + 0.02));
          line = new THREE.LineSegments(geo, this.outlineMat);
          line.name = 'sel-outline';
          entry.group.worldToLocal(center);
          line.position.copy(center);
          entry.group.add(line);
        }
        line.visible = true;
      } else if (line) {
        line.visible = false;
      }
    }
  }
}

function buildKey(e: PlacedElement, elements: PlacedElement[]): string {
  const base = JSON.stringify(e) + `|b${floorBaseIn(elements, e.floor)}`;
  if (e.kind === 'wall') {
    const cuts = openingsOf(elements, e.id)
      .map((o) => `${o.centerIn.toFixed(2)}:${o.widthIn}:${o.heightIn}:${o.sillIn}`)
      .sort()
      .join(',');
    return base + '|' + cuts;
  }
  if (e.kind === 'door' || e.kind === 'window') {
    const wall = elements.find((w) => w.id === e.wallId);
    return base + '|' + (wall ? JSON.stringify(wall) : 'orphan');
  }
  if (e.kind === 'stair') return base + `|h${storyHeightIn(elements, e.floor)}`;
  return base;
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    // CSS2D labels leave DOM behind unless removed explicitly
    const css = o as CSS2DObject;
    if ((css as { isCSS2DObject?: boolean }).isCSS2DObject) css.element.remove();
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.LineSegments).isLineSegments) {
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildElement(e: PlacedElement, elements: PlacedElement[]): { group: THREE.Group; clipMats: THREE.Material[] } {
  switch (e.kind) {
    case 'wall':
      return buildWall(e, elements);
    case 'door':
    case 'window':
      return buildOpening(e, elements);
    case 'stair':
      return buildStair(e, elements);
    case 'slab':
      return buildSlab(e, elements);
    case 'room':
      return buildRoomLabel(e, elements);
  }
}

function buildRoomLabel(room: Room, elements: PlacedElement[]): { group: THREE.Group; clipMats: THREE.Material[] } {
  const group = new THREE.Group();
  const baseY = floorBaseIn(elements, room.floor);
  let cx = 0;
  let cz = 0;
  for (const p of room.polygon) {
    cx += p.x;
    cz += p.z;
  }
  cx /= room.polygon.length;
  cz /= room.polygon.length;
  const el = document.createElement('div');
  el.className = 'chip room-chip';
  el.textContent = `${room.name} · ${Math.round(polygonSqft(room.polygon))} ft²`;
  const label = new CSS2DObject(el);
  label.center.set(0.5, 0.5);
  label.position.set(i2m(cx), i2m(baseY + 40), i2m(cz));
  group.add(label);
  return { group, clipMats: [] };
}

function buildWall(wall: Wall, elements: PlacedElement[]): { group: THREE.Group; clipMats: THREE.Material[] } {
  const group = new THREE.Group();
  const baseY = floorBaseIn(elements, wall.floor);
  const mat = finishMaterial(wall.textureId, wall.color);
  const rep = finishRepeatPerIn(wall.textureId);
  const len = wallLen(wall);
  const dir = wallDir(wall);
  const yaw = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);

  const seg = (t0: number, t1: number, y0: number, y1: number): void => {
    const L = t1 - t0;
    if (L < 0.5 || y1 - y0 < 0.5) return;
    const geo = new THREE.BoxGeometry(i2m(L), i2m(y1 - y0), i2m(wall.thickIn));
    scaleBoxUV(geo, L * rep, (y1 - y0) * rep);
    const m = new THREE.Mesh(geo, mat);
    const mid = wallPointAt(wall, (t0 + t1) / 2);
    m.position.set(i2m(mid.x), i2m(baseY + (y0 + y1) / 2), i2m(mid.z));
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };

  const cuts = openingsOf(elements, wall.id)
    .map((o) => ({ t0: o.centerIn - o.widthIn / 2, t1: o.centerIn + o.widthIn / 2, head: o.sillIn + o.heightIn, sill: o.sillIn }))
    .filter((c) => c.t1 > 0 && c.t0 < len)
    .sort((p, q) => p.t0 - q.t0);

  let cursor = 0;
  for (const c of cuts) {
    const t0 = Math.max(cursor, c.t0);
    const t1 = Math.min(len, c.t1);
    if (t0 > cursor) seg(cursor, t0, 0, wall.heightIn);
    seg(t0, t1, c.head, wall.heightIn); // header
    if (c.sill > 0) seg(t0, t1, 0, c.sill); // sill wall below windows
    cursor = t1;
  }
  if (cursor < len) seg(cursor, len, 0, wall.heightIn);
  void dir;
  void wallUp;
  return { group, clipMats: [mat] };
}

function buildOpening(op: Opening, elements: PlacedElement[]): { group: THREE.Group; clipMats: THREE.Material[] } {
  const group = new THREE.Group();
  const wall = elements.find((e): e is Wall => e.kind === 'wall' && e.id === op.wallId);
  if (!wall) return { group, clipMats: [] };
  const baseY = floorBaseIn(elements, wall.floor);
  const center = wallPointAt(wall, op.centerIn);
  const yaw = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  group.position.set(i2m(center.x), i2m(baseY), i2m(center.z));
  group.rotation.y = yaw;

  const frameMat = new THREE.MeshStandardMaterial({ color: op.color || '#f5f2ea', roughness: 0.6, metalness: 0.05 });
  const leafMat = frameMat.clone();
  leafMat.color.multiplyScalar(0.96);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbcd2dd,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
  });
  const clipMats: THREE.Material[] = [frameMat, leafMat, glassMat];

  const W = op.widthIn;
  const H = op.heightIn;
  const T = wall.thickIn + 0.6; // proud of the wall faces
  const F = 2; // frame thickness

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(h), i2m(d)), m);
    mesh.position.set(i2m(x), i2m(y), i2m(z));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // jambs + head (all styles share the frame)
  box(F, H, T, -(W / 2 - F / 2), op.sillIn + H / 2, 0, frameMat);
  box(F, H, T, W / 2 - F / 2, op.sillIn + H / 2, 0, frameMat);
  box(W, F, T, 0, op.sillIn + H - F / 2, 0, frameMat);
  if (op.kind === 'window') box(W, F, T, 0, op.sillIn + F / 2, 0, frameMat);

  const iw = W - 2 * F; // inner width
  const ih = H - (op.kind === 'window' ? 2 * F : F); // inner height
  const iy = op.sillIn + (op.kind === 'window' ? F : 0) + ih / 2;

  if (op.kind === 'door') {
    switch (op.styleId) {
      case 'glass': {
        box(iw, ih * 0.42, 1.6, 0, iy - ih * 0.29, 0, leafMat);
        box(iw, ih * 0.58 - 2, 1, 0, iy + ih * 0.21, 0, glassMat);
        box(iw, 2, 1.6, 0, iy, 0, leafMat); // mid rail
        break;
      }
      case 'sliding': {
        box(iw / 2 + 1, ih, 1.2, -iw / 4, iy, -1.2, glassMat);
        box(iw / 2 + 1, ih, 1.2, iw / 4, iy, 1.2, glassMat);
        box(1.5, ih, 1.6, -1, iy, -1.2, leafMat);
        box(1.5, ih, 1.6, 1, iy, 1.2, leafMat);
        break;
      }
      default: {
        // panel: solid leaf with two inset panels
        box(iw, ih, 1.8, 0, iy, 0, leafMat);
        box(iw * 0.62, ih * 0.32, 2.4, 0, iy + ih * 0.22, 0, frameMat);
        box(iw * 0.62, ih * 0.36, 2.4, 0, iy - ih * 0.22, 0, frameMat);
      }
    }
    // handle
    box(1.2, 1.2, 3.4, iw / 2 - 3, iy - 1, 0, frameMat);
  } else {
    // windows: glass + style rails
    box(iw, ih, 0.8, 0, iy, 0, glassMat);
    switch (op.styleId) {
      case 'singleHung':
        box(iw, 1.4, 1.6, 0, iy, 0, frameMat);
        break;
      case 'casement':
        box(1.4, ih, 1.6, 0, iy, 0, frameMat);
        break;
      default:
        break; // picture: clean pane
    }
  }
  return { group, clipMats };
}

function buildStair(st: Stair, elements: PlacedElement[]): { group: THREE.Group; clipMats: THREE.Material[] } {
  const group = new THREE.Group();
  const baseY = floorBaseIn(elements, st.floor);
  const rise = storyHeightIn(elements, st.floor) + JOIST_T;
  const treadMat = finishMaterial(st.textureId, st.color);
  const stringerMat = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.8 });
  const clipMats: THREE.Material[] = [];
  group.position.set(i2m(st.x), i2m(baseY), i2m(st.z));
  group.rotation.y = -st.yawDeg * (Math.PI / 180);

  const closed = st.styleId === 'closedRiser';
  const TREAD_T = 1.4;

  const flight = (x0: number, z0: number, runLen: number, y0: number, y1: number, dirZ: 1 | -1, width: number): void => {
    const steps = Math.max(2, Math.round((y1 - y0) / 7.5));
    const treadD = runLen / steps;
    const stepH = (y1 - y0) / steps;
    for (let i = 0; i < steps; i++) {
      const y = y0 + stepH * (i + 1);
      const z = z0 + dirZ * (treadD * i + treadD / 2);
      const tread = new THREE.Mesh(new THREE.BoxGeometry(i2m(width), i2m(TREAD_T), i2m(treadD)), treadMat);
      tread.position.set(i2m(x0), i2m(y - TREAD_T / 2), i2m(z));
      tread.castShadow = true;
      tread.receiveShadow = true;
      group.add(tread);
      if (closed) {
        const riser = new THREE.Mesh(new THREE.BoxGeometry(i2m(width), i2m(stepH), i2m(1)), treadMat);
        riser.position.set(i2m(x0), i2m(y - stepH / 2 - TREAD_T / 2), i2m(z - dirZ * (treadD / 2 - 0.5)));
        riser.castShadow = true;
        riser.receiveShadow = true;
        group.add(riser);
      }
    }
    // stringers
    for (const sx of [-width / 2 + 1, width / 2 - 1]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(i2m(2), i2m(3), i2m(Math.hypot(runLen, y1 - y0))), stringerMat);
      s.position.set(i2m(x0 + sx), i2m((y0 + y1) / 2 - 2), i2m(z0 + (dirZ * runLen) / 2));
      s.rotation.x = -dirZ * Math.atan2(y1 - y0, runLen);
      s.castShadow = true;
      group.add(s);
    }
  };

  if (st.flights === 1) {
    flight(0, -st.runIn / 2, st.runIn, 0, rise, 1, st.widthIn);
  } else {
    const landD = Math.max(36, st.widthIn);
    const runEach = (st.runIn - landD) / 2;
    const half = rise / 2;
    const lane = st.widthIn / 2 + 0.5;
    flight(-lane, -st.runIn / 2, runEach, 0, half, 1, st.widthIn);
    // landing platform
    const land = new THREE.Mesh(new THREE.BoxGeometry(i2m(st.widthIn * 2 + 2), i2m(2.5), i2m(landD)), treadMat);
    land.position.set(0, i2m(half - 1.25), i2m(st.runIn / 2 - landD / 2));
    land.castShadow = true;
    land.receiveShadow = true;
    group.add(land);
    flight(lane, st.runIn / 2 - landD, runEach, half, rise, -1, st.widthIn);
  }
  return { group, clipMats };
}

function buildSlab(slab: FloorSlab, elements: PlacedElement[]): { group: THREE.Group; clipMats: THREE.Material[] } {
  const group = new THREE.Group();
  const baseY = floorBaseIn(elements, slab.floor);
  const shape = new THREE.Shape();
  slab.polygon.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.z);
    else shape.lineTo(p.x, p.z);
  });
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  // shape (x, y=worldZ) -> floor plane: rotateX(+90°) lands positions right
  // but the face points down; flipping winding via scale(y:-1) points it up
  geo.rotateX(Math.PI / 2);
  geo.scale(IN, -IN, IN);
  geo.computeVertexNormals();
  const mat = finishMaterial(slab.textureId, slab.color);
  const rep = finishRepeatPerIn(slab.textureId);
  mat.map = mat.map!.clone();
  mat.map.repeat.setScalar(rep);
  mat.map.needsUpdate = true;
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  // tiny per-slab elevation jitter: adjoining fills that share a dividing
  // line overlap by an inch or two — keep them from z-fighting
  let h = 0;
  for (const c of slab.id) h = (h * 31 + c.charCodeAt(0)) % 7;
  mesh.position.y = i2m(baseY + 0.3 + h * 0.05);
  mesh.receiveShadow = true;
  group.add(mesh);
  return { group, clipMats: [] };
}
