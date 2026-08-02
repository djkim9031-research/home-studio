import { DEFAULT_DOOR, DEFAULT_STAIR, DEFAULT_WALL_H, DEFAULT_WALL_T, DEFAULT_WINDOW } from '../constants';
import { DOOR_STYLES, FLOOR_TEXTURES, STAIR_STYLES, WALL_TEXTURES, WINDOW_STYLES, type StyleDef, type FinishDef } from '../data/registry';
import { THUMBS } from './thumbnails';

/** What the palette asks main.ts to arm. */
export type ArmSpec =
  | { tool: 'wall'; shape: 'line' | 'rect' | 'circle'; heightIn: number; thickIn: number; color: string; textureId: string }
  | { tool: 'opening'; door: boolean; widthIn: number; heightIn: number; sillIn: number; styleId: string; color: string }
  | { tool: 'stair'; widthIn: number; runIn: number; flights: 1 | 2; styleId: string; textureId: string; color: string }
  | { tool: 'fill'; textureId: string; color: string }
  | { tool: 'wallpaper'; textureId: string; color: string }
  | { tool: 'room' };

export interface Palette {
  /** un-highlight every card (tool disarmed) */
  clearActive(): void;
}

interface CardCtl {
  root: HTMLElement;
  read(): ArmSpec;
}

const CATS: { key: string; label: string }[] = [
  { key: 'walls', label: 'Walls' },
  { key: 'openings', label: 'Doors & Windows' },
  { key: 'stairs', label: 'Stairs' },
  { key: 'flooring', label: 'Flooring' },
  { key: 'wallpaper', label: 'Wallpaper' },
  { key: 'rooms', label: 'Rooms' },
];

