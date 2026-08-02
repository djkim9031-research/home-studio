import * as THREE from 'three';
import { JOIST_T, WALL_T, i2m } from '../constants';
import type { House, StoryPlan, Vec2 } from '../types';
import { floorWoodTextures } from './textures';

export interface BuiltShell {
  group: THREE.Group;
  /** world-inch walk polygons per story key ('0','1','2','basement') */
  walkAreas: Map<string, Vec2[]>;
  /** world-inch center + half span for camera framing */
  center: Vec2;
  halfSpanIn: number;
  /** per-story groups for visibility toggles */
  storyGroups: Map<string, THREE.Group>;
  setPlanUnderlay(on: boolean): void;
}

interface StoryGeom {
  key: string;
  plan: StoryPlan;
  baseY: number; // floor level, inches
}

const DOOR_H = 82;
const WINDOW_SILL = 36;
const WINDOW_HEAD = 82;

/** px → world inches, centered on story-1's boundary centroid. */
function makeMapper(plan: StoryPlan, center: Vec2): (p: Vec2) => Vec2 {
  const s = plan.inPerPx;
  return (p) => ({ x: p.x * s - center.x, z: p.z * s - center.z });
}

function centroidPx(plan: StoryPlan): Vec2 {
  const b = plan.boundaryPx;
  if (!b.length) return { x: plan.imageW / 2, z: plan.imageH / 2 };
  return {
    x: (b.reduce((a, p) => a + p.x, 0) / b.length) * plan.inPerPx,
    z: (b.reduce((a, p) => a + p.z, 0) / b.length) * plan.inPerPx,
  };
}

/** Extrude one traced story into floor + walls (+ opening gaps). */
function buildStory(
  geom: StoryGeom,
  center: Vec2,
  underlays: { mesh: THREE.Mesh; woodMat: THREE.Material; planMat: THREE.Material | null }[],
): { group: THREE.Group; polyIn: Vec2[] } {
  const { plan, baseY } = geom;
  const map = makeMapper(plan, center);
  const poly = plan.boundaryPx.map(map);
  const group = new THREE.Group();

  // --- floor: boundary shape, wood by default, plan raster as an underlay option
  const shape = new THREE.Shape();
  poly.forEach((p, i) => {
    if (i === 0) shape.moveTo(i2m(p.x), i2m(p.z));
    else shape.lineTo(i2m(p.x), i2m(p.z));
  });
  shape.closePath();
  const floorGeo = new THREE.ShapeGeometry(shape);
  // shape (x, y=worldZ) -> floor plane: rotateX(+90°) lands positions right
  // but the face points down; flipping winding via scale(y:-1) points it up
  floorGeo.rotateX(Math.PI / 2);
  floorGeo.scale(1, -1, 1);
  floorGeo.computeVertexNormals();

  const wood = floorWoodTextures();
  wood.map.repeat.setScalar(1 / i2m(128));
  wood.roughnessMap.repeat.copy(wood.map.repeat);
  const woodMat = new THREE.MeshStandardMaterial({
    map: wood.map,
    roughnessMap: wood.roughnessMap,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide, // trace winding varies with drawing direction
  });
  let planMat: THREE.MeshStandardMaterial | null = null;
  if (plan.imageData) {
    const tex = new THREE.TextureLoader().load(plan.imageData);
    tex.colorSpace = THREE.SRGBColorSpace;
    // ShapeGeometry UVs are in shape (meter) space: map image extents onto it
    const w = plan.imageW * plan.inPerPx;
    const h = plan.imageH * plan.inPerPx;
    tex.repeat.set(1 / i2m(w), -1 / i2m(h));
    tex.offset.set(center.x / w, 1 - center.z / h);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    planMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  }
  const floor = new THREE.Mesh(floorGeo, woodMat);
  floor.position.y = i2m(baseY);
  floor.receiveShadow = true;
  group.add(floor);
  underlays.push({ mesh: floor, woodMat, planMat });

  // --- walls: boundary segments + interior runs as boxes with opening gaps
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.92, metalness: 0 });
  const openings = plan.openingsPx.map((o) => ({ ...map(o), widthIn: o.widthIn, door: o.door }));

  const addWallSeg = (a: Vec2, b: Vec2, y0: number, y1: number): void => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1 || y1 <= y0) return;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(i2m(len), i2m(y1 - y0), i2m(WALL_T)), wallMat);
    wall.position.set(i2m((a.x + b.x) / 2), i2m(baseY + (y0 + y1) / 2), i2m((a.z + b.z) / 2));
    wall.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  };

  const buildRun = (a: Vec2, b: Vec2): void => {
    const H = plan.wallHeightIn;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    // openings that project onto this segment
    const cuts = openings
      .map((o) => {
        const t = (o.x - a.x) * dir.x + (o.z - a.z) * dir.z;
        const d = Math.abs((o.x - a.x) * -dir.z + (o.z - a.z) * dir.x);
        return { t, d, o };
      })
      .filter((c) => c.d < 6 && c.t > 4 && c.t < len - 4)
      .sort((p, q) => p.t - q.t);
    let cursor = 0;
    const at = (t: number): Vec2 => ({ x: a.x + dir.x * t, z: a.z + dir.z * t });
    for (const c of cuts) {
      const t0 = Math.max(cursor, c.t - c.o.widthIn / 2);
      const t1 = Math.min(len, c.t + c.o.widthIn / 2);
      if (t0 > cursor) addWallSeg(at(cursor), at(t0), 0, H);
      // header above; sill below for windows
      addWallSeg(at(t0), at(t1), c.o.door ? DOOR_H : WINDOW_HEAD, H);
      if (!c.o.door) addWallSeg(at(t0), at(t1), 0, WINDOW_SILL);
      cursor = t1;
    }
    if (cursor < len) addWallSeg(at(cursor), at(len), 0, H);
  };

  for (let i = 0; i < poly.length; i++) buildRun(poly[i], poly[(i + 1) % poly.length]);
  for (const run of plan.wallsPx) {
    const pts = run.map(map);
    for (let i = 0; i < pts.length - 1; i++) buildRun(pts[i], pts[i + 1]);
  }

  return { group, polyIn: poly };
}

