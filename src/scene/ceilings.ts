import * as THREE from 'three';
import { i2m, IN, JOIST_T } from '../constants';
import { pointInPolygon } from '../core/geometry';
import { detectEnclosedRegions } from '../core/regionFill';
import { stairFootprint } from '../core/validity';
import { floorBaseIn, storyHeightIn, type FloorIndex, type PlacedElement, type Stair } from '../types';

const FLOORS: FloorIndex[] = [-1, 0, 1, 2];

/**
 * Automatic inter-floor slabs. Every fully-enclosed area gets a SOLID slab
 * filling the structural band between its wall tops and the next storey's floor
 * (thickness = JOIST_T). One slab does two jobs: it is the ceiling of the room
 * below and the floor of the storey above, so stacked floors read as one solid
 * stack with no see-through gap, and — being solid with `shadowSide: DoubleSide`
 * — it blocks sunlight from leaking between storeys.
 *
 * Only floors BELOW the one you're viewing show their slab (so the lower storey
 * reads as enclosed and you have a floor to stand on upstairs). The floor you're
 * actively building stays open to the sky until a storey is added above it.
 */
export class Ceilings {
  private groups = new Map<FloorIndex, THREE.Group>();
  private keys = new Map<FloorIndex, string>();
  private mat: THREE.MeshStandardMaterial;

  constructor(parent: THREE.Group) {
    // solid, light-sealing, visible from every side (it's a real floor/ceiling)
    this.mat = new THREE.MeshStandardMaterial({
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

  /** Show a storey's slab only when you're viewing a floor ABOVE it — the lower
   * storey is then enclosed and its slab is the floor you stand on. The active
   * floor (and anything above) stays open so you can keep building. */
  applyVisibility(activeFloor: FloorIndex): void {
    for (const [f, g] of this.groups) g.visible = f < activeFloor;
  }

  /** Rebuild changed floors (keyed on that floor's wall geometry). */
  sync(elements: PlacedElement[]): boolean {
    let changed = false;
    for (const f of FLOORS) {
      // stairs on this floor punch a stairwell through its slab, so key on them too
      const stairs = elements.filter((e): e is Stair => e.kind === 'stair' && e.floor === f);
      const wallKey = JSON.stringify([
        elements
          .filter((e) => e.kind === 'wall' && e.floor === f)
          .map((w) => (w.kind === 'wall' ? [w.a, w.b, w.thickIn, w.heightIn] : null)),
        stairs.map((s) => [s.x, s.z, s.yawDeg, s.widthIn, s.runIn, s.flights]),
      ]);
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
      // top of the slab = the storey above's finished floor; it extrudes DOWN by
      // JOIST_T so its underside sits flush with this storey's wall tops.
      const top = i2m(floorBaseIn(elements, f) + storyHeightIn(elements, f) + JOIST_T);
      for (const polygon of regions) {
        const shape = new THREE.Shape();
        polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z)));
        shape.closePath();
        // a stair rising out of this room needs a stairwell: cut its footprint
        // out of the slab so it doesn't seal the flight into a solid floor above
        for (const st of stairs) {
          if (!pointInPolygon({ x: st.x, z: st.z }, polygon)) continue;
          const fp = stairFootprint(st);
          const hole = new THREE.Path();
          fp.forEach((p, i) => (i === 0 ? hole.moveTo(p.x, p.z) : hole.lineTo(p.x, p.z)));
          hole.closePath();
          shape.holes.push(hole);
        }
        const geo = new THREE.ExtrudeGeometry(shape, { depth: JOIST_T, bevelEnabled: false });
        // shape is in the XY plane extruded along +Z; rotateX(+90°) lays it into
        // the XZ plane with the extrude running DOWN (−Y) from the mesh origin.
        geo.rotateX(Math.PI / 2);
        geo.scale(IN, IN, IN);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, this.mat);
        mesh.position.y = top;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    return changed;
  }
}
