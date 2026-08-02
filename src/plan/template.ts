import type { House, StoryPlan } from '../types';

/** Parametric starter layouts for houses without floor-plan files: a sensible
 * footprint + rooms derived from the intake facts (sqft, stories, household,
 * dwelling type, garage). Everything is written into the StoryPlan in
 * "image pixels" at 1 px = 1 inch with a generated raster, so the tracer,
 * plan-underlay, and 3D shell all treat it exactly like a traced upload. */

interface Room {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  label: string;
}

const round6 = (v: number): number => Math.max(72, Math.round(v / 6) * 6);

/** bedrooms implied by the household: couple → 1 + office, kids share */
function bedroomCount(house: House): number {
  const kids = Math.ceil(house.kids / 2);
  const extraAdults = house.adults > 2 ? 1 : 0;
  return Math.min(4, Math.max(1, 1 + kids + extraAdults));
}

function footprint(house: House): { W: number; D: number } {
  const aspect =
    house.dwelling === 'townhouse' || house.dwelling === 'duplex'
      ? 2.0
      : house.dwelling === 'apartment' || house.dwelling === 'condo'
        ? 1.45
        : 1.3;
  const areaIn2 = (house.sqft / house.stories) * 144;
  const W = round6(Math.sqrt(areaIn2 * aspect));
  const D = round6(areaIn2 / W);
  return { W, D };
}

interface Layout {
  boundary: { x: number; z: number }[];
  walls: { x: number; z: number }[][];
  openings: { x: number; z: number; widthIn: number; door: boolean }[];
  rooms: Room[];
  W: number;
  D: number;
  garage: { x0: number; z0: number; x1: number; z1: number } | null;
}

function groundFloor(house: House, W: number, D: number): Layout {
  const walls: Layout['walls'] = [];
  const openings: Layout['openings'] = [];
  const rooms: Room[] = [];
  const single = house.stories === 1;
  const beds = bedroomCount(house);

  // front door, centered on the living side of the south wall
  const livingW = single ? round6(W * 0.55) : round6(W * 0.6);
  openings.push({ x: livingW / 2, z: D, widthIn: 42, door: true });

  if (single) {
    // left: living (front) + kitchen (back); right: bedrooms + bath stack
    const zKitchen = round6(D * 0.5);
    walls.push([
      { x: livingW, z: 0 },
      { x: livingW, z: D },
    ]);
    walls.push([
      { x: 0, z: zKitchen },
      { x: livingW, z: zKitchen },
    ]);
    openings.push({ x: livingW / 2, z: zKitchen, widthIn: 60, door: true }); // wide kitchen pass
    rooms.push({ x0: 0, z0: zKitchen, x1: livingW, z1: D, label: 'Living' });
    rooms.push({ x0: 0, z0: 0, x1: livingW, z1: zKitchen, label: 'Kitchen · Dining' });

    const slots = beds + 1; // + bath
    const rightW = W - livingW;
    const slotD = D / slots;
    for (let i = 0; i < slots; i++) {
      const z0 = Math.round(i * slotD);
      const z1 = Math.round((i + 1) * slotD);
      const bath = i === slots - 1;
      rooms.push({ x0: livingW, z0, x1: W, z1, label: bath ? 'Bath' : `Bedroom ${i + 1}` });
      if (i > 0) {
        walls.push([
          { x: livingW, z: z0 },
          { x: W, z: z0 },
        ]);
      }
      openings.push({ x: livingW, z: (z0 + z1) / 2, widthIn: 32, door: true });
      if (!bath) openings.push({ x: W, z: (z0 + z1) / 2, widthIn: 48, door: false }); // window
      void rightW;
    }
  } else {
    // multi-story ground floor: living | kitchen/dining + bath
    walls.push([
      { x: livingW, z: 0 },
      { x: livingW, z: D },
    ]);
    const zBath = round6(D * 0.35);
    walls.push([
      { x: livingW, z: zBath },
      { x: W, z: zBath },
    ]);
    openings.push({ x: livingW, z: (zBath + D) / 2, widthIn: 60, door: true });
    openings.push({ x: livingW, z: zBath / 2, widthIn: 32, door: true });
    rooms.push({ x0: 0, z0: 0, x1: livingW, z1: D, label: 'Living · Dining' });
    rooms.push({ x0: livingW, z0: zBath, x1: W, z1: D, label: 'Kitchen' });
    rooms.push({ x0: livingW, z0: 0, x1: W, z1: zBath, label: 'Bath' });
  }

  // windows across the north wall + living side
  openings.push({ x: W * 0.25, z: 0, widthIn: 60, door: false });
  openings.push({ x: W * 0.75, z: 0, widthIn: 60, door: false });
  openings.push({ x: 0, z: D * 0.7, widthIn: 48, door: false });
  openings.push({ x: livingW * 0.55, z: D, widthIn: 60, door: false });

  // attached garage bumps the footprint out on the west front corner
  let boundary = [
    { x: 0, z: 0 },
    { x: W, z: 0 },
    { x: W, z: D },
    { x: 0, z: D },
  ];
  let garage: Layout['garage'] = null;
  if (house.garage !== 'none' && house.dwelling !== 'apartment' && house.dwelling !== 'condo') {
    const gw = house.garage === '2-car' ? 264 : 150;
    const gd = Math.min(276, round6(D * 0.55));
    boundary = [
      { x: 0, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D },
      { x: -gw, z: D },
      { x: -gw, z: D - gd },
      { x: 0, z: D - gd },
    ];
    garage = { x0: -gw, z0: D - gd, x1: 0, z1: D };
    rooms.push({ x0: -gw, z0: D - gd, x1: 0, z1: D, label: 'Garage' });
    // wall between house and garage, with a connecting door
    walls.push([
      { x: 0, z: D - gd },
      { x: 0, z: D },
    ]);
    openings.push({ x: 0, z: D - gd + 40, widthIn: 32, door: true });
    // garage bay on the front face
    openings.push({ x: -gw / 2, z: D, widthIn: gw - 36, door: true });
  }

  return { boundary, walls, openings, rooms, W, D, garage };
}

