import { formatFeetInches } from '../core/format';
import { wallLen } from '../core/validity';
import * as store from '../state/store';
import { categoryOf, MODE_CATEGORIES, polygonSqft, type BuildCategory, type PlacedElement } from '../types';

export interface PlacedPanel {
  refresh(): void;
}

const CAT_LABELS: Record<BuildCategory, string> = {
  walls: 'Walls',
  openings: 'Doors & Windows',
  stairs: 'Stairs',
  flooring: 'Flooring',
  paint: 'Paint',
  wallpaper: 'Wallpaper',
  rooms: 'Rooms',
};

const FLOOR_TAG: Record<number, string> = { [-1]: 'B', 0: 'G', 1: '2', 2: '3' };

function rowLabel(e: PlacedElement, n: number): string {
  switch (e.kind) {
    case 'wall':
      return `Wall ${n} · ${formatFeetInches(wallLen(e))}`;
    case 'door':
      return `Door ${n} · ${e.widthIn}″×${e.heightIn}″`;
    case 'window':
      return `Window ${n} · ${e.widthIn}″×${e.heightIn}″`;
    case 'stair':
      return `Stair ${n} · ${e.flights === 2 ? 'U-turn' : 'straight'}`;
    case 'slab':
      return `Floor ${n}`;
    case 'room':
      return `${e.name} · ${Math.round(polygonSqft(e.polygon))} ft²`;
  }
}

/** Right-hand list of everything placed, grouped by collapsible category and
 * scoped to the current mode's categories. Click a row to select + edit. */
export function buildPlacedPanel(root: HTMLElement): PlacedPanel {
  const panel = document.createElement('div');
  panel.className = 'items-panel hs-placed';
  root.appendChild(panel);

  // categories start collapsed; expanded ones are remembered across refreshes
  const expanded = new Set<BuildCategory>();

  const refresh = (): void => {
    const s = store.getState();
    const cats = MODE_CATEGORIES[s.mode];
    const els = s.elements.filter((e) => cats.includes(categoryOf(e)));
    if (!els.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';

    // auto-expand the category that holds the current selection, and preserve
    // the list's scroll position so locking an item doesn't jump the view
    if (s.selectedId) {
      const sel = els.find((e) => e.id === s.selectedId);
      if (sel) expanded.add(categoryOf(sel));
    }
    const prevScroll = (panel.querySelector('.items-list') as HTMLElement | null)?.scrollTop ?? 0;

    panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'items-head';
    head.innerHTML = `<span>Placed (${els.length})</span>`;
    const clear = document.createElement('button');
    clear.className = 'ui-btn danger';
    clear.textContent = 'Delete all';
    clear.addEventListener('click', () => store.deleteElements(els.map((e) => e.id)));
    head.appendChild(clear);
    panel.appendChild(head);

    const list = document.createElement('div');
    list.className = 'items-list';
    panel.appendChild(list);

    for (const cat of cats) {
      const inCat = els.filter((e) => categoryOf(e) === cat);
      if (!inCat.length) continue;
      const open = expanded.has(cat);
      const catHead = document.createElement('div');
      catHead.className = 'item-row set-head';
      catHead.innerHTML = `<span class="item-label">${open ? '▾' : '▸'} ${CAT_LABELS[cat]} (${inCat.length})</span>`;
      catHead.addEventListener('click', () => {
        if (expanded.has(cat)) expanded.delete(cat);
        else expanded.add(cat);
        refresh();
      });
      list.appendChild(catHead);
      if (!open) continue;
      let n = 0;
      for (const e of inCat) {
        n += 1;
        const row = document.createElement('div');
        row.className = 'item-row in-set' + (s.selectedIds.includes(e.id) ? ' selected' : '');
        const label = document.createElement('span');
        label.className = 'item-label';
        label.textContent = `${rowLabel(e, n)} · ${FLOOR_TAG[e.floor]}`;
        const del = document.createElement('button');
        del.className = 'ui-btn danger row-del';
        del.textContent = '✕';
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          store.deleteElements([e.id]);
        });
        row.append(label, del);
        row.addEventListener('click', () => store.select(s.selectedIds.includes(e.id) ? null : e.id));
        list.appendChild(row);
      }
    }

    list.scrollTop = prevScroll;
    // make sure the freshly selected row is actually in view
    const selRow = list.querySelector('.item-row.selected') as HTMLElement | null;
    if (selRow) {
      const top = selRow.offsetTop;
      const bottom = top + selRow.offsetHeight;
      if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
        selRow.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  refresh();
  return { refresh };
}
