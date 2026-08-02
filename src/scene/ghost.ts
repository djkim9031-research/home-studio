import * as THREE from 'three';
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { COLORS, i2m } from '../constants';
import { formatFeetInchesFull } from '../core/format';
import { wallDir, wallLen, wallPointAt } from '../core/validity';
import type { GhostState } from '../state/store';
import { floorBaseIn, type PlacedElement, type Wall } from '../types';
import { makeChip, setChipText } from './chips';

/** Translucent previews for the build tools + their dimension chips. */
export class GhostVisual {
  private parent: THREE.Group;
  private group = new THREE.Group();
  private validMat = new THREE.MeshStandardMaterial({
    color: COLORS.brass,
    transparent: true,
    opacity: 0.45,
    roughness: 0.8,
    depthWrite: false,
  });
  private invalidMat = this.validMat.clone();
  private anchorMat = new THREE.MeshStandardMaterial({ color: 0xd53a2a, emissive: 0x8a1a10, roughness: 0.5, depthTest: false });
  private lenChip = makeChip('chip dim-chip');
  private endChipA = makeChip('chip dim-chip');
  private endChipB = makeChip('chip dim-chip');

  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.invalidMat.color.setHex(COLORS.invalid);
    parent.add(this.group);
    this.lenChip.visible = false;
    this.endChipA.visible = false;
    this.endChipB.visible = false;
    parent.add(this.lenChip, this.endChipA, this.endChipB);
  }

  update(ghost: GhostState | null, elements: PlacedElement[], anchor?: { x: number; y: number; z: number } | null): void {
    // rebuild the preview mesh set from scratch (cheap at ghost scale)
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
    }
    this.lenChip.visible = false;
    this.endChipA.visible = false;
    this.endChipB.visible = false;

    // finetuner anchor: a red diamond marking the corner the offsets measure from
    if (anchor) {
      const geo = new THREE.OctahedronGeometry(i2m(6));
      const m = new THREE.Mesh(geo, this.anchorMat);
      m.position.set(i2m(anchor.x), i2m(anchor.y + 6), i2m(anchor.z));
      m.renderOrder = 999;
      this.group.add(m);
    }

    if (!ghost) return;

    const mat = ghost.valid ? this.validMat : this.invalidMat;

    if (ghost.kind === 'wall') {
      const baseY = floorBaseIn(elements, ghost.floor);
      let cx = 0;
      let cz = 0;
      let count = 0;
      for (const run of ghost.runs) {
        const len = Math.hypot(run.b.x - run.a.x, run.b.z - run.a.z);
        if (len < 0.5) continue;
        const geo = new THREE.BoxGeometry(i2m(len), i2m(ghost.heightIn), i2m(ghost.thickIn));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(i2m((run.a.x + run.b.x) / 2), i2m(baseY + ghost.heightIn / 2), i2m((run.a.z + run.b.z) / 2));
        mesh.rotation.y = -Math.atan2(run.b.z - run.a.z, run.b.x - run.a.x);
        this.group.add(mesh);
        cx += (run.a.x + run.b.x) / 2;
        cz += (run.a.z + run.b.z) / 2;
        count += 1;
      }
      if (ghost.label && count) {
        this.showChip(this.lenChip, ghost.label, cx / count, baseY + ghost.heightIn + 8, cz / count);
      }
      return;
    }

    if (ghost.kind === 'opening') {
      const wall = elements.find((e): e is Wall => e.kind === 'wall' && e.id === ghost.wallId);
      if (!wall) return;
      const baseY = floorBaseIn(elements, wall.floor);
      const c = wallPointAt(wall, ghost.centerIn);
      const geo = new THREE.BoxGeometry(i2m(ghost.widthIn), i2m(ghost.heightIn), i2m(wall.thickIn + 2));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(i2m(c.x), i2m(baseY + ghost.sillIn + ghost.heightIn / 2), i2m(c.z));
      mesh.rotation.y = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
      this.group.add(mesh);
      // distance readouts from BOTH wall ends to the opening edges
      const len = wallLen(wall);
      const dA = ghost.centerIn - ghost.widthIn / 2;
      const dB = len - ghost.centerIn - ghost.widthIn / 2;
      const y = baseY + wall.heightIn + 8;
      this.showChip(this.endChipA, formatFeetInchesFull(Math.max(0, dA)), wall.a.x, y, wall.a.z);
      this.showChip(this.endChipB, formatFeetInchesFull(Math.max(0, dB)), wall.b.x, y, wall.b.z);
      return;
    }

    if (ghost.kind === 'stair') {
      const baseY = floorBaseIn(elements, ghost.floor);
      const geo = new THREE.BoxGeometry(
        i2m(ghost.flights === 2 ? ghost.widthIn * 2 + 2 : ghost.widthIn),
        i2m(4),
        i2m(ghost.runIn),
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(i2m(ghost.x), i2m(baseY + 2), i2m(ghost.z));
      mesh.rotation.y = -ghost.yawDeg * (Math.PI / 180);
      this.group.add(mesh);
      this.showChip(this.lenChip, `${formatFeetInchesFull(ghost.runIn)} run`, ghost.x, baseY + 24, ghost.z);
      return;
    }

    if (ghost.kind === 'region') {
      const shape = new THREE.Shape();
      ghost.polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z)));
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2);
      geo.scale(i2m(1), -i2m(1), i2m(1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = i2m(floorBaseIn(elements, ghost.floor) + 1);
      this.group.add(mesh);
    }

    if (ghost.kind === 'patch') {
      const wall = elements.find((e): e is Wall => e.kind === 'wall' && e.id === ghost.wallId);
      if (!wall) return;
      const baseY = floorBaseIn(elements, wall.floor);
      const d = wallDir(wall);
      const sign = ghost.face === 'pos' ? 1 : -1;
      const nrm = { x: -d.z * sign, z: d.x * sign };
      const mid = wallPointAt(wall, (ghost.fromT + ghost.toT) / 2);
      const off = wall.thickIn / 2 + 0.6;
      const geo = new THREE.PlaneGeometry(i2m(ghost.toT - ghost.fromT), i2m(ghost.y1 - ghost.y0));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(i2m(mid.x + nrm.x * off), i2m(baseY + (ghost.y0 + ghost.y1) / 2), i2m(mid.z + nrm.z * off));
      mesh.rotation.y = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x) + (ghost.face === 'pos' ? 0 : Math.PI);
      this.group.add(mesh);
    }

    if (ghost.kind === 'facegroup') {
      // preview the whole continuous patch: a translucent decal on each face
      for (const f of ghost.faces) {
        const wall = elements.find((e): e is Wall => e.kind === 'wall' && e.id === f.wallId);
        if (!wall) continue;
        const baseY = floorBaseIn(elements, wall.floor);
        const d = wallDir(wall);
        const sign = f.face === 'pos' ? 1 : -1;
        const nrm = { x: -d.z * sign, z: d.x * sign };
        const mid = wallPointAt(wall, (f.fromT + f.toT) / 2);
        const off = wall.thickIn / 2 + 0.6;
        const geo = new THREE.PlaneGeometry(i2m(f.toT - f.fromT), i2m(f.y1 - f.y0));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(i2m(mid.x + nrm.x * off), i2m(baseY + (f.y0 + f.y1) / 2), i2m(mid.z + nrm.z * off));
        mesh.rotation.y = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x) + (f.face === 'pos' ? 0 : Math.PI);
        this.group.add(mesh);
      }
    }
  }

  private showChip(chip: CSS2DObject, text: string, xIn: number, yIn: number, zIn: number): void {
    setChipText(chip, text);
    chip.position.set(i2m(xIn), i2m(yIn), i2m(zIn));
    chip.visible = true;
  }
}
