import * as THREE from 'three';
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { COLORS, i2m } from '../constants';
import { formatFeetInchesFull } from '../core/format';
import { wallLen, wallPointAt } from '../core/validity';
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

  update(ghost: GhostState | null, elements: PlacedElement[]): void {
    // rebuild the preview mesh set from scratch (cheap at ghost scale)
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
    }
    this.lenChip.visible = false;
    this.endChipA.visible = false;
    this.endChipB.visible = false;
    if (!ghost) return;

    const mat = ghost.valid ? this.validMat : this.invalidMat;

    if (ghost.kind === 'wall') {
      const len = Math.hypot(ghost.b.x - ghost.a.x, ghost.b.z - ghost.a.z);
      if (len < 0.5) return;
      const baseY = floorBaseIn(elements, ghost.floor);
      const geo = new THREE.BoxGeometry(i2m(len), i2m(ghost.heightIn), i2m(ghost.thickIn));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(i2m((ghost.a.x + ghost.b.x) / 2), i2m(baseY + ghost.heightIn / 2), i2m((ghost.a.z + ghost.b.z) / 2));
      mesh.rotation.y = -Math.atan2(ghost.b.z - ghost.a.z, ghost.b.x - ghost.a.x);
      this.group.add(mesh);
      this.showChip(this.lenChip, formatFeetInchesFull(len), (ghost.a.x + ghost.b.x) / 2, baseY + ghost.heightIn + 8, (ghost.a.z + ghost.b.z) / 2);
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
  }

  private showChip(chip: CSS2DObject, text: string, xIn: number, yIn: number, zIn: number): void {
    setChipText(chip, text);
    chip.position.set(i2m(xIn), i2m(yIn), i2m(zIn));
    chip.visible = true;
  }
}
