import type { House } from '../types';
import { deleteHouse, exportHouse, importHouseFile, listHouses, saveHouse } from '../state/houses';
import { openIntakeForm } from './intakeForm';

export interface Landing {
  show(): void;
  hide(): void;
}

const DWELLING_LABEL: Record<string, string> = {
  house: 'House',
  apartment: 'Apartment',
  townhouse: 'Townhouse',
  duplex: 'Duplex',
  condo: 'Condo',
};

/** The house library: saved-house cards + New house + import. */
export function buildLanding(
  root: HTMLElement,
  openHouse: (house: House) => void,
): Landing {
  const page = document.createElement('div');
  page.className = 'hs-landing';
  root.appendChild(page);

  const refresh = (): void => {
    page.innerHTML = `
      <h1>Home Studio</h1>
      <div class="sub">Recreate your home in 3D from its floor plan, then design the interior.</div>
      <div class="hs-cards" data-k="cards"></div>`;
    const cards = page.querySelector('[data-k="cards"]') as HTMLDivElement;

    for (const house of listHouses().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const card = document.createElement('div');
      card.className = 'hs-card';
      const tracedStories = house.plans.filter((p) => p.boundaryPx.length >= 3).length;
      const badges = [
        DWELLING_LABEL[house.dwelling],
        `${house.stories} ${house.stories === 1 ? 'story' : 'stories'}`,
        ...(house.basement ? ['basement'] : []),
        ...(house.garage !== 'none' ? [`${house.garage} garage`] : []),
        ...(house.matterportId ? ['matterport'] : []),
        `${tracedStories}/${house.stories} traced`,
      ];
      card.innerHTML = `
        <h3>${escapeHtml(house.name)}</h3>
        <div class="meta">${house.sqft.toLocaleString()} sqft · ${house.adults + house.kids} people${
          house.pets ? ` · ${escapeHtml(house.pets)}` : ''
        }</div>
        <div class="hs-badges">${badges.map((b) => `<span class="hs-badge">${b}</span>`).join('')}</div>
        <div class="hs-card-actions">
          <button class="ui-btn" data-k="open">Open</button>
          <button class="ui-btn" data-k="edit" title="Edit house info">✎</button>
          <button class="ui-btn" data-k="export" title="Export to a file">⇩</button>
          <button class="ui-btn danger" data-k="del" title="Delete">✕</button>
        </div>`;
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.ui-btn')) return;
        openHouse(house);
      });
      (card.querySelector('[data-k="open"]') as HTMLButtonElement).addEventListener('click', () => openHouse(house));
      (card.querySelector('[data-k="edit"]') as HTMLButtonElement).addEventListener('click', async () => {
        const updated = await openIntakeForm(house);
        if (updated) refresh();
      });
      (card.querySelector('[data-k="export"]') as HTMLButtonElement).addEventListener('click', () => exportHouse(house));
      (card.querySelector('[data-k="del"]') as HTMLButtonElement).addEventListener('click', () => {
        if (confirm(`Delete “${house.name}”? This can't be undone.`)) {
          deleteHouse(house.id);
          refresh();
        }
      });
      cards.appendChild(card);
    }

    const add = document.createElement('button');
    add.className = 'hs-card new';
    add.textContent = '+ New house';
    add.addEventListener('click', async () => {
      const house = await openIntakeForm(null);
      if (house) {
        refresh();
        openHouse(house);
      }
    });
    cards.appendChild(add);

    const imp = document.createElement('button');
    imp.className = 'hs-card new';
    imp.textContent = '⇧ Import house file';
    imp.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const house = await importHouseFile(file);
        if (house) {
          saveHouse(house);
          refresh();
        } else {
          alert('That file is not a Home Studio house export.');
        }
      });
      input.click();
    });
    cards.appendChild(imp);
  };

  refresh();
  return {
    show() {
      refresh();
      page.style.display = '';
    },
    hide() {
      page.style.display = 'none';
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
