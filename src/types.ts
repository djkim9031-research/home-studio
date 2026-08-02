import { DEFAULT_WALL_H, JOIST_T } from './constants';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose {
  x: number;
  z: number;
  yawDeg: number;
}

export type FloorIndex = -1 | 0 | 1 | 2; // -1 = basement, 0 = ground
export type Mode = 'build' | 'interior';
export type BuildCategory = 'walls' | 'openings' | 'stairs' | 'flooring';

interface ElementBase {
  id: string;
  floor: FloorIndex;
  /** '#rrggbb' tint multiplied over the finish texture */
  color: string;
}

export interface Wall extends ElementBase {
  kind: 'wall';
  a: Vec2; // endpoints, inches
  b: Vec2;
  heightIn: number;
  thickIn: number;
  textureId: string; // wall-texture registry id
}

/** A door or window carried by a wall; depth is implicitly the wall's thickness. */
export interface Opening extends ElementBase {
  kind: 'door' | 'window';
  wallId: string;
  /** offset of the opening CENTER from wall endpoint `a`, along the wall */
  centerIn: number;
  widthIn: number;
  heightIn: number;
  /** bottom of the opening above the floor: doors 0, windows default 36 */
  sillIn: number;
  styleId: string;
}

export interface Stair extends ElementBase {
  kind: 'stair';
  x: number;
  z: number;
  yawDeg: number;
  widthIn: number;
  /** total horizontal run (both flights + landing when flights = 2) */
  runIn: number;
  flights: 1 | 2;
  styleId: string;
  /** tread finish — floor-texture registry id */
  textureId: string;
}

export interface FloorSlab extends ElementBase {
  kind: 'slab';
  polygon: Vec2[]; // enclosed region, inches
  textureId: string; // floor-texture registry id
}

export type PlacedElement = Wall | Opening | Stair | FloorSlab;
export type ElementKind = PlacedElement['kind'];

export const categoryOf = (e: PlacedElement): BuildCategory =>
  e.kind === 'wall' ? 'walls' : e.kind === 'stair' ? 'stairs' : e.kind === 'slab' ? 'flooring' : 'openings';

export const MODE_CATEGORIES: Record<Mode, BuildCategory[]> = {
  build: ['walls', 'openings', 'stairs', 'flooring'],
  interior: [], // furniture categories arrive with interior mode
};

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** Tallest wall on a floor (the story height), defaulting to 8'. */
export function storyHeightIn(elements: PlacedElement[], floor: FloorIndex): number {
  let h = 0;
  for (const e of elements) if (e.kind === 'wall' && e.floor === floor) h = Math.max(h, e.heightIn);
  return h || DEFAULT_WALL_H;
}

/** Elevation of a floor's finished floor above grade, inches. */
export function floorBaseIn(elements: PlacedElement[], floor: FloorIndex): number {
  if (floor === -1) return -(storyHeightIn(elements, -1) + JOIST_T);
  let y = 0;
  for (let f = 0; f < floor; f++) y += storyHeightIn(elements, f as FloorIndex) + JOIST_T;
  return y;
}

// ---------------------------------------------------------------------------
// Project envelope
// ---------------------------------------------------------------------------

export type DwellingType = 'home' | 'townhome' | 'apartment' | 'duplex';

/** Intake facts — all optional; kept for future analytics. */
export interface HomeMeta {
  dwelling?: DwellingType;
  garageCars?: number; // 0 = no garage
  sqft?: number;
  households?: number;
  basement?: boolean;
  floors?: 1 | 2 | 3;
}

export interface HomeProject {
  id: string;
  name: string;
  meta: HomeMeta;
  elements: PlacedElement[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  version: 1;
  kind: 'home-studio-project';
  project: HomeProject;
}