/** Build the whole house shell from its traced stories. */
export function buildShell(house: House): BuiltShell | null {
  const traced = (p: StoryPlan | null): p is StoryPlan =>
    !!p && p.inPerPx > 0 && p.boundaryPx.length >= 3;
  if (!traced(house.plans[0])) return null;

  const center = centroidPx(house.plans[0]);
  const group = new THREE.Group();
  const storyGroups = new Map<string, THREE.Group>();
  const walkAreas = new Map<string, Vec2[]>();
  const underlays: { mesh: THREE.Mesh; woodMat: THREE.Material; planMat: THREE.Material | null }[] = [];

  let baseY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const add = (key: string, plan: StoryPlan, y: number): void => {
    const { group: g, polyIn } = buildStory({ key, plan, baseY: y }, center, underlays);
    group.add(g);
    storyGroups.set(key, g);
    walkAreas.set(key, polyIn);
    for (const p of polyIn) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  };

  add('0', house.plans[0], 0);
  for (let s = 1; s < house.stories; s++) {
    const plan = house.plans[s];
    if (!traced(plan)) continue;
    baseY += house.plans[s - 1].wallHeightIn + JOIST_T;
    add(String(s), plan, baseY);
  }
  if (house.basement && traced(house.basementPlan)) {
    add('basement', house.basementPlan, -(house.basementPlan.wallHeightIn + JOIST_T));
  }

  // simple ground plane so the house sits on something
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(i2m(Math.max(maxX - minX, maxZ - minZ) * 2 + 600), 48),
    new THREE.MeshStandardMaterial({ color: 0x9aa27c, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = i2m(-1);
  ground.receiveShadow = true;
  group.add(ground);

  return {
    group,
    walkAreas,
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    halfSpanIn: Math.max(maxX - minX, maxZ - minZ) / 2,
    storyGroups,
    setPlanUnderlay(on: boolean) {
      for (const u of underlays) {
        if (u.planMat) u.mesh.material = on ? u.planMat : u.woodMat;
      }
    },
  };
}
