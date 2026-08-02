import * as store from '../state/store';
import type { FloorIndex, HomeProject } from '../types';

export interface ToolbarActions {
  onBack(): void;
  onExport(): void;
  onTopView(): void;
  onDefaultView(): void;
}

export interface Toolbar {
  refresh(): void;
}

/** Top bar of the builder: back · title · Build/Interior · floor selector ·
 * wall cutaway toggle · undo/redo · export. */
export function buildToolbar(root: HTMLElement, project: HomeProject, actions: ToolbarActions): Toolbar {
  const bar = document.createElement('div');
  bar.className = 'topbar hs-topbar';
  root.appendChild(bar);

  const group = (): HTMLDivElement => {
    const g = document.createElement('div');
    g.className = 'bar-group';
    bar.appendChild(g);
    return g;
  };
  const btn = (parent: HTMLElement, label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'ui-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  const gNav = group();
  btn(gNav, '‹ Homes', 'Back to your homes', actions.onBack);

  const title = document.createElement('div');
  title.className = 'app-title';
  title.innerHTML = `${project.name.replace(/[&<>]/g, '')}<small>house build mode</small>`;
  gNav.appendChild(title);

  // mode toggle — interior design arrives later
  const gMode = group();
  const buildBtn = btn(gMode, 'Build', 'House build mode', () => store.setMode('build'));
  const interiorBtn = btn(gMode, 'Interior', 'Interior design — coming soon', () => {});
  interiorBtn.disabled = true;
  interiorBtn.setAttribute('aria-disabled', 'true');

  // floor selector — honors the intake facts when present
  const gFloor = group();
  const floorButtons = new Map<FloorIndex, HTMLButtonElement>();
  const maxFloor = (project.meta.floors ?? 3) - 1;
  if (project.meta.basement) floorButtons.set(-1, btn(gFloor, 'Bsmt', 'Basement', () => store.setActiveFloor(-1)));
  floorButtons.set(0, btn(gFloor, 'G', 'Ground floor', () => store.setActiveFloor(0)));
  if (maxFloor >= 1) floorButtons.set(1, btn(gFloor, '2', 'Second floor', () => store.setActiveFloor(1)));
  if (maxFloor >= 2) floorButtons.set(2, btn(gFloor, '3', 'Third floor', () => store.setActiveFloor(2)));

  const gView = group();
  const topBtn = btn(gView, 'Bird’s eye', 'Straight-down plan view (T)', () => {
    viewMode = 'top';
    actions.onTopView();
    refresh();
  });
  const perspBtn = btn(gView, '3D', 'Three-quarter perspective view (O)', () => {
    viewMode = 'persp';
    actions.onDefaultView();
    refresh();
  });
  let viewMode: 'top' | 'persp' = 'persp';
  const cutBtn = btn(gView, 'Cutaway', 'Lower the walls facing the camera (Sims-style); click for full height', () =>
    store.setCutaway(!store.getState().cutaway),
  );
  const gridBtn = btn(gView, 'Grid', 'Show the 1 ft × 1 ft reference grid', () =>
    store.setSetting('showGrid', !store.getState().settings.showGrid),
  );

  const gHist = group();
  const undoBtn = btn(gHist, '↶', 'Undo (Ctrl+Z)', () => store.undo());
  const redoBtn = btn(gHist, '↷', 'Redo (Ctrl+Shift+Z)', () => store.redo());
  btn(gHist, '⇩', 'Export this home as JSON', actions.onExport);

  const refresh = (): void => {
    const s = store.getState();
    buildBtn.classList.toggle('active', s.mode === 'build');
    for (const [f, b] of floorButtons) b.classList.toggle('active', s.activeFloor === f);
    topBtn.classList.toggle('active', viewMode === 'top');
    perspBtn.classList.toggle('active', viewMode === 'persp');
    cutBtn.classList.toggle('active', s.cutaway);
    cutBtn.textContent = s.cutaway ? 'Cutaway' : 'Full walls';
    gridBtn.classList.toggle('active', s.settings.showGrid);
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
  };
  refresh();
  return { refresh };
}