function upperFloor(house: House, W: number, D: number): Layout {
  const beds = bedroomCount(house);
  const walls: Layout['walls'] = [];
  const openings: Layout['openings'] = [];
  const rooms: Room[] = [];
  // central landing strip, bedrooms around a half split
  const xSplit = round6(W * 0.5);
  walls.push([
    { x: xSplit, z: 0 },
    { x: xSplit, z: D },
  ]);
  const leftRooms = Math.ceil((beds + 1) / 2); // + bath on the left stack
  const rightRooms = Math.max(1, beds + 1 - leftRooms);
  const stack = (x0: number, x1: number, count: number, startIdx: number): void => {
    for (let i = 0; i < count; i++) {
      const z0 = Math.round((i * D) / count);
      const z1 = Math.round(((i + 1) * D) / count);
      const idx = startIdx + i;
      const bath = idx === beds; // last room is the bath
      rooms.push({ x0, z0, x1, z1, label: bath ? 'Bath' : `Bedroom ${idx + 1}` });
      if (i > 0) {
        walls.push([
          { x: x0, z: z0 },
          { x: x1, z: z0 },
        ]);
      }
      const doorX = x0 === 0 ? x1 : x0;
      openings.push({ x: doorX, z: (z0 + z1) / 2, widthIn: 32, door: true });
      if (!bath) {
        const winX = x0 === 0 ? 0 : x1;
        openings.push({ x: winX, z: (z0 + z1) / 2, widthIn: 48, door: false });
      }
    }
  };
  stack(0, xSplit, leftRooms, 0);
  stack(xSplit, W, rightRooms, leftRooms);
  openings.push({ x: W * 0.3, z: 0, widthIn: 54, door: false });
  openings.push({ x: W * 0.7, z: D, widthIn: 54, door: false });

  return {
    boundary: [
      { x: 0, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D },
      { x: 0, z: D },
    ],
    walls,
    openings,
    rooms,
    W,
    D,
    garage: null,
  };
}

