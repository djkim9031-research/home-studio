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
  private shadowMat: THREE.MeshStandardMaterial;

  constructor(parent: THREE.Group) {
    // a floor BELOW the active one: a solid, light-sealing slab, visible from every
    // side (it's the real floor you stand on upstairs / the ceiling of the room below)
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xfbfaf7,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
    });
    // the ACTIVE floor's own ceiling: faces DOWN only, so it's invisible from above
    // (you keep building and looking in) yet `shadowSide: DoubleSide` still blocks the
    // sun — so an enclosed, windowless room sits in shadow instead of catching rays.
    this.shadowMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      roughness: 0.95,
      metalness: 0,
      side: THREE.FrontSide,
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

  /** A floor BELOW the active one shows its solid slab (the enclosed storey's
   * finished floor). The ACTIVE floor shows its down-facing shadow ceiling —
   * invisible from above so you keep building, but it blocks the sun so sealed
   * rooms stay dark. Floors above are hidden entirely. */
  applyVisibility(activeFloor: FloorIndex): void {
    for (const [f, g] of this.groups) {
      g.visible = f <= activeFloor;
      const want = f < activeFloor ? 'slab' : 'shadowCeil';
      for (const child of g.children) child.visible = child.userData.role === want;
    }
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
      // dilate generously so the slab/ceiling reaches past the wall centrelines and
      // fully seals the room (paint uses a tighter region; only stairs cut holes)
      const regions = detectEnclosedRegions(elements, f, 4);
      if (!regions.length) continue;
      const wallTop = floorBaseIn(elements, f) + storyHeightIn(elements, f);
      // top of the slab = the storey above's finished floor; it extrudes DOWN by
      // JOIST_T so its underside sits flush with this storey's wall tops.
      const slabTop = i2m(wallTop + JOIST_T);
      const ceilY = i2m(wallTop - 0.3); // the active floor's down-facing shadow ceiling
      for (const polygon of regions) {
        const shape = new THREE.Shape();
        polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z)));
        shape.closePath();
        // a stair rising out of this room needs a stairwell: cut its footprint out
        // so neither the slab nor the ceiling seals the flight or blocks its light
        for (const st of stairs) {
          if (!pointInPolygon({ x: st.x, z: st.z }, polygon)) continue;
          const fp = stairFootprint(st);
          const hole = new THREE.Path();
          fp.forEach((p, i) => (i === 0 ? hole.moveTo(p.x, p.z) : hole.lineTo(p.x, p.z)));
          hole.closePath();
          shape.holes.push(hole);
        }

        // (1) solid inter-floor slab — shown when this floor is BELOW the active one
        const slab = new THREE.ExtrudeGeometry(shape, { depth: JOIST_T, bevelEnabled: false });
        // shape is in the XY plane extruded along +Z; rotateX(+90°) lays it into
        // the XZ plane with the extrude running DOWN (−Y) from the mesh origin.
        slab.rotateX(Math.PI / 2);
        slab.scale(IN, IN, IN);
        slab.computeVertexNormals();
        const slabMesh = new THREE.Mesh(slab, this.mat);
        slabMesh.position.y = slabTop;
        slabMesh.castShadow = true;
        slabMesh.receiveShadow = true;
        slabMesh.userData.role = 'slab';
        group.add(slabMesh);

        // (2) thin down-facing shadow ceiling — shown when this IS the active floor;
        // invisible from above but casts the sun's shadow so sealed rooms go dark
        const ceil = new THREE.ShapeGeometry(shape);
        ceil.rotateX(Math.PI / 2); // face DOWN (normal −y)
        ceil.scale(IN, IN, IN);
        ceil.computeVertexNormals();
        const ceilMesh = new THREE.Mesh(ceil, this.shadowMat);
        ceilMesh.position.y = ceilY;
        ceilMesh.castShadow = true;
        ceilMesh.receiveShadow = true;
        ceilMesh.userData.role = 'shadowCeil';
        group.add(ceilMesh);
      }
    }
    return changed;
  }
}
