import * as THREE from 'three';
import { i2m, IN } from '../constants';
import { detectEnclosedRegions } from '../core/regionFill';
import { floorBaseIn, storyHeightIn, type FloorIndex, type PlacedElement } from '../types';

const FLOORS: FloorIndex[] = [-1, 0, 1, 2];

/**
 * Automatic flat ceilings: every fully-enclosed area gets one at the top of
 * its walls, so sunlight only enters through door and window openings.
 * Face-down geometry — invisible from above (you keep building) but visible
 * from inside; `shadowSide: DoubleSide` makes it block the sun regardless.
 * Styling gets its own pass later.
 */
export class Ceilings {
  private parent: THREE.Group;
  private groups = new Map<FloorIndex, THREE.Group>();
  private keys = new Map<FloorIndex, string>();
  private mat: THREE.MeshStandardMaterial;
  private matAbove: THREE.MeshStandardMaterial;

  constructor(parent: THREE.Group) {
    this.parent = parent;
    // the floor you're building on: ceiling faces down only, so it's invisible
    // from above and you can keep working
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      roughness: 0.95,
      metalness: 0,
      side: THREE.FrontSide,
      shadowSide: THREE.DoubleSide,
    });
    // a floor BELOW the one you're viewing: a solid white cap visible from above
    // too, so the lower storey reads as enclosed until a real upper floor is built
    this.matAbove = new THREE.MeshStandardMaterial({
      color: 0xfbfaf7,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
    });
    for (const f of FLOORS) {
      const g = new THREE.Group();
      g.userData.floor = f;
      g.userData.ceiling = true;
      parent.add(g);
      this.groups.set(f, g);
    }
  }

  /** Floors above the active one hide with the rest of the build. A floor BELOW
   * the active one shows a solid white ceiling from above (it's enclosed now);
   * the active floor's own ceiling stays down-facing so you can keep building. */
  applyVisibility(activeFloor: FloorIndex): void {
    for (const [f, g] of this.groups) {
      g.visible = f <= activeFloor;
      const m = f < activeFloor ? this.matAbove : this.mat;
      for (const child of g.children) (child as THREE.Mesh).material = m;
    }
  }

  /** Rebuild changed floors (keyed on that floor's wall geometry). */
  sync(elements: PlacedElement[]): boolean {
    let changed = false;
    for (const f of FLOORS) {
      const wallKey = JSON.stringify(
        elements
          .filter((e) => e.kind === 'wall' && e.floor === f)
          .map((w) => (w.kind === 'wall' ? [w.a, w.b, w.thickIn, w.heightIn] : null)),
      );
      if (this.keys.get(f) === wallKey) continue;
      this.keys.set(f, wallKey);
      changed = true;
      const group = this.groups.get(f)!;
      for (const child of [...group.children]) {
        group.remove(child);
        (child as THREE.Mesh).geometry?.dispose();
      }
      const regions = detectEnclosedRegions(elements, f);
      if (!regions.length) continue;
      const y = i2m(floorBaseIn(elements, f) + storyHeightIn(elements, f) - 0.3);
      for (const polygon of regions) {
        const shape = new THREE.Shape();
        polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z)));
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        // rotate onto the floor plane FACING DOWN (normal −y): visible only
        // from below. rotateX(+90°) alone yields a down-facing plane.
        geo.rotateX(Math.PI / 2);
        geo.scale(IN, IN, IN);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, this.mat);
        mesh.position.y = y;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    return changed;
  }
}
