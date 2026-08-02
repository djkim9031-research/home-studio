import type {
  FloorSlab,
  HomeMeta,
  HomeProject,
  Opening,
  PlacedElement,
  ProjectFile,
  Stair,
  Vec2,
  Wall,
} from '../types';

const KEY = 'hs:projects';

let seq = 0;
export function uid(): string {
  seq += 1;
  return `e${seq.toString(36)}${Date.now().toString(36).slice(-5)}`;
}

// ---------------------------------------------------------------------------
// Validation — hand-written guards; import rejects anything malformed.
// ---------------------------------------------------------------------------

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';

function isVec2(v: unknown): v is Vec2 {
  const o = v as Vec2;
  return !!o && num(o.x) && num(o.z);
}

const FLOORS = new Set([-1, 0, 1, 2]);

function baseOk(o: { id?: unknown; floor?: unknown; color?: unknown }): boolean {
  return str(o.id) && FLOORS.has(o.floor as number) && str(o.color);
}

export function isValidElement(v: unknown): v is PlacedElement {
  const o = v as PlacedElement;
  if (!o || !baseOk(o)) return false;
  switch (o.kind) {
    case 'wall': {
      const w = o as Wall;
      return isVec2(w.a) && isVec2(w.b) && num(w.heightIn) && num(w.thickIn) && str(w.textureId);
    }
    case 'door':
    case 'window': {
      const p = o as Opening;
      return str(p.wallId) && num(p.centerIn) && num(p.widthIn) && num(p.heightIn) && num(p.sillIn) && str(p.styleId);
    }
    case 'stair': {
      const s = o as Stair;
      return (
        num(s.x) && num(s.z) && num(s.yawDeg) && num(s.widthIn) && num(s.runIn) &&
        (s.flights === 1 || s.flights === 2) && str(s.styleId) && str(s.textureId)
      );
    }
    case 'slab': {
      const s = o as FloorSlab;
      return Array.isArray(s.polygon) && s.polygon.length >= 3 && s.polygon.every(isVec2) && str(s.textureId);
    }
    default:
      return false;
  }
}

export function isValidProject(v: unknown): v is HomeProject {
  const o = v as HomeProject;
  return (
    !!o &&
    str(o.id) &&
    str(o.name) &&
    typeof o.meta === 'object' &&
    o.meta !== null &&
    Array.isArray(o.elements) &&
    o.elements.every(isValidElement) &&
    str(o.createdAt)
  );
}

// ---------------------------------------------------------------------------
// Library (localStorage)
// ---------------------------------------------------------------------------

export function listProjects(): HomeProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidProject);
  } catch {
    return [];
  }
}

export function saveProject(project: HomeProject): void {
  project.updatedAt = new Date().toISOString();
  const all = listProjects();
  const i = all.findIndex((p) => p.id === project.id);
  if (i >= 0) all[i] = project;
  else all.push(project);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    throw new Error('Storage is full — try exporting and deleting an old home.');
  }
}

export function deleteProject(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listProjects().filter((p) => p.id !== id)));
  } catch {
    /* ignore */
  }
}

export function getProject(id: string): HomeProject | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function newProject(name: string, meta: HomeMeta): HomeProject {
  const now = new Date().toISOString();
  return { id: `h${uid()}`, name, meta, elements: [], createdAt: now, updatedAt: now };
}

// ---------------------------------------------------------------------------
// File export / import
// ---------------------------------------------------------------------------

export function parseProjectFile(text: string): HomeProject | null {
  try {
    const data = JSON.parse(text) as ProjectFile;
    if (data.version !== 1 || data.kind !== 'home-studio-project') return null;
    return isValidProject(data.project) ? data.project : null;
  } catch {
    return null;
  }
}

export function exportProject(project: HomeProject): void {
  const file: ProjectFile = { version: 1, kind: 'home-studio-project', project };
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'home'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function importProjectFile(file: File): Promise<HomeProject | null> {
  return file.text().then(parseProjectFile);
}
