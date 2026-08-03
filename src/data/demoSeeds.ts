import type { HomeProject, PlacedElement } from '../types';
import { newProject } from '../state/projects';

let n = 0;
const id = (): string => `seed${(n += 1)}`;

const wall = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
  floor: -1 | 0 | 1 | 2 = 0,
  heightIn = 96,
  textureId = 'paint',
  color = '#f2eee6',
): PlacedElement => ({ kind: 'wall', id: id(), floor, a: { x: ax, z: az }, b: { x: bx, z: bz }, heightIn, thickIn: 5, textureId, color });

/** 16' × 12' room with a door, two windows and an oak floor. */
export function seedRoom(): HomeProject {
  n = 0;
  const p = newProject('Seed Room', { dwelling: 'home', floors: 2, basement: false });
  const W = 192;
  const D = 144;
  const south = wall(0, 0, W, 0);
  const east = wall(W, 0, W, D);
  const north = wall(W, D, 0, D, 0, 96, 'brick', '#d8a087');
  const west = wall(0, D, 0, 0);
  p.elements = [
    south,
    east,
    north,
    west,
    { kind: 'door', id: id(), floor: 0, wallId: south.id, centerIn: 48, widthIn: 36, heightIn: 82, sillIn: 0, styleId: 'panel', color: '#e8e2d4' },
    { kind: 'window', id: id(), floor: 0, wallId: south.id, centerIn: 138, widthIn: 48, heightIn: 48, sillIn: 36, styleId: 'singleHung', color: '#f5f2ea' },
    { kind: 'window', id: id(), floor: 0, wallId: east.id, centerIn: 72, widthIn: 36, heightIn: 48, sillIn: 36, styleId: 'casement', color: '#f5f2ea' },
    {
      kind: 'slab',
      id: id(),
      floor: 0,
      polygon: [
        { x: 3, z: 3 },
        { x: W - 3, z: 3 },
        { x: W - 3, z: D - 3 },
        { x: 3, z: D - 3 },
      ],
      textureId: 'oakPlank',
      color: '#ffffff',
    },
    {
      kind: 'room',
      id: id(),
      floor: 0,
      polygon: [
        { x: 3, z: 3 },
        { x: 189, z: 3 },
        { x: 189, z: 141 },
        { x: 3, z: 141 },
      ],
      name: 'Living room',
      color: '#b08d57',
    },
  ];
  return p;
}

/** The room plus a straight stair and a partial second floor. */
export function seedTwoFloor(): HomeProject {
  const p = seedRoom();
  p.name = 'Seed Two-Floor';
  const up1 = wall(0, 0, 192, 0, 1);
  const up2 = wall(192, 0, 192, 96, 1);
  const up3 = wall(192, 96, 0, 96, 1, 96, 'woodPanel', '#e6d9be');
  const up4 = wall(0, 96, 0, 0, 1);
  p.elements.push(
    { kind: 'stair', id: id(), floor: 0, x: 96, z: 48, yawDeg: 90, widthIn: 36, runIn: 132, flights: 1, styleId: 'openStraight', textureId: 'oakPlank', color: '#ffffff' },
    up1,
    up2,
    up3,
    up4,
    { kind: 'window', id: id(), floor: 1, wallId: up3.id, centerIn: 96, widthIn: 60, heightIn: 42, sillIn: 40, styleId: 'picture', color: '#f5f2ea' },
    {
      kind: 'slab',
      id: id(),
      floor: 1,
      polygon: [
        { x: 3, z: 3 },
        { x: 189, z: 3 },
        { x: 189, z: 93 },
        { x: 3, z: 93 },
      ],
      textureId: 'carpet',
      color: '#ffffff',
    },
  );
  return p;
}
