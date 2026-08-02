import './ui/style.css';
import { CameraRig, setCameraWorld, setTargetElevation } from './scene/camera';
import { createSceneHost } from './scene/host';
import { buildGround } from './scene/ground';
import { CutawayController } from './scene/cutaway';
import { ElementMeshes } from './scene/elementMeshes';
import { GhostVisual } from './scene/ghost';
import { moonState, sunPosition } from './scene/sun';
import { i2m } from './constants';
import * as store from './state/store';
import { exportProject, getProject, listProjects, saveProject } from './state/projects';
import { FloorFillTool, OpeningTool, SelectTool, StairTool, WallTool, type Tool, type ToolContext } from './interact/buildTools';
import { PointerController } from './interact/pointer';
import { installKeyboard } from './interact/keyboard';
import { buildLanding } from './ui/landing';
import { buildPalette, type ArmSpec } from './ui/palette';
import { buildPlacedPanel } from './ui/placedPanel';
import { buildEditPanel } from './ui/editPanel';
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
setCameraWorld({ x: 0, z: 0 }, 300, []);
const rig = new CameraRig(host.canvas);
const meshes = new ElementMeshes(host.elementsGroup);
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
  document.title = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 3200);
}

// ---- interaction -----------------------------------------------------------

const pointer = new PointerController(viewport, host.canvas, rig, meshes);

const toolCtx: ToolContext = {
  toast,
  pickWall: (ev) => pointer.pickWall(ev),
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
  const { center, halfSpanIn } = elementsBounds(store.getState().elements);
  setCameraWorld(center, halfSpanIn, []);
  host.setSunWorld(center, halfSpanIn);
  if (frame) rig.frameContent({ x: i2m(center.x), y: 0, z: i2m(center.z) }, i2m(halfSpanIn));
}

/** Floors above the active one hide in build mode so you can see in. */
function applyFloorVisibility(): void {
  const s = store.getState();
  for (const entry of meshes.allEntries().values()) {
    const f = entry.group.userData.floor as number;
    entry.group.visible = f <= s.activeFloor;
  }
  host.invalidate();
  host.invalidateShadows();
}

function openProject(project: HomeProject): void {
  currentProject = project;
  landing.hide();
  editorEl.style.display = '';
  editorEl.querySelector('.hs-topbar')?.remove();
  toolbar = buildToolbar(editorEl, project, {
    onBack: () => {
      disarm();
      currentProject = null;
      editorEl.style.display = 'none';
      landing.show();
    },
    onExport: () => {
      if (currentProject) exportProject(currentProject);
    },
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
    meshes.setSelected(s.selectedIds);
    applyFloorVisibility();
    placedPanel.refresh();
    editPanel.refresh();
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
  }
});

const landing = buildLanding(app, openProject);

// ---- boot / QA -------------------------------------------------------------

host.start(rig.camera, (dt) => rig.update(dt));

const params = new URLSearchParams(location.hash.replace(/^#/, ''));
if (params.get('burn') === '1') host.onFrame(() => true);
if (params.get('cam') === 'flip') {
  // view from the opposite azimuth — cutaway set should mirror
  setTimeout(() => {
    const t = rig.controls.target.clone();
    const p = rig.camera.position;
    rig.camera.position.set(2 * t.x - p.x, p.y, 2 * t.z - p.z);
    rig.controls.update();
  }, 1500);
}
if (params.get('cam') === 'low') {
  // near-ground view toward the SOUTHERN horizon (sun/moon territory)
  rig.controls.maxPolarAngle = 2.4;
  setTargetElevation(14);
  rig.camera.position.set(0, 2.5, -26);
  rig.controls.update();
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
if (params.get('qa') === 'select') {
  // select the first brick wall: edit panel + brass outline in the capture
  setTimeout(() => {
    const wall = store.getState().elements.find((e) => e.kind === 'wall' && e.textureId === 'brick');
    if (wall) store.select(wall.id);
  }, 2500);
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
