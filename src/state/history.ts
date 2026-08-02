import type { PlacedElement } from '../types';

const MAX = 100;

// deep clone: elements carry nested vectors/polygons (a/b, polygon)
const clone = (els: PlacedElement[]): PlacedElement[] => structuredClone(els);

let past: PlacedElement[][] = [];
let future: PlacedElement[][] = [];

/** Record the state as it was BEFORE a mutation. */
export function push(els: PlacedElement[]): void {
  past.push(clone(els));
  if (past.length > MAX) past.shift();
  future = [];
}

export function undo(current: PlacedElement[]): PlacedElement[] | null {
  const prev = past.pop();
  if (!prev) return null;
  future.push(clone(current));
  return prev;
}

export function redo(current: PlacedElement[]): PlacedElement[] | null {
  const next = future.pop();
  if (!next) return null;
  past.push(clone(current));
  return next;
}

export const canUndo = (): boolean => past.length > 0;
export const canRedo = (): boolean => future.length > 0;

export function reset(): void {
  past = [];
  future = [];
}
