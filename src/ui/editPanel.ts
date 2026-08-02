import { wallDir, wallLen } from '../core/validity';
import { DOOR_STYLES, FLOOR_TEXTURES, STAIR_STYLES, WALL_TEXTURES, WINDOW_STYLES, type FinishDef, type StyleDef } from '../data/registry';
import * as store from '../state/store';
import { polygonSqft, type PlacedElement, type Wall } from '../types';

export interface EditPanel {
  refresh(): void;
}

/** Property editor for the selected element — dimensions, color, finish/style.
 * Docks under the placed list; every commit is one undo step. */
export function buildEditPanel(root: HTMLElement, toast: (msg: string) => void): EditPanel {
  const panel = document.createElement('div');
  panel.className = 'items-panel hs-edit';
  root.appendChild(panel);

  const numRow = (label: string, value: number, onCommit: (v: number) => void): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'hs-edit-row';
    row.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onCommit(v);
    });
    row.appendChild(input);
    return row;
  };

  const selRow = (label: string, opts: (StyleDef | FinishDef)[], value: string, onCommit: (v: string) => void): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'hs-edit-row';
    row.innerHTML = `<span>${label}</span>`;
    const sel = document.createElement('select');
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = value;
    sel.addEventListener('change', () => onCommit(sel.value));
    row.appendChild(sel);
    return row;
  };

  const colorRow = (value: string, onCommit: (v: string) => void): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'hs-edit-row';
    row.innerHTML = `<span>Color</span>`;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
    input.addEventListener('change', () => onCommit(input.value));
    row.appendChild(input);
    return row;
  };

  const refresh = (): void => {
    const s = store.getState();
    const el = s.elements.find((e) => e.id === s.selectedId);
    if (!el) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.innerHTML = `<div class="items-head"><span>${
      { wall: 'Wall', door: 'Door', window: 'Window', stair: 'Stair', slab: 'Floor', room: 'Room' }[el.kind]
    }</span></div>`;
    const body = document.createElement('div');
    body.className = 'hs-edit-body';
    panel.appendChild(body);

    const patch = (p: Partial<PlacedElement>): void => store.updateElement(el.id, p);

    switch (el.kind) {
      case 'wall': {
        body.appendChild(
          numRow('Length (in)', wallLen(el), (v) => {
            if (v < 6) {
              toast('Walls need at least 6 inches of length.');
              refresh();
              return;
            }
            const d = wallDir(el);
            patch({ b: { x: el.a.x + d.x * v, z: el.a.z + d.z * v } } as Partial<Wall>);
          }),
        );
        body.appendChild(
          numRow('Height (in)', el.heightIn, (v) => {
            if (v < 24 || v > 240) {
              toast('Wall height must be 24–240 inches.');
              refresh();
              return;
            }
            patch({ heightIn: v });
          }),
        );
        body.appendChild(
          numRow('Thickness (in)', el.thickIn, (v) => {
            if (v < 2 || v > 24) {
              toast('Wall thickness must be 2–24 inches.');
              refresh();
              return;
            }
            patch({ thickIn: v });
          }),
        );
        body.appendChild(selRow('Finish', WALL_TEXTURES, el.textureId, (v) => patch({ textureId: v })));
        body.appendChild(colorRow(el.color, (v) => patch({ color: v })));
        break;
      }
      case 'door':
      case 'window': {
        const wall = s.elements.find((e): e is Wall => e.kind === 'wall' && e.id === el.wallId);
        const len = wall ? wallLen(wall) : 0;
        body.appendChild(
          numRow('Width (in)', el.widthIn, (v) => {
            if (v < 12 || v > len - 2) {
              toast("That width doesn't fit the wall.");
              refresh();
              return;
            }
            patch({ widthIn: v });
          }),
        );
        body.appendChild(
          numRow('Height (in)', el.heightIn, (v) => {
            if (wall && el.sillIn + v > wall.heightIn) {
              toast('Too tall for this wall.');
              refresh();
              return;
            }
            patch({ heightIn: v });
          }),
        );
        if (el.kind === 'window') {
          body.appendChild(
            numRow('Sill (in)', el.sillIn, (v) => {
              if (wall && v + el.heightIn > wall.heightIn) {
                toast('Too high for this wall.');
                refresh();
                return;
              }
              patch({ sillIn: Math.max(0, v) });
            }),
          );
        }
        body.appendChild(
          numRow('From wall end (in)', el.centerIn - el.widthIn / 2, (v) => {
            const c = v + el.widthIn / 2;
            if (c - el.widthIn / 2 < 1 || c + el.widthIn / 2 > len - 1) {
              toast('That puts it off the wall.');
              refresh();
              return;
            }
            patch({ centerIn: c });
          }),
        );
        body.appendChild(
          selRow('Style', el.kind === 'door' ? DOOR_STYLES : WINDOW_STYLES, el.styleId, (v) => patch({ styleId: v })),
        );
        body.appendChild(colorRow(el.color, (v) => patch({ color: v })));
        break;
      }
      case 'stair': {
        body.appendChild(numRow('Width (in)', el.widthIn, (v) => patch({ widthIn: Math.max(24, v) })));
        body.appendChild(numRow('Run (in)', el.runIn, (v) => patch({ runIn: Math.max(60, v) })));
        body.appendChild(numRow('Rotation (°)', el.yawDeg, (v) => patch({ yawDeg: ((v % 360) + 360) % 360 })));
        body.appendChild(
          selRow('Flights', [
            { id: '1', label: '1 — straight' },
            { id: '2', label: '2 — U-turn' },
          ], String(el.flights), (v) => patch({ flights: v === '2' ? 2 : 1 })),
        );
        body.appendChild(selRow('Style', STAIR_STYLES, el.styleId, (v) => patch({ styleId: v })));
        body.appendChild(selRow('Tread', FLOOR_TEXTURES, el.textureId, (v) => patch({ textureId: v })));
        body.appendChild(colorRow(el.color, (v) => patch({ color: v })));
        break;
      }
      case 'slab': {
        body.appendChild(selRow('Finish', FLOOR_TEXTURES, el.textureId, (v) => patch({ textureId: v })));
        body.appendChild(colorRow(el.color, (v) => patch({ color: v })));
        break;
      }
      case 'room': {
        const row = document.createElement('label');
        row.className = 'hs-edit-row';
        row.innerHTML = `<span>Name</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = el.name;
        input.maxLength = 40;
        input.addEventListener('change', () => {
          const v = input.value.trim();
          if (!v) {
            toast('A room needs a name.');
            refresh();
            return;
          }
          patch({ name: v });
        });
        row.appendChild(input);
        body.appendChild(row);
        const area = document.createElement('div');
        area.className = 'hs-edit-row';
        area.innerHTML = `<span>Area</span><span>${Math.round(polygonSqft(el.polygon))} ft² (${polygonSqft(el.polygon).toFixed(1)})</span>`;
        body.appendChild(area);
        break;
      }
    }

    const del = document.createElement('button');
    del.className = 'ui-btn danger hs-edit-del';
    del.textContent = 'Delete';
    del.addEventListener('click', () => store.deleteElements([el.id]));
    body.appendChild(del);
  };

  refresh();
  return { refresh };
}
