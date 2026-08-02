import './ui/style.css';
import * as THREE from 'three';
import { i2m } from './constants';
import { openTracer } from './plan/tracer';
import { generateTemplates } from './plan/template';
import { buildMatterportPanel } from './matterport/embed';
import { buildShell, type BuiltShell } from './scene/shell';
import { CameraRig, setCameraWorld } from './scene/camera';
import { createSceneHost } from './scene/host';
import { getHouse, saveHouse } from './state/houses';
import { buildLanding } from './ui/landing';
import type { House, Vec2 } from './types';

const app = document.getElementById('app')!;
// the viewer stays mounted and visible from boot (creating the WebGL surface
// inside display:none leaves some drivers with a dead swap chain); the opaque
// landing page simply covers it until a house opens
const container = document.createElement('div');
container.className = 'viewport hs-viewer';
app.appendChild(container);

const host = createSceneHost(container);
const rig = new CameraRig(host.canvas);
new ResizeObserver(() => {
  rig.setAspect(container.clientWidth / Math.max(container.clientHeight, 1));
  host.invalidate();
}).observe(container);

let currentShell: BuiltShell | null = null;
let currentHouse: House | null = null;

// ---- viewer chrome ----
const topbar = document.createElement('div');
topbar.className = 'hs-topbar';
container.appendChild(topbar);

const backBtn = document.createElement('button');
backBtn.className = 'ui-btn';
backBtn.textContent = '‹ Houses';
topbar.appendChild(backBtn);

const titleChip = document.createElement('div');
titleChip.className = 'hs-title-chip';
topbar.appendChild(titleChip);

const gView = document.createElement('div');
gView.className = 'bar-group';
topbar.appendChild(gView);
const mkBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.className = 'ui-btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  gView.appendChild(b);
  return b;
};
mkBtn('Top', 'Plan view (T)', () => rig.toTopView());
mkBtn('Orbit', 'Orbit view', () => {
  if (standMode) exitStand();
});
mkBtn('Stand here', 'Walk inside (V) — tap a floor to teleport', () => {
  if (!standMode) enterStand();
});
const planBtn = mkBtn('Plan floor', 'Show the floor-plan image on the floors', () => {
  planUnderlay = !planUnderlay;
  planBtn.classList.toggle('on', planUnderlay);
  currentShell?.setPlanUnderlay(planUnderlay);
  host.invalidateShadows();
});
const traceBtn = mkBtn('Trace plan', 'Calibrate + trace walls for a story', async () => {
  if (!currentHouse) return;
  const story = currentHouse.plans.findIndex((p) => p.imageData && p.boundaryPx.length < 3);
  const key = story >= 0 ? story : 0;
  if (!currentHouse.plans[key]?.imageData) {
    toast('Add a floor-plan image first (✎ on the house card).');
    return;
  }
  const saved = await openTracer(currentHouse, key);
  if (saved) reloadHouse(currentHouse.id);
});

mkBtn('Template', 'Regenerate the starter layout for untraced stories', () => {
  if (!currentHouse) return;
  // clear only template-born stories? regeneration applies to EMPTY stories;
  // to rebuild from scratch the user clears a story in the tracer first
  for (const p of [...currentHouse.plans, ...(currentHouse.basementPlan ? [currentHouse.basementPlan] : [])]) {
    if (p.inPerPx === 1 && p.imageData) {
      // regenerate previously templated stories with current house facts
      p.imageData = null;
      p.boundaryPx = [];
      p.wallsPx = [];
      p.openingsPx = [];
      p.inPerPx = 0;
    }
  }
  const n = generateTemplates(currentHouse);
  saveHouse(currentHouse);
  reloadHouse(currentHouse.id);
  toast(n ? `Starter layout regenerated for ${n} ${n === 1 ? 'story' : 'stories'}.` : 'All stories have uploads or traces — nothing to template.');
});

const storySeg = document.createElement('div');
storySeg.className = 'hs-seg';
storySeg.style.minWidth = '150px';
topbar.appendChild(storySeg);

let planUnderlay = false;
let standMode = false;

const toastEl = document.createElement('div');
toastEl.className = 'toast';
container.appendChild(toastEl);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toast = (msg: string): void => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
};

// ---- stand mode plumbing ----
function enterStand(): void {
  standMode = true;
  rig.enterStand();
}
function exitStand(): void {
  standMode = false;
  rig.exitStand();
}
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (landingVisible()) return;
  if (e.key === 't' || e.key === 'T') rig.toTopView();
  if (e.key === 'v' || e.key === 'V') (standMode ? exitStand : enterStand)();
  if (e.key === 'Escape' && standMode) exitStand();
});