function basementFloor(W: number, D: number): Layout {
  return {
    boundary: [
      { x: 0, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D },
      { x: 0, z: D },
    ],
    walls: [],
    openings: [],
    rooms: [{ x0: 0, z0: 0, x1: W, z1: D, label: 'Basement' }],
    W,
    D,
    garage: null,
  };
}

/** Draw the template as a plan raster (1 px = 1 in) with room labels. */
function drawRaster(layout: Layout): { data: string; w: number; h: number; ox: number; oz: number } {
  const minX = Math.min(...layout.boundary.map((p) => p.x));
  const maxX = Math.max(...layout.boundary.map((p) => p.x));
  const minZ = Math.min(...layout.boundary.map((p) => p.z));
  const maxZ = Math.max(...layout.boundary.map((p) => p.z));
  const pad = 12;
  const w = Math.ceil(maxX - minX) + pad * 2;
  const h = Math.ceil(maxZ - minZ) + pad * 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f8f6f1';
  g.fillRect(0, 0, w, h);
  const X = (x: number): number => x - minX + pad;
  const Z = (z: number): number => z - minZ + pad;

  g.strokeStyle = '#3a352e';
  g.lineWidth = 6;
  g.beginPath();
  layout.boundary.forEach((p, i) => {
    if (i === 0) g.moveTo(X(p.x), Z(p.z));
    else g.lineTo(X(p.x), Z(p.z));
  });
  g.closePath();
  g.stroke();
  g.lineWidth = 4;
  for (const run of layout.walls) {
    g.beginPath();
    run.forEach((p, i) => {
      if (i === 0) g.moveTo(X(p.x), Z(p.z));
      else g.lineTo(X(p.x), Z(p.z));
    });
    g.stroke();
  }
  g.fillStyle = '#8b8172';
  g.font = '600 20px Georgia, serif';
  g.textAlign = 'center';
  for (const r of layout.rooms) {
    g.fillText(r.label, X((r.x0 + r.x1) / 2), Z((r.z0 + r.z1) / 2) + 7);
  }
  g.fillStyle = '#b08d57';
  g.font = '14px system-ui';
  g.fillText('starter template — re-trace to refine', w / 2, h - 10);
  return { data: c.toDataURL('image/png'), w, h, ox: minX - pad, oz: minZ - pad };
}

/** Write one layout into a StoryPlan (image px == inches, offset by raster pad). */
function apply(plan: StoryPlan, layout: Layout): void {
  const raster = drawRaster(layout);
  plan.imageData = raster.data;
  plan.imageW = raster.w;
  plan.imageH = raster.h;
  plan.inPerPx = 1;
  const P = (p: { x: number; z: number }): { x: number; z: number } => ({
    x: p.x - raster.ox,
    z: p.z - raster.oz,
  });
  plan.boundaryPx = layout.boundary.map(P);
  plan.wallsPx = layout.walls.map((run) => run.map(P));
  plan.openingsPx = layout.openings.map((o) => ({ ...P(o), widthIn: o.widthIn, door: o.door }));
}

/** Fill every story that has neither an uploaded plan nor a trace. Returns the
 * number of stories templated. */
export function generateTemplates(house: House): number {
  const { W, D } = footprint(house);
  let n = 0;
  house.plans.forEach((plan, idx) => {
    if (plan.imageData || plan.boundaryPx.length >= 3) return;
    apply(plan, idx === 0 ? groundFloor(house, W, D) : upperFloor(house, W, D));
    n++;
  });
  if (house.basement && house.basementPlan && !house.basementPlan.imageData && house.basementPlan.boundaryPx.length < 3) {
    apply(house.basementPlan, basementFloor(W, D));
    n++;
  }
  return n;
}
