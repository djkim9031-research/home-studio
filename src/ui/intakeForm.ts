import type { DwellingType, HomeMeta, HomeProject } from '../types';
import { newProject, saveProject } from '../state/projects';

/** The "tell us about the home" modal. Only the name is required — everything
 * else is optional context we can lean on for analytics later. Resolves with
 * the saved project (or the updated one when `existing` is passed), null on
 * cancel. */
export function openIntakeForm(existing: HomeProject | null): Promise<HomeProject | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'hs-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'hs-modal';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.innerHTML = `
      <h2>${existing ? 'Edit home details' : 'New home'}</h2>
      <div class="hs-form">
        <div class="hs-field full">
          <label>Home name</label>
          <input type="text" data-k="name" placeholder="e.g. Willow Creek build" maxlength="60">
        </div>
        <div class="hs-field">
          <label>Dwelling type <small>(optional)</small></label>
          <select data-k="dwelling">
            <option value="">—</option>
            <option value="home">Home</option>
            <option value="townhome">Townhome</option>
            <option value="apartment">Apartment</option>
            <option value="duplex">Duplex</option>
          </select>
        </div>
        <div class="hs-field">
          <label>Garage <small>(optional)</small></label>
          <div class="hs-seg" data-k="garage">
            <button data-v="">—</button><button data-v="0">None</button><button data-v="1">1-car</button><button data-v="2">2-car</button><button data-v="3">3-car</button>
          </div>
        </div>
        <div class="hs-field">
          <label>Size, sqft <small>(optional)</small></label>
          <input type="number" data-k="sqft" min="100" max="30000" step="10" placeholder="1850">
        </div>
        <div class="hs-field">
          <label>Households <small>(optional)</small></label>
          <input type="number" data-k="households" min="1" max="10" placeholder="1">
        </div>
        <div class="hs-field">
          <label>Basement <small>(optional)</small></label>
          <div class="hs-seg" data-k="basement">
            <button data-v="">—</button><button data-v="no">No</button><button data-v="yes">Yes</button>
          </div>
        </div>
        <div class="hs-field">
          <label>Floors <small>(optional, max 3)</small></label>
          <div class="hs-seg" data-k="floors">
            <button data-v="">—</button><button data-v="1">One</button><button data-v="2">Two</button><button data-v="3">Three</button>
          </div>
        </div>
        <div class="hs-err" data-k="err"></div>
        <div class="hs-form-actions">
          <button class="ui-btn" data-k="cancel">Cancel</button>
          <button class="ui-btn primary" data-k="save">${existing ? 'Save changes' : 'Create home'}</button>
        </div>
      </div>`;

    const el = <T extends HTMLElement>(k: string): T => modal.querySelector(`[data-k="${k}"]`) as T;
    const seg = (k: string, initial: string): (() => string) => {
      const wrap = el<HTMLDivElement>(k);
      let value = initial;
      const paint = (): void => {
        wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
      };
      wrap.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          value = (b as HTMLElement).dataset.v!;
          paint();
        }),
      );
      paint();
      return () => value;
    };

    if (existing) {
      el<HTMLInputElement>('name').value = existing.name;
      const m = existing.meta;
      if (m.dwelling) el<HTMLSelectElement>('dwelling').value = m.dwelling;
      if (m.sqft !== undefined) el<HTMLInputElement>('sqft').value = String(m.sqft);
      if (m.households !== undefined) el<HTMLInputElement>('households').value = String(m.households);
    }
    const m0 = existing?.meta;
    const getGarage = seg('garage', m0?.garageCars === undefined ? '' : String(m0.garageCars));
    const getBasement = seg('basement', m0?.basement === undefined ? '' : m0.basement ? 'yes' : 'no');
    const getFloors = seg('floors', m0?.floors === undefined ? '' : String(m0.floors));

    const done = (result: HomeProject | null): void => {
      overlay.remove();
      resolve(result);
    };
    el<HTMLButtonElement>('cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) done(null);
    });

    el<HTMLButtonElement>('save').addEventListener('click', () => {
      const err = el<HTMLDivElement>('err');
      const name = el<HTMLInputElement>('name').value.trim();
      if (!name) {
        err.textContent = 'Give the home a name.';
        return;
      }
      const sqftRaw = el<HTMLInputElement>('sqft').value.trim();
      const hhRaw = el<HTMLInputElement>('households').value.trim();
      const meta: HomeMeta = {};
      const dwelling = el<HTMLSelectElement>('dwelling').value;
      if (dwelling) meta.dwelling = dwelling as DwellingType;
      if (getGarage() !== '') meta.garageCars = Number(getGarage());
      if (sqftRaw) meta.sqft = Number(sqftRaw);
      if (hhRaw) meta.households = Number(hhRaw);
      if (getBasement() !== '') meta.basement = getBasement() === 'yes';
      if (getFloors() !== '') meta.floors = Number(getFloors()) as 1 | 2 | 3;

      const project: HomeProject = existing ? { ...existing, name, meta } : newProject(name, meta);
      try {
        saveProject(project);
      } catch (e) {
        err.textContent = (e as Error).message;
        return;
      }
      done(project);
    });
  });
}
