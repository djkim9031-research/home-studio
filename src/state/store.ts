import * as history from './history';
import { uid } from './projects';
import type { FloorIndex, Mode, PlacedElement, Vec2, Wall } from '../types';

export interface Settings {
  gridSnap: boolean;
  angleSnap: boolean;
  showDims: boolean;
  showGrid: boolean;
  showRoomLabels: boolean;
}

/** Transient ghost previews (wall run being dragged, opening sliding on a wall…). */
export type GhostState =
  | { kind: 'wall'; floor: FloorIndex; runs: { a: Vec2; b: Vec2 }[]; heightIn: number; thickIn: number; valid: boolean; label: string }
  | { kind: 'opening'; wallId: string; centerIn: number; widthIn: number; heightIn: number; sillIn: number; door: boolean; valid: boolean }
  | { kind: 'stair'; floor: FloorIndex; x: number; z: number; yawDeg: number; widthIn: number; runIn: number; flights: 1 | 2; valid: boolean }
  | { kind: 'region'; floor: FloorIndex; polygon: Vec2[]; valid: boolean }
  | { kind: 'patch'; floor: FloorIndex; wallId: string; face: 'pos' | 'neg'; fromT: number; toT: number; y0: number; y1: number; valid: boolean }
  | { kind: 'facegroup'; floor: FloorIndex; faces: { wallId: string; face: 'pos' | 'neg'; fromT: number; toT: number; y0: number; y1: number }[]; valid: boolean };

export interface AppState {
  elements: PlacedElement[];
  mode: Mode;
  activeFloor: FloorIndex;
  cutaway: boolean;
  selectedIds: string[];
  /** exactly-one selection convenience (null when 0 or >1 selected) */
  selectedId: string | null;
  ghost: GhostState | null;
  /** a small red marker shown at a finetuner's anchor corner */
  anchorMarker: { x: number; y: number; z: number } | null;
  settings: Settings;
}

export type StoreEventKind = 'items' | 'ghost' | 'selection' | 'settings' | 'view' | 'load';
export interface StoreEvent {
  kind: StoreEventKind;
  changedIds?: string[];
}

const state: AppState = {
  elements: [],
  mode: 'build',
  activeFloor: 0,
  cutaway: true,
  selectedIds: [],
  selectedId: null,
  ghost: null,
  anchorMarker: null,
  settings: { gridSnap: true, angleSnap: true, showDims: true, showGrid: true, showRoomLabels: true },
};

type Listener = (s: AppState, ev: StoreEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): AppState {
  return state;
}

function emit(ev: StoreEvent): void {
  for (const fn of listeners) fn(state, ev);
}

function syncSingle(): void {
  state.selectedId = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
}

function pruneSelection(): void {
  const ids = new Set(state.elements.map((e) => e.id));
  state.selectedIds = state.selectedIds.filter((id) => ids.has(id));
  syncSingle();
}

// ---------------------------------------------------------------------------
// Transient (not undoable)
// ---------------------------------------------------------------------------

export function setGhost(ghost: GhostState | null): void {
  state.ghost = ghost;
  emit({ kind: 'ghost' });
}

export function setAnchor(marker: { x: number; y: number; z: number } | null): void {
  state.anchorMarker = marker;
  emit({ kind: 'ghost' });
}

export function select(id: string | null): void {
  state.selectedIds = id ? [id] : [];
  syncSingle();
  emit({ kind: 'selection' });
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  state.settings[key] = value;
  emit({ kind: 'settings' });
}

export function setMode(mode: Mode): void {
  state.mode = mode;
  state.selectedIds = [];
  syncSingle();
  emit({ kind: 'view' });
}

export function setActiveFloor(f: FloorIndex): void {
  state.activeFloor = f;
  state.selectedIds = [];
  syncSingle();
  emit({ kind: 'view' });
}

export function setCutaway(on: boolean): void {
  state.cutaway = on;
  emit({ kind: 'view' });
}

// ---------------------------------------------------------------------------
// Undoable mutations
// ---------------------------------------------------------------------------

export function placeElement(el: Omit<PlacedElement, 'id'>): PlacedElement {
  history.push(state.elements);
  const placed = { ...el, id: uid() } as PlacedElement;
  state.elements = [...state.elements, placed];
  emit({ kind: 'items', changedIds: [placed.id] });
  return placed;
}

/** Place several elements as ONE undo step (a rectangle's four wall runs). */
export function placeElementsBatch(els: Omit<PlacedElement, 'id'>[]): PlacedElement[] {
  if (!els.length) return [];
  history.push(state.elements);
  const placed = els.map((el) => ({ ...el, id: uid() }) as PlacedElement);
  state.elements = [...state.elements, ...placed];
  emit({ kind: 'items', changedIds: placed.map((p) => p.id) });
  return placed;
}

/** Place an element, first removing existing ones the predicate flags as
 * superseded (a new floor replaces the old one over the same area) — ONE undo. */
export function placeReplacing(
  el: Omit<PlacedElement, 'id'>,
  supersedes: (existing: PlacedElement) => boolean,
): PlacedElement {
  history.push(state.elements);
  const removed = state.elements.filter(supersedes).map((e) => e.id);
  const placed = { ...el, id: uid() } as PlacedElement;
  state.elements = [...state.elements.filter((e) => !removed.includes(e.id)), placed];
  pruneSelection();
  emit({ kind: 'items', changedIds: [...removed, placed.id] });
  return placed;
}

