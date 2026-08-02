import type { House, HouseFile, StoryPlan } from '../types';
import { emptyStoryPlan } from '../types';

const KEY = 'hs:houses';

let seq = 0;
export const uid = (): string => `h${(++seq).toString(36)}${Date.now().toString(36).slice(-5)}`;

const DWELLINGS = new Set(['house', 'apartment', 'townhouse', 'duplex', 'condo']);
const GARAGES = new Set(['none', '1-car', '2-car']);

function isVec2Array(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        Number.isFinite((p as Record<string, unknown>).x) &&
        Number.isFinite((p as Record<string, unknown>).z),
    )
  );
}

function isValidPlan(p: unknown): p is StoryPlan {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    (o.imageData === null || typeof o.imageData === 'string') &&
    Number.isFinite(o.imageW) &&
    Number.isFinite(o.imageH) &&
    Number.isFinite(o.inPerPx) &&
    isVec2Array(o.boundaryPx) &&
    Array.isArray(o.wallsPx) &&
    (o.wallsPx as unknown[]).every(isVec2Array) &&
    Array.isArray(o.openingsPx) &&
    Number.isFinite(o.wallHeightIn)
  );
}

export function isValidHouse(h: unknown): h is House {
  if (typeof h !== 'object' || h === null) return false;
  const o = h as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    o.name.length > 0 &&
    Number.isFinite(o.adults) &&
    Number.isFinite(o.kids) &&
    typeof o.pets === 'string' &&
    Number.isFinite(o.sqft) &&
    (o.stories === 1 || o.stories === 2 || o.stories === 3) &&
    typeof o.basement === 'boolean' &&
    GARAGES.has(o.garage as string) &&
    DWELLINGS.has(o.dwelling as string) &&
    (o.matterportId === null || typeof o.matterportId === 'string') &&
    Array.isArray(o.plans) &&
    (o.plans as unknown[]).every(isValidPlan) &&
    (o.basementPlan === null || isValidPlan(o.basementPlan)) &&
    typeof o.createdAt === 'string'
  );
}

export function listHouses(): House[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr) ? (arr.filter(isValidHouse) as House[]) : [];
  } catch {
    return [];
  }
}

export function saveHouse(house: House): void {
  const all = listHouses().filter((h) => h.id !== house.id);
  all.push(house);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    // plans as dataURLs can exceed the quota — surface it to the caller
    throw new Error('Storage full — try a smaller plan image, or export the house to a file.');
  }
}

export function deleteHouse(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listHouses().filter((h) => h.id !== id)));
  } catch {
    /* ignore */
  }
}

export function getHouse(id: string): House | null {
  return listHouses().find((h) => h.id === id) ?? null;
}

/** Fresh house from intake-form fields (plans start empty per story). */
export function newHouse(fields: Omit<House, 'id' | 'plans' | 'basementPlan' | 'createdAt'>): House {
  return {
    ...fields,
    id: uid(),
    plans: Array.from({ length: fields.stories }, () => emptyStoryPlan()),
    basementPlan: fields.basement ? emptyStoryPlan(96) : null,
    createdAt: new Date().toISOString(),
  };
}

/** Extract a Matterport model id from a pasted URL (or bare id). */
export function parseMatterportId(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const m = t.match(/[?&]m=([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{8,}$/.test(t)) return t;
  return null;
}

// --- file export/import ------------------------------------------------------

export function parseHouseFile(text: string): House | null {
  try {
    const data = JSON.parse(text) as HouseFile;
    if (data.version !== 1 || data.kind !== 'home-studio-house') return null;
    return isValidHouse(data.house) ? data.house : null;
  } catch {
    return null;
  }
}

export function exportHouse(house: House): void {
  const file: HouseFile = { version: 1, kind: 'home-studio-house', house };
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${house.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'house'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function importHouseFile(file: File): Promise<House | null> {
  return file.text().then(parseHouseFile);
}
