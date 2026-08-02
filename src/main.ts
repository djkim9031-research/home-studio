import './ui/style.css';
import * as THREE from 'three';
import { CameraRig, setCameraWorld, setTargetElevation } from './scene/camera';
import { createSceneHost } from './scene/host';
import { buildGround } from './scene/ground';
import { BuildGrid } from './scene/grid';
import { Ceilings } from './scene/ceilings';
import { CutawayController } from './scene/cutaway';
import { ElementMeshes } from './scene/elementMeshes';
import { GhostVisual } from './scene/ghost';
import { moonState, sunPosition } from './scene/sun';
import { i2m } from './constants';
import * as store from './state/store';
import { exportProject, getProject, listProjects, saveProject } from './state/projects';
import { FloorFillTool, OpeningTool, RoomTool, SelectTool, StairTool, WallpaperTool, WallTool, type Tool, type ToolContext } from './interact/buildTools';
import { PointerController } from './interact/pointer';
import { installKeyboard } from './interact/keyboard';
import { buildLanding } from './ui/landing';
import { buildPalette, type ArmSpec } from './ui/palette';
import { buildPlacedPanel } from './ui/placedPanel';
import { buildEditPanel } from './ui/editPanel';
import { buildMinimap } from './ui/minimap';
import { buildSunPanel, type SunPanelState } from './ui/sunPanel';
import { buildToolbar, type Toolbar } from './ui/toolbar';
import { seedRoom, seedTwoFloor } from './data/demoSeeds';
import { floorBaseIn, type HomeProject, type PlacedElement } from './types';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="hs-editor" data-k="editor" style="display:none;position:absolute;inset:0;">
    <div class="viewport" data-k="viewport"></div>
    <div class="hs-right" data-k="right"></div>
  </div>`;
const editorEl = app.querySelector('[data-k="editor"]') as HTMLElement;
const viewport = app.querySelector('[data-k="viewport"]') as HTMLElement;
const rightCol = app.querySelector('[data-k="right"]') as HTMLElement;

const host = createSceneHost(viewport);
buildGround(host.scene);
const buildGrid = new BuildGrid(host.scene);
setCameraWorld({ x: 0, z: 0 }, 300, []);
const rig = new CameraRig(host.canvas);
const meshes = new ElementMeshes(host.elementsGroup);
const ceilings = new Ceilings(host.elementsGroup);
const ghost = new GhostVisual(host.overlayGroup);
const cutaway = new CutawayController(meshes);
host.onFrame(() => {
  if (cutaway.update(rig.camera.position)) {
    host.invalidateShadows();
    return true;
  }
  return false;
});

// ---- toast (mirrored to the title for headless QA) -------------------------

const QA = new URLSearchParams(location.hash.replace(/^#/, '')).has('qa');
let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (QA) document.title = msg; // headless QA reads status from the title
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 3200);
}

// ---- interaction -----------------------------------------------------------

const pointer = new PointerController(viewport, host.canvas, rig, meshes);

const toolCtx: ToolContext = {
  toast,
  pickWall: (ev) => pointer.pickWall(ev),
  floorHitDistance: (ev) => pointer.floorHitDistance(ev),
  cameraPlanePos: () => ({ x: rig.camera.position.x / i2m(1), z: rig.camera.position.z / i2m(1) }),
  onDisarm: () => disarm(),
};

const selectTool = new SelectTool({ ...toolCtx, pickElement: (ev) => pointer.pickElement(ev) });
pointer.setFallback(selectTool);

function disarm(): void {
  pointer.setTool(null);
  palette.clearActive();
}
pointer.onToolDone = disarm;

function armFromSpec(spec: ArmSpec, card: HTMLElement): void {
  palette.clearActive();
  let tool: Tool;
  switch (spec.tool) {
    case 'wall':
      tool = new WallTool(spec, toolCtx);
      break;
    case 'opening':
      tool = new OpeningTool(spec, toolCtx);
      break;
    case 'stair':
      tool = new StairTool(spec, toolCtx);
      break;
    case 'fill':
      tool = new FloorFillTool(spec, toolCtx);
      break;
    case 'wallpaper':
      tool = new WallpaperTool(spec, toolCtx);
      break;
    case 'room':
      tool = new RoomTool(toolCtx);
      break;
  }
  pointer.setTool(tool);
  card.classList.add('active');
}

installKeyboard(rig, pointer, () => palette.clearActive());

// ---- sun -------------------------------------------------------------------

const sunToInput = (s: SunPanelState) => {
  if (!s.enabled) return null;
  const pos = sunPosition(s.date, s.minutes);
  const moon = moonState(s.date, s.minutes);
  return {
    altitudeDeg: pos.altitudeDeg,
    azimuthModelDeg: pos.azimuthModelDeg,
    clouds: s.clouds ? s.cloudPct / 100 : 0,
    moon: {
      altitudeDeg: moon.altitudeDeg,
      azimuthModelDeg: moon.azimuthModelDeg,
      fraction: moon.fraction,
      brightLimbDeg: moon.brightLimbDeg,
    },
  };
};

const sunPanel = buildSunPanel(editorEl, (s) => host.applySun(sunToInput(s)));

// ---- editor panels ---------------------------------------------------------

const palette = buildPalette(editorEl, armFromSpec);
const placedPanel = buildPlacedPanel(rightCol);
const editPanel = buildEditPanel(rightCol, toast);
const minimap = buildMinimap(editorEl, () => store.getState().activeFloor);

// ---- project routing -------------------------------------------------------

let currentProject: HomeProject | null = null;
let toolbar: Toolbar | null = null;

function elementsBounds(elements: PlacedElement[]): { center: { x: number; z: number }; halfSpanIn: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const grow = (x: number, z: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const e of elements) {
    if (e.kind === 'wall') {
      grow(e.a.x, e.a.z);
      grow(e.b.x, e.b.z);
    } else if (e.kind === 'stair') {
      grow(e.x - e.runIn, e.z - e.runIn);
      grow(e.x + e.runIn, e.z + e.runIn);
    } else if (e.kind === 'slab') {
      for (const p of e.polygon) grow(p.x, p.z);
    }
  }
  if (minX > maxX) return { center: { x: 0, z: 0 }, halfSpanIn: 300 };
  return {
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    halfSpanIn: Math.max(200, (Math.max(maxX - minX, maxZ - minZ) / 2) * 1.15),
  };
}

function fitWorld(frame: boolean): void {
  const s = store.getState();
  const { center, halfSpanIn } = elementsBounds(s.elements);
  setCameraWorld(center, halfSpanIn, []);
  host.setSunWorld(center, halfSpanIn);
  buildGrid.place(center.x, center.z, floorBaseIn(s.elements, s.activeFloor));
  if (frame) rig.frameContent({ x: i2m(center.x), y: 0, z: i2m(center.z) }, i2m(halfSpanIn));
}

function refreshGrid(): void {
  const s = store.getState();
  buildGrid.setVisible(s.mode === 'build' && s.settings.showGrid);
  const { center } = elementsBounds(s.elements);
  buildGrid.place(center.x, center.z, floorBaseIn(s.elements, s.activeFloor));
  host.invalidate();
}

/** Floors above the active one hide in build mode so you can see in. */
function applyFloorVisibility(): void {
  const s = store.getState();
  for (const entry of meshes.allEntries().values()) {
    const f = entry.group.userData.floor as number;
    entry.group.visible = f <= s.activeFloor;
  }
  ceilings.applyVisibility(s.activeFloor);
  host.invalidate();
  host.invalidateShadows();
}

function openProject(project: HomeProject): void {
  currentProject = project;
  if (!QA) document.title = `${project.name} · Home Studio`;
  landing.hide();
  editorEl.style.display = '';
  editorEl.querySelector('.hs-topbar')?.remove();
  toolbar = buildToolbar(editorEl, project, {
    onBack: () => {
      disarm();
      currentProject = null;
      if (!QA) document.title = 'Home Studio';
      editorEl.style.display = 'none';
      landing.show();
    },
    onExport: () => {
      if (currentProject) exportProject(currentProject);
    },
    onTopView: () => rig.toTopView(),
    onDefaultView: () => rig.toDefaultView(),
  });
  store.setActiveFloor(0);
  store.importElements(project.elements);
  fitWorld(true);
}

// autosave + render sync
let saveTimer = 0;
store.subscribe((s, ev) => {
  toolbar?.refresh();
  if (ev.kind === 'items' || ev.kind === 'load') {
    meshes.sync(s.elements);
    ceilings.sync(s.elements);
    meshes.setSelected(s.selectedIds);
    cutaway.invalidate(); // rebuilt meshes carry fresh materials
    applyFloorVisibility();
    placedPanel.refresh();
    editPanel.refresh();
    minimap.refresh();
    host.invalidateShadows();
    if (currentProject) {
      currentProject.elements = s.elements;
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        if (currentProject) {
          try {
            saveProject(currentProject);
          } catch (e) {
            toast((e as Error).message);
          }
        }
      }, 500);
    }
    if (ev.kind === 'load') fitWorld(false);
  }
  if (ev.kind === 'ghost') {
    ghost.update(s.ghost, s.elements);
    host.invalidate();
  }
  if (ev.kind === 'selection') {
    meshes.setSelected(s.selectedIds);
    placedPanel.refresh();
    editPanel.refresh();
    host.invalidate();
  }
  if (ev.kind === 'view') {
    setTargetElevation(i2m(floorBaseIn(s.elements, s.activeFloor)));
    applyFloorVisibility();
    placedPanel.refresh();
    editPanel.refresh();
    minimap.refresh();
    refreshGrid();
  }
  if (ev.kind === 'settings') refreshGrid();
});

const landing = buildLanding(app, openProject);

// ---- boot / QA -------------------------------------------------------------

host.start(rig.camera, (dt) => rig.update(dt));

const params = new URLSearchParams(location.hash.replace(/^#/, ''));
if (params.get('burn') === '1') host.onFrame(() => true);
if (params.get('cam') === 'top') {
  setTimeout(() => rig.toTopView(), 1500);
}
if (params.get('cam') === 'flip') {
  // view from the opposite azimuth — cutaway set should mirror
  setTimeout(() => {
    const t = rig.controls.target.clone();
    const p = rig.camera.position;
    rig.camera.position.set(2 * t.x - p.x, p.y, 2 * t.z - p.z);
    rig.controls.update();
  }, 1500);
}
if (params.get('cam') === 'loww') {
  // steep westward sky view — daytime-moon captures (after seed framing)
  setTimeout(() => {
    rig.controls.maxPolarAngle = 2.6;
    setTargetElevation(24);
    rig.camera.position.set(26, 2.5, 0);
    rig.controls.update();
  }, 1500);
}
if (params.get('cam') === 'low') {
  // near-ground view toward the SOUTHERN horizon (sun/moon territory)
  setTimeout(() => {
    rig.controls.maxPolarAngle = 2.4;
    setTargetElevation(14);
    rig.camera.position.set(0, 2.5, -26);
    rig.controls.update();
  }, 1500);
}
{
  // deterministic captures: #sun=YYYY-MM-DD,minutes[,cloudPct] or #sun=off
  const sunParam = params.get('sun');
  if (sunParam === 'off') {
    sunPanel.set({ enabled: false });
  } else if (sunParam) {
    const [date, minutes, clouds] = sunParam.split(',');
    sunPanel.set({
      enabled: true,
      date,
      minutes: parseInt(minutes, 10),
      clouds: !!clouds,
      cloudPct: clouds ? parseInt(clouds, 10) : 0,
    });
  }
}
{
  // seeds: #seed=room|twoFloor loads a demo project (not saved to the library)
  const seed = params.get('seed');
  if (seed === 'room') openProject(seedRoom());
  else if (seed === 'twoFloor') openProject(seedTwoFloor());
  const openParam = params.get('open');
  if (openParam) {
    const target = listProjects().find(
      (p) => p.id === openParam || p.name.toLowerCase() === openParam.toLowerCase(),
    );
    if (target) openProject(target);
  }
  const projParam = params.get('proj');
  if (projParam) {
    const target = getProject(projParam);
    if (target) openProject(target);
  }
  const floorParam = params.get('floor');
  if (floorParam) store.setActiveFloor(Number(floorParam) as -1 | 0 | 1 | 2);
  if (params.get('cutaway') === '0') store.setCutaway(false);
}
if (params.get('qa') === 'hoverwin') {
  // arm the window tool and hover a wall: the ghost + BOTH end-distance chips
  // should appear for the capture
  setTimeout(() => {
    pointer.setTool(new OpeningTool({ door: false }, toolCtx));
    viewport.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 840, clientY: 470, pointerId: 9, bubbles: true }),
    );
  }, 3000);
}
if (params.get('qa') === 'shapecard') {
  // through the REAL palette DOM: arm the wall card, flip its shape select to
  // rectangle AFTER arming, then drag — must place 4 walls, not a line
  setTimeout(() => {
    const card = document.querySelector('.hs-pal-card') as HTMLElement;
    card.click(); // arms with shape=Straight
    const sel = card.querySelector('select') as HTMLSelectElement;
    sel.value = 'rect';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const before = store.getState().elements.filter((e) => e.kind === 'wall').length;
    const fire = (type: string, x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 6, button: 0, bubbles: true }));
    };
    fire('pointerdown', 520, 430);
    fire('pointermove', 760, 580);
    fire('pointerup', 760, 580);
    setTimeout(() => {
      const after = store.getState().elements.filter((e) => e.kind === 'wall').length;
      document.title = `QASHAPECARD placed=+${after - before} (want 4)`;
    }, 500);
  }, 3000);
}
if (params.get('qa') === 'merge') {
  // place two adjacent rectangles sharing an edge; the shared wall must not double
  setTimeout(() => {
    store.clearAll();
    const floorIdx = 0;
    // rect A: corners (0,0)-(192,144)
    store.placeElementsBatch(
      [
        [{ x: 0, z: 0 }, { x: 192, z: 0 }],
        [{ x: 192, z: 0 }, { x: 192, z: 144 }],
        [{ x: 192, z: 144 }, { x: 0, z: 144 }],
        [{ x: 0, z: 144 }, { x: 0, z: 0 }],
      ].map(([a, b]) => ({ kind: 'wall', floor: floorIdx, a, b, heightIn: 96, thickIn: 5, color: '#f2eee6', textureId: 'paint' }) as never),
    );
    const before = store.getState().elements.filter((e) => e.kind === 'wall').length;
    // rect B to the right sharing the x=192 edge, placed via the tool at anchor tl (192,0)
    const tool = new WallTool({ shape: 'rect', rectLenIn: 192, rectWidIn: 144, rectAnchor: 'tl' }, toolCtx);
    // drive onDown/onUp with the same floor point (no drag) at (192,0)
    (tool as unknown as { a: { x: number; z: number } }).a = { x: 192, z: 0 };
    (tool as unknown as { onUp(f: { x: number; z: number }): void }).onUp({ x: 192, z: 0 });
    const after = store.getState().elements.filter((e) => e.kind === 'wall').length;
    document.title = `QAMERGE rectA=${before} +rectB=${after - before} (want +3, shared wall skipped) total=${after}`;
  }, 2500);
}
if (params.get('qa') === 'shapes') {
  // rectangle by DIMENSIONS: click (no drag) places an L×W room at the anchor
  setTimeout(() => {
    const fire = (type: string, x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 5, button: 0, bubbles: true }));
    };
    const before = store.getState().elements.filter((e) => e.kind === 'wall').length;
    pointer.setTool(new WallTool({ shape: 'rect', rectLenIn: 240, rectWidIn: 144, rectAnchor: 'center' }, toolCtx));
    fire('pointerdown', 850, 480);
    fire('pointerup', 850, 480); // no drag → dimension-placed
    setTimeout(() => {
      const rect = store.getState().elements.filter((e) => e.kind === 'wall');
      const added = rect.slice(before);
      const dims = added
        .map((w) => (w.kind === 'wall' ? Math.round(Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)) : 0))
        .sort((a, b) => a - b);
      document.title = `QASHAPES placed=+${added.length} lens=[${dims.join(',')}] (want 4: 144,144,240,240)`;
    }, 500);
  }, 3000);
}
if (params.get('qa') === 'select') {
  // select the first brick wall: edit panel + brass outline in the capture
  setTimeout(() => {
    const wall = store.getState().elements.find((e) => e.kind === 'wall' && e.textureId === 'brick');
    if (wall) store.select(wall.id);
  }, 2500);
}
if (params.get('qa') === 'divider') {
  // partial partition inside the seed room: fills on each side must stop at
  // the partition and its projected dividing line
  setTimeout(() => {
    store.deleteElements(store.getState().elements.filter((e) => e.kind === 'slab').map((e) => e.id));
    store.placeElement({
      kind: 'wall',
      floor: 0,
      a: { x: 96, z: 0 },
      b: { x: 96, z: 96 },
      heightIn: 96,
      thickIn: 5,
      color: '#f2eee6',
      textureId: 'paint',
    } as never);
    const click = (x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    pointer.setTool(new FloorFillTool({ textureId: 'tile', color: '#cc4444' }, toolCtx));
    click(700, 480);
    pointer.setTool(new FloorFillTool({ textureId: 'carpet', color: '#4466bb' }, toolCtx));
    click(1050, 500);
    const placedSlabs = store.getState().elements.filter((e) => e.kind === 'slab');
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;background:#222;color:#fff;padding:6px 10px;font:13px monospace;';
    banner.textContent = `QA slabs=${placedSlabs.length} floors=[${placedSlabs.map((s) => (s.kind === 'slab' ? s.textureId : '')).join(',')}]`;
    document.body.appendChild(banner);
  }, 2200);
}
if (params.get('qa') === 'wallpaper') {
  // room paper (inner faces) then exterior paint (outer faces of the run)
  setTimeout(() => {
    const click = (x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    pointer.setTool(new WallpaperTool({ textureId: 'stripes', color: '#d9d2e6' }, toolCtx));
    click(850, 500); // inside the room
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!params.get('skipext')) {
          pointer.setTool(new WallpaperTool({ textureId: 'brick', color: '#c76f4a' }, toolCtx));
          click(690, 545);
        }
        const walls = store.getState().elements.filter((e) => e.kind === 'wall');
        const t = `QA faces=[${walls
          .map((w) => (w.kind === 'wall' ? `${w.facePos?.textureId ?? '-'}|${w.faceNeg?.textureId ?? '-'}` : ''))
          .join(' ')}]`;
        setInterval(() => (document.title = t), 400);
      }),
    );
  }, 2200);
}
if (params.get('qa') === 'splitmesh') {
  // render check: a crossing wall with a pre-set interior span (stripes, inner
  // z72-144) and exterior span (brick, outer z144-260) must show two finishes
  setTimeout(() => {
    store.placeElement({
      kind: 'wall',
      floor: 0,
      a: { x: 96, z: 72 },
      b: { x: 96, z: 260 },
      heightIn: 96,
      thickIn: 8,
      color: '#f2eee6',
      textureId: 'paint',
      faceNegSpans: [
        { from: 0, to: 72, textureId: 'stripes', color: '#d9d2e6' },
        { from: 72, to: 188, textureId: 'brick', color: '#c76f4a' },
      ],
      facePosSpans: [
        { from: 0, to: 72, textureId: 'stripes', color: '#d9d2e6' },
        { from: 72, to: 188, textureId: 'brick', color: '#c76f4a' },
      ],
    } as never);
  }, 2000);
}
if (params.get('qa') === 'crossing') {
  // a wall from inside the room (z=72) crossing the north shell (z=144) out to
  // z=260; interior papering then exterior painting must split it at ~144
  setTimeout(() => {
    const seed = store.getState().elements.find((e) => e.kind === 'wall');
    const floorIdx = 0;
    store.placeElement({
      kind: 'wall',
      floor: floorIdx,
      a: { x: 96, z: 72 },
      b: { x: 96, z: 260 },
      heightIn: 96,
      thickIn: 5,
      color: '#f2eee6',
      textureId: 'paint',
    } as never);
    void seed;
    const click = (x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    const fmt = (spans: unknown): string =>
      Array.isArray(spans)
        ? spans.map((sp) => `${Math.round((sp as { from: number }).from)}-${Math.round((sp as { to: number }).to)}`).join(',')
        : 'none';
    // world plan point → screen px via the live camera
    const rect = host.canvas.getBoundingClientRect();
    const clickWorld = (xIn: number, zIn: number): void => {
      const v = new THREE.Vector3(i2m(xIn), i2m(floorBaseIn(store.getState().elements, floorIdx)), i2m(zIn)).project(rig.camera);
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    pointer.setTool(new WallpaperTool({ textureId: 'stripes', color: '#d9d2e6' }, toolCtx));
    clickWorld(150, 100); // right half interior
    pointer.setTool(new WallpaperTool({ textureId: 'brick', color: '#c76f4a' }, toolCtx));
    clickWorld(88, 210); // just off the crossing wall's west face, outside the shell
    const cross = store.getState().elements.find((e) => e.kind === 'wall' && Math.round(e.a.z) === 72);
    const c = cross && cross.kind === 'wall' ? cross : null;
    const t = `QACROSS pos=[${fmt(c?.facePosSpans)}] neg=[${fmt(c?.faceNegSpans)}]`;
    setInterval(() => (document.title = t), 400);
  }, 2200);
}
if (params.get('qa') === 'refill') {
  // fill the room, then re-fill with a different finish: the old slab must be
  // replaced, not stacked
  setTimeout(() => {
    const click = (x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    store.deleteElements(store.getState().elements.filter((e) => e.kind === 'slab').map((e) => e.id));
    pointer.setTool(new FloorFillTool({ textureId: 'tile', color: '#cc4444' }, toolCtx));
    click(850, 500);
    pointer.setTool(new FloorFillTool({ textureId: 'carpet', color: '#4466bb' }, toolCtx));
    click(850, 500);
    const slabs = store.getState().elements.filter((e) => e.kind === 'slab');
    const t = `QAREFILL slabs=${slabs.length} finishes=[${slabs.map((e) => (e.kind === 'slab' ? e.textureId : '')).join(',')}]`;
    setInterval(() => (document.title = t), 400);
  }, 2200);
}
if (params.get('qa') === 'fillvis') {
  // visual repro: drop the seed slab, then fill with RED TILE — the placed
  // slab must show that finish
  setTimeout(() => {
    const slabs = store.getState().elements.filter((e) => e.kind === 'slab').map((e) => e.id);
    store.deleteElements(slabs);
    pointer.setTool(new FloorFillTool({ textureId: 'tile', color: '#cc4444' }, toolCtx));
    const click = (x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    click(850, 500);
  }, 3000);
}
if (params.get('qa') === 'fill') {
  // flooring fill: click the lawn (must refuse), then inside the room (must
  // place); report slab count + the refusal toast
  setTimeout(() => {
    pointer.setTool(new FloorFillTool({ textureId: 'tile' }, toolCtx));
    const click = (x: number, y: number): void => {
      viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 4, button: 0, bubbles: true }));
    };
    click(260, 820); // lawn
    const refusal = document.title;
    setTimeout(() => {
      click(850, 500); // inside the room
      setTimeout(() => {
        const slabs = store.getState().elements.filter((e) => e.kind === 'slab').length;
        document.title = `QAFILL slabs=${slabs} refusal=${refusal.includes('enclosed') ? 'yes' : 'no:' + refusal}`;
      }, 600);
    }, 400);
  }, 3000);
}
if (params.get('qa') === 'drawwall') {
  // synthetic pointer gesture through the REAL router: arm the wall tool and
  // drag across the canvas, then report what got placed
  setTimeout(() => {
    pointer.setTool(new WallTool({}, toolCtx));
    const fire = (type: string, x: number, y: number): void => {
      viewport.dispatchEvent(
        new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, button: 0, bubbles: true }),
      );
    };
    fire('pointerdown', 600, 500);
    for (let i = 1; i <= 8; i++) fire('pointermove', 600 + i * 40, 500);
    fire('pointerup', 920, 500);
    setTimeout(() => {
      const walls = store.getState().elements.filter((e) => e.kind === 'wall');
      document.title = `QA walls=${walls.length} ghost=${store.getState().ghost ? 'yes' : 'no'} undo=${store.canUndo()}`;
    }, 800);
  }, 3000);
}