// ---- house open/close ----
function openHouse(house: House): void {
  currentHouse = house;
  landing.hide();

  // rebuild shell
  host.houseGroup.clear();
  currentShell = buildShell(house);
  titleChip.innerHTML = `<b>${house.name.replace(/[&<>]/g, '')}</b><small>${house.sqft.toLocaleString()} sqft · ${
    house.stories
  } ${house.stories === 1 ? 'story' : 'stories'}${house.basement ? ' + basement' : ''}</small>`;

  storySeg.innerHTML = '';
  container.querySelector('.hs-mp-panel')?.remove();
  buildMatterportPanel(container, house.matterportId);

  if (currentShell) {
    host.houseGroup.add(currentShell.group);
    currentShell.setPlanUnderlay(planUnderlay);
    const walk: Vec2[][] = [...currentShell.walkAreas.values()];
    setCameraWorld(currentShell.center, currentShell.halfSpanIn, walk);
    rig.frameContent(
      new THREE.Vector3(i2m(currentShell.center.x), 0, i2m(currentShell.center.z)),
      i2m(currentShell.halfSpanIn),
    );
    // story visibility toggles
    for (const key of currentShell.storyGroups.keys()) {
      const b = document.createElement('button');
      b.textContent = key === 'basement' ? 'Bsmt' : `S${Number(key) + 1}`;
      b.classList.add('on');
      b.addEventListener('click', () => {
        const g = currentShell!.storyGroups.get(key)!;
        g.visible = !g.visible;
        b.classList.toggle('on', g.visible);
        host.invalidateShadows();
      });
      storySeg.appendChild(b);
    }
    traceBtn.textContent = 'Re-trace plan';
  } else {
    // nothing traced yet: park the camera at a friendly height and prompt
    setCameraWorld({ x: 0, z: 0 }, 400, []);
    toast(
      house.plans[0]?.imageData
        ? 'Plan loaded — hit “Trace plan” to calibrate and draw the walls.'
        : 'Add a floor-plan image (✎ on the house card), then trace it.',
    );
    traceBtn.textContent = 'Trace plan';
  }
  host.invalidateShadows();
}

function reloadHouse(id: string): void {
  const fresh = getHouse(id);
  if (fresh) openHouse(fresh);
}

backBtn.addEventListener('click', () => {
  if (standMode) exitStand();
  landing.show();
});

const landing = buildLanding(app, openHouse);
const landingVisible = (): boolean =>
  (app.querySelector('.hs-landing') as HTMLElement | null)?.style.display !== 'none';

// ---- boot / QA ----
host.start(rig.camera, (dt) => rig.update(dt));

const params = new URLSearchParams(location.hash.replace(/^#/, ''));
if (params.get('burn') === '1') host.onFrame(() => true);
if (params.get('demo') === 'template') {
  import('./state/houses').then((houses) => {
    const existing = houses.listHouses().find((h) => h.name === 'Template Colonial');
    let h = existing ?? null;
    if (!h) {
      h = houses.newHouse({
        name: 'Template Colonial',
        adults: 2,
        kids: 2,
        pets: '1 lab',
        sqft: 2200,
        stories: 2,
        basement: true,
        garage: '2-car',
        dwelling: 'house',
        matterportId: params.get('nomp') ? null : 'RBJgekjimAS',
      });
      generateTemplates(h);
      houses.saveHouse(h);
    }
    openHouse(h);
    if (params.get('view') === 'stand') setTimeout(() => enterStand(), 1500);
  });
}
if (params.get('demo') === 'sample') {
  // deterministic sample house: a 40'×28' rectangle with two rooms + openings,
  // "traced" synthetically so captures don't need file uploads
  import('./state/houses').then((houses) => {
    const sample = houses.listHouses().find((h) => h.name === 'Sample Bungalow');
    const mk = (): House => {
      const h = houses.newHouse({
        name: 'Sample Bungalow',
        adults: 2,
        kids: 1,
        pets: '1 corgi',
        sqft: 1120,
        stories: 1,
        basement: false,
        garage: '1-car',
        dwelling: 'house',
        matterportId: params.get('nomp') ? null : 'RBJgekjimAS',
      });
      const p = h.plans[0];
      p.imageW = 960;
      p.imageH = 672;
      {
        // synthetic plan raster: white sheet + wall lines matching the trace
        const c = document.createElement('canvas');
        c.width = 960;
        c.height = 672;
        const g = c.getContext('2d')!;
        g.fillStyle = '#f8f6f1';
        g.fillRect(0, 0, 960, 672);
        g.strokeStyle = '#3a352e';
        g.lineWidth = 8;
        g.strokeRect(8, 8, 944, 656);
        g.beginPath();
        g.moveTo(560, 8);
        g.lineTo(560, 664);
        g.moveTo(8, 400);
        g.lineTo(560, 400);
        g.stroke();
        p.imageData = c.toDataURL('image/png');
      }
      p.inPerPx = 0.5; // 480" × 336" = 40' × 28'
      p.boundaryPx = [
        { x: 0, z: 0 },
        { x: 960, z: 0 },
        { x: 960, z: 672 },
        { x: 0, z: 672 },
      ];
      p.wallsPx = [
        [
          { x: 560, z: 0 },
          { x: 560, z: 672 },
        ],
        [
          { x: 0, z: 400 },
          { x: 560, z: 400 },
        ],
      ];
      p.openingsPx = [
        { x: 480, z: 672, widthIn: 42, door: true }, // front door (south wall)
        { x: 560, z: 200, widthIn: 32, door: true },
        { x: 280, z: 400, widthIn: 36, door: true },
        { x: 240, z: 0, widthIn: 60, door: false }, // north window
        { x: 760, z: 0, widthIn: 60, door: false },
        { x: 960, z: 336, widthIn: 48, door: false },
      ];
      houses.saveHouse(h);
      return h;
    };
    openHouse(sample ?? mk());
    if (params.get('trace') === '1') {
      setTimeout(() => {
        if (currentHouse) void openTracer(currentHouse, 0);
      }, 1500);
    }
    if (params.get('view') === 'stand') setTimeout(() => enterStand(), 1500);
  });
}
void saveHouse; // referenced by landing import flow