/** Openings that no longer fit a changed wall are dropped in the SAME undo step. */
export function updateElement(id: string, patch: Partial<PlacedElement>): void {
  const cur = state.elements.find((e) => e.id === id);
  if (!cur) return;
  history.push(state.elements);
  const next = { ...cur, ...patch, id, kind: cur.kind } as PlacedElement;
  const changed = [id];
  let elements = state.elements.map((e) => (e.id === id ? next : e));
  if (next.kind === 'wall') {
    const wall = next as Wall;
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    const dropped = elements.filter(
      (e) =>
        (e.kind === 'door' || e.kind === 'window') &&
        e.wallId === id &&
        (e.centerIn + e.widthIn / 2 > len - 1 || e.sillIn + e.heightIn > wall.heightIn),
    );
    if (dropped.length) {
      const ids = new Set(dropped.map((d) => d.id));
      elements = elements.filter((e) => !ids.has(e.id));
      changed.push(...ids);
    }
  }
  if (cur.kind === 'door' || cur.kind === 'window') changed.push(cur.wallId);
  state.elements = elements;
  pruneSelection();
  emit({ kind: 'items', changedIds: changed });
}

/** Mark one door as the home's main entrance; any previous one loses the flag
 * in the SAME undo step. Passing null just clears whatever is set. */
export function setMainEntrance(id: string | null): void {
  const changed: string[] = [];
  const next = state.elements.map((e) => {
    if (e.kind !== 'door') return e;
    const should = e.id === id;
    if (!!e.isMainEntrance === should) return e;
    changed.push(e.id);
    return { ...e, isMainEntrance: should } as PlacedElement;
  });
  if (!changed.length) return;
  history.push(state.elements);
  state.elements = next;
  emit({ kind: 'items', changedIds: changed });
}

/** Apply many element patches as ONE undo step (e.g. painting a whole group). */
export function updateElementsBatch(updates: { id: string; patch: Partial<PlacedElement> }[]): void {
  if (!updates.length) return;
  const map = new Map(updates.map((u) => [u.id, u.patch]));
  history.push(state.elements);
  state.elements = state.elements.map((e) => (map.has(e.id) ? ({ ...e, ...map.get(e.id), id: e.id, kind: e.kind } as PlacedElement) : e));
  emit({ kind: 'items', changedIds: updates.map((u) => u.id) });
}

/** Deleting a wall cascades to the openings it carries. */
export function deleteElements(ids: string[]): void {
  if (!ids.length) return;
  const idSet = new Set(ids);
  for (const e of state.elements) {
    if ((e.kind === 'door' || e.kind === 'window') && idSet.has(e.wallId)) idSet.add(e.id);
  }
  const removing = state.elements.filter((e) => idSet.has(e.id));
  if (!removing.length) return;
  history.push(state.elements);
  const changed = removing.map((e) => e.id);
  // wall meshes must rebuild when their openings go
  for (const e of removing) if (e.kind === 'door' || e.kind === 'window') changed.push(e.wallId);
  state.elements = state.elements.filter((e) => !idSet.has(e.id));
  pruneSelection();
  emit({ kind: 'items', changedIds: changed });
}

export function clearAll(): void {
  if (!state.elements.length) return;
  history.push(state.elements);
  const ids = state.elements.map((e) => e.id);
  state.elements = [];
  state.selectedIds = [];
  syncSingle();
  emit({ kind: 'items', changedIds: ids });
}

export function importElements(elements: PlacedElement[]): void {
  history.reset();
  const ids = [...state.elements.map((e) => e.id), ...elements.map((e) => e.id)];
  state.elements = elements.map((e) => structuredClone(e));
  state.selectedIds = [];
  syncSingle();
  emit({ kind: 'load', changedIds: ids });
}

function diffIds(a: PlacedElement[], b: PlacedElement[]): string[] {
  const am = new Map(a.map((e) => [e.id, e]));
  const bm = new Map(b.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const [id, e] of am) {
    const o = bm.get(id);
    if (!o) out.add(id);
    else if (JSON.stringify(e) !== JSON.stringify(o)) out.add(id);
  }
  for (const id of bm.keys()) if (!am.has(id)) out.add(id);
  return [...out];
}

/** Live-drag updates — NO history entry; commitLiveEdit closes the gesture. */
export function updateElementsLive(updates: { id: string; patch: Partial<PlacedElement> }[]): void {
  const map = new Map(updates.map((u) => [u.id, u.patch]));
  state.elements = state.elements.map((e) => (map.has(e.id) ? ({ ...e, ...map.get(e.id), id: e.id, kind: e.kind } as PlacedElement) : e));
  emit({ kind: 'items', changedIds: updates.map((u) => u.id) });
}

/** One undo step for a whole live gesture: pass the pre-drag originals. */
export function commitLiveEdit(originals: PlacedElement[]): void {
  const cur = state.elements;
  const pre = cur.map((e) => originals.find((o) => o.id === e.id) ?? e);
  if (JSON.stringify(pre) === JSON.stringify(cur)) return;
  state.elements = pre;
  history.push(state.elements);
  state.elements = cur;
  emit({ kind: 'items', changedIds: originals.map((o) => o.id) });
}

export function undo(): void {
  const prev = history.undo(state.elements);
  if (!prev) return;
  const changed = diffIds(state.elements, prev);
  state.elements = prev;
  pruneSelection();
  emit({ kind: 'items', changedIds: changed });
}

export function redo(): void {
  const next = history.redo(state.elements);
  if (!next) return;
  const changed = diffIds(state.elements, next);
  state.elements = next;
  pruneSelection();
  emit({ kind: 'items', changedIds: changed });
}

export const canUndo = history.canUndo;
export const canRedo = history.canRedo;
