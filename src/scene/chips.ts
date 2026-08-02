import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** A floating CSS2D label. Caller positions it (meters) and sets textContent. */
export function makeChip(className = 'chip'): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 0.5);
  return obj;
}

export function setChipText(chip: CSS2DObject, text: string): void {
  (chip.element as HTMLElement).textContent = text;
}