export function buildPalette(root: HTMLElement, onArm: (spec: ArmSpec, card: HTMLElement) => void): Palette {
  const wrap = document.createElement('div');
  wrap.className = 'palette hs-palette';
  root.appendChild(wrap);

  const tabs = document.createElement('div');
  tabs.className = 'hs-pal-tabs';
  const cardsEl = document.createElement('div');
  cardsEl.className = 'palette-cards hs-pal-cards';
  wrap.append(tabs, cardsEl);

  const numInput = (label: string, value: number, min: number, max: number): { el: HTMLElement; get(): number } => {
    const span = document.createElement('label');
    span.className = 'hs-pal-field';
    span.innerHTML = `${label} `;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    span.appendChild(input);
    return { el: span, get: () => Math.min(max, Math.max(min, Number(input.value) || value)) };
  };

  const selInput = (label: string, opts: (StyleDef | FinishDef)[], initial?: string): { el: HTMLElement; get(): string } => {
    const span = document.createElement('label');
    span.className = 'hs-pal-field';
    span.innerHTML = `${label} `;
    const sel = document.createElement('select');
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    if (initial) sel.value = initial;
    sel.addEventListener('pointerdown', (e) => e.stopPropagation());
    sel.addEventListener('click', (e) => e.stopPropagation());
    span.appendChild(sel);
    return { el: span, get: () => sel.value };
  };

  const colorInput = (initial: string): { el: HTMLElement; get(): string } => {
    const span = document.createElement('label');
    span.className = 'hs-pal-field';
    span.innerHTML = 'color ';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = initial;
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    span.appendChild(input);
    return { el: span, get: () => input.value };
  };

  const card = (thumb: string, name: string, fields: HTMLElement[], read: () => ArmSpec): CardCtl => {
    const el = document.createElement('div');
    el.className = 'palette-card hs-pal-card';
    el.innerHTML = `${thumb}<span class="card-name">${name}</span>`;
    const controls = document.createElement('div');
    controls.className = 'hs-pal-controls';
    for (const f of fields) controls.appendChild(f);
    el.appendChild(controls);
    el.addEventListener('click', () => onArm(read(), el));
    // adjusting a control on an ALREADY-armed card re-arms with the fresh
    // values — otherwise changing e.g. the shape after arming does nothing
    controls.addEventListener('change', () => {
      if (el.classList.contains('active')) onArm(read(), el);
    });
    return { root: el, read };
  };

  // ---- cards per category --------------------------------------------------

  const byCat = new Map<string, CardCtl[]>();

  {
    const shape = selInput('shape', [
      { id: 'line', label: 'Straight' },
      { id: 'rect', label: 'Rectangle' },
      { id: 'circle', label: 'Circle' },
    ]);
    const h = numInput('H"', DEFAULT_WALL_H, 24, 240);
    const t = numInput('T"', DEFAULT_WALL_T, 2, 24);
    const tex = selInput('finish', WALL_TEXTURES);
    const col = colorInput('#f2eee6');
    byCat.set('walls', [
      card(THUMBS.wall, 'Wall — drag to draw', [shape.el, h.el, t.el, tex.el, col.el], () => ({
        tool: 'wall',
        shape: shape.get() as 'line' | 'rect' | 'circle',
        heightIn: h.get(),
        thickIn: t.get(),
        textureId: tex.get(),
        color: col.get(),
      })),
    ]);
  }

  {
    const dw = numInput('W"', DEFAULT_DOOR.w, 18, 96);
    const dh = numInput('H"', DEFAULT_DOOR.h, 60, 120);
    const ds = selInput('style', DOOR_STYLES);
    const dc = colorInput('#f5f2ea');
    const doorCard = card(THUMBS.door, 'Door — click a wall', [dw.el, dh.el, ds.el, dc.el], () => ({
      tool: 'opening',
      door: true,
      widthIn: dw.get(),
      heightIn: dh.get(),
      sillIn: 0,
      styleId: ds.get(),
      color: dc.get(),
    }));
    const ww = numInput('W"', DEFAULT_WINDOW.w, 12, 120);
    const wh = numInput('H"', DEFAULT_WINDOW.h, 12, 96);
    const ws = numInput('sill"', DEFAULT_WINDOW.sill, 0, 60);
    const wst = selInput('style', WINDOW_STYLES);
    const wc = colorInput('#f5f2ea');
    const winCard = card(THUMBS.window, 'Window — click a wall', [ww.el, wh.el, ws.el, wst.el, wc.el], () => ({
      tool: 'opening',
      door: false,
      widthIn: ww.get(),
      heightIn: wh.get(),
      sillIn: ws.get(),
      styleId: wst.get(),
      color: wc.get(),
    }));
    byCat.set('openings', [doorCard, winCard]);
  }

  {
    const w = numInput('W"', DEFAULT_STAIR.w, 24, 72);
    const run = numInput('run"', DEFAULT_STAIR.run, 60, 260);
    const fl = selInput('flights', [
      { id: '1', label: '1 — straight' },
      { id: '2', label: '2 — U-turn' },
    ]);
    const st = selInput('style', STAIR_STYLES);
    const tex = selInput('tread', FLOOR_TEXTURES);
    const col = colorInput('#ffffff');
    byCat.set('stairs', [
      card(THUMBS.stair, 'Stair — click to place', [w.el, run.el, fl.el, st.el, tex.el, col.el], () => ({
        tool: 'stair',
        widthIn: w.get(),
        runIn: run.get(),
        flights: fl.get() === '2' ? 2 : 1,
        styleId: st.get(),
        textureId: tex.get(),
        color: col.get(),
      })),
    ]);
  }

  {
    const tex = selInput('finish', FLOOR_TEXTURES);
    const col = colorInput('#ffffff');
    byCat.set('flooring', [
      card(THUMBS.floor, 'Flooring — click inside walls', [tex.el, col.el], () => ({
        tool: 'fill',
        textureId: tex.get(),
        color: col.get(),
      })),
    ]);
  }

  {
    const tex = selInput('finish', WALL_TEXTURES);
    const col = colorInput('#e8dfd0');
    // quick swatches: click to load a color into the picker
    const swatches = document.createElement('span');
    swatches.className = 'hs-pal-field hs-swatches';
    for (const c of ['#f2eee6', '#dfe8ee', '#e8dfd0', '#d8e2d0', '#e6d6d2', '#d9d2e6', '#c76f4a', '#5b7a99']) {
      const b = document.createElement('button');
      b.className = 'hs-swatch';
      b.style.background = c;
      b.title = c;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = col.el.querySelector('input') as HTMLInputElement;
        input.value = c;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      swatches.appendChild(b);
    }
    byCat.set('wallpaper', [
      card(THUMBS.wallpaper, 'Wallpaper — click a room or a wall', [tex.el, col.el, swatches], () => ({
        tool: 'wallpaper',
        textureId: tex.get(),
        color: col.get(),
      })),
    ]);
  }

  byCat.set('rooms', [
    card(THUMBS.room, 'Room label — click inside walls', [], () => ({ tool: 'room' })),
  ]);

  // ---- tabs ----------------------------------------------------------------

  let activeCat = 'walls';
  const tabBtns = new Map<string, HTMLButtonElement>();
  const renderCards = (): void => {
    cardsEl.innerHTML = '';
    for (const c of byCat.get(activeCat) ?? []) cardsEl.appendChild(c.root);
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === activeCat);
  };
  for (const cat of CATS) {
    const b = document.createElement('button');
    b.className = 'ui-btn';
    b.textContent = cat.label;
    b.addEventListener('click', () => {
      activeCat = cat.key;
      renderCards();
    });
    tabs.appendChild(b);
    tabBtns.set(cat.key, b);
  }
  renderCards();

  return {
    clearActive() {
      wrap.querySelectorAll('.hs-pal-card.active').forEach((c) => c.classList.remove('active'));
    },
  };
}
