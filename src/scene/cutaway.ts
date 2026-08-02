import * as THREE from 'three';
import { CUTAWAY_H, i2m } from '../constants';
import * as store from '../state/store';
import { floorBaseIn, type Vec2, type Wall } from '../types';
import type { ElementMeshes } from './elementMeshes';

const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Sims-style wall cutaway: active-floor walls between the camera and the room
 * lower to sill height (a clipping plane per wall material) so you can see
 * inside, while the far walls stand. Openings carried by a lowered wall clip
 * with it. Toggling "Full walls" clears every plane.
 */
export class CutawayController {
  private meshes: ElementMeshes;
  private lastKey = '';

  constructor(meshes: ElementMeshes) {
    this.meshes = meshes;
  }

  /** Element meshes were rebuilt (fresh materials) — re-stamp on next update. */
  invalidate(): void {
    this.lastKey = '';
  }

  /** Call whenever the camera settles or state changes; cheap when nothing moved. */
  update(cameraPos: THREE.Vector3): boolean {
    const s = store.getState();
    const walls = s.elements.filter((e): e is Wall => e.kind === 'wall' && e.floor === s.activeFloor);
    const lowered = new Set<string>();

    if (s.cutaway && walls.length) {
      const centroid = wallsCentroid(walls);
      const cam = { x: cameraPos.x / i2m(1), z: cameraPos.z / i2m(1) };
      const cd = norm({ x: cam.x - centroid.x, z: cam.z - centroid.z });
      for (const w of walls) {
        const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
        const off = { x: mid.x - centroid.x, z: mid.z - centroid.z };
        const dist = Math.hypot(off.x, off.z);
        if (dist < 24) continue; // walls at the heart of the plan stay up
        const v = { x: off.x / dist, z: off.z / dist };
        if (v.x * cd.x + v.z * cd.z > 0.1) lowered.add(w.id);
      }
    }

    // quantize to a change key so orbiting doesn't thrash materials
    const key = `${s.cutaway}|${s.activeFloor}|${[...lowered].sort().join(',')}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;

    const clipY = i2m(floorBaseIn(s.elements, s.activeFloor) + CUTAWAY_H);
    const plane = new THREE.Plane(DOWN, clipY);

    const carriedBy = new Map<string, string>(); // opening id -> wall id
    for (const e of s.elements) {
      if (e.kind === 'door' || e.kind === 'window') carriedBy.set(e.id, e.wallId);
    }

    for (const [id] of this.meshes.allEntries()) {
      const wallId = carriedBy.get(id) ?? id;
      const lower = lowered.has(wallId);
      for (const mat of this.meshes.clipMats(id)) {
        mat.clippingPlanes = lower ? [plane] : [];
        // the cutaway is VISUAL only — a lowered wall still shades at full
        // height, so sunlight enters strictly through panes and openings
        mat.clipShadows = false;
        mat.needsUpdate = true;
      }
    }
    return true;
  }
}

function wallsCentroid(walls: Wall[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const w of walls) {
    x += (w.a.x + w.b.x) / 2;
    z += (w.a.z + w.b.z) / 2;
  }
  return { x: x / walls.length, z: z / walls.length };
}

function norm(v: Vec2): Vec2 {
  const d = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / d, z: v.z / d };
}
