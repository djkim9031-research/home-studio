import * as THREE from 'three';
import {
  brickTexture,
  carpetTexture,
  concreteTexture,
  oakPlankTexture,
  paintTexture,
  plasterTexture,
  tileTexture,
  woodPanelTexture,
} from '../scene/textures';

/** A surface finish (wall or floor). Adding one later = one record here. */
export interface FinishDef {
  id: string;
  label: string;
  /** world inches covered by one texture repeat */
  tileIn: number;
  make(): THREE.CanvasTexture;
  rough: number;
}

/** A construction style (door / window / stair). Geometry variants live in
 * elementMeshes builders keyed by this id. */
export interface StyleDef {
  id: string;
  label: string;
}

export const WALL_TEXTURES: FinishDef[] = [
  { id: 'paint', label: 'Paint', tileIn: 32, make: paintTexture, rough: 0.92 },
  { id: 'plaster', label: 'Plaster', tileIn: 32, make: plasterTexture, rough: 0.95 },
  { id: 'brick', label: 'Brick', tileIn: 32, make: brickTexture, rough: 0.9 },
  { id: 'woodPanel', label: 'Wood panel', tileIn: 32, make: woodPanelTexture, rough: 0.72 },
];

export const FLOOR_TEXTURES: FinishDef[] = [
  { id: 'oakPlank', label: 'Oak plank', tileIn: 48, make: oakPlankTexture, rough: 0.62 },
  { id: 'tile', label: 'Tile', tileIn: 48, make: tileTexture, rough: 0.35 },
  { id: 'carpet', label: 'Carpet', tileIn: 32, make: carpetTexture, rough: 1 },
  { id: 'concrete', label: 'Concrete', tileIn: 64, make: concreteTexture, rough: 0.8 },
];

export const DOOR_STYLES: StyleDef[] = [
  { id: 'panel', label: 'Panel' },
  { id: 'glass', label: 'Glass' },
  { id: 'sliding', label: 'Sliding' },
];

export const WINDOW_STYLES: StyleDef[] = [
  { id: 'singleHung', label: 'Single-hung' },
  { id: 'casement', label: 'Casement' },
  { id: 'picture', label: 'Picture' },
];

export const STAIR_STYLES: StyleDef[] = [
  { id: 'openStraight', label: 'Open riser' },
  { id: 'closedRiser', label: 'Closed riser' },
];

const finishById = new Map<string, FinishDef>();
for (const f of [...WALL_TEXTURES, ...FLOOR_TEXTURES]) finishById.set(f.id, f);

const baseCache = new Map<string, THREE.MeshStandardMaterial>();

function baseMaterial(finishId: string): THREE.MeshStandardMaterial {
  let m = baseCache.get(finishId);
  if (!m) {
    const def = finishById.get(finishId) ?? WALL_TEXTURES[0];
    m = new THREE.MeshStandardMaterial({ map: def.make(), roughness: def.rough, metalness: 0 });
    baseCache.set(finishId, m);
  }
  return m;
}

/** Per-element material: shared texture, own color tint (and later clip planes). */
export function finishMaterial(finishId: string, colorHex: string): THREE.MeshStandardMaterial {
  const m = baseMaterial(finishId).clone();
  m.color.set(colorHex || '#ffffff');
  return m;
}

/** Texture repeat scale for a finish, repeats per world inch. */
export function finishRepeatPerIn(finishId: string): number {
  const def = finishById.get(finishId);
  return 1 / (def?.tileIn ?? 32);
}
