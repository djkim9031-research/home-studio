import type { DwellingType, GarageType, House } from '../types';
import { newHouse, parseMatterportId, saveHouse } from '../state/houses';
import { loadPlanFile } from '../plan/planLoader';

/** The "tell us about the house" modal. Resolves with the saved house (or an
 * updated one when `existing` is passed), null on cancel. */
export function openIntakeForm(existing: House | null): Promise<House | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'hs-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'hs-modal';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.innerHTML = `
      <h2>${existing ? 'Edit house' : 'New house'}</h2>
      <div class="hs-form">
        <div class="hs-field full">
          <label>House name</label>
          <input type="text" data-k="name" placeholder="e.g. Willow Creek house" maxlength="60">
        </div>
        <div class="hs-field">
          <label>Household</label>
          <div class="row">
            <input type="number" data-k="adults" min="0" max="20" value="2" title="adults"> adults
            <input type="number" data-k="kids" min="0" max="20" value="0" title="kids"> kids
          </div>
        </div>
        <div class="hs-field">
          <label>Pets</label>
          <input type="text" data-k="pets" placeholder="e.g. 1 corgi, 2 cats">
        </div>
        <div class="hs-field">
          <label>Size (sqft)</label>
          <input type="number" data-k="sqft" min="100" max="30000" step="10" placeholder="1850">
        </div>
        <div class="hs-field">
          <label>Dwelling type</label>
          <select data-k="dwelling">
            <option value="house">House</option>
            <option value="apartment">Apartment</option>
            <option value="townhouse">Townhouse</option>
            <option value="duplex">Duplex</option>
            <option value="condo">Condo</option>
          </select>
        </div>
        <div class="hs-field">
          <label>Stories</label>
          <div class="hs-seg" data-k="stories">
            <button data-v="1">One</button><button data-v="2">Two</button><button data-v="3">Three</button>
          </div>
        </div>
        <div class="hs-field">
          <label>Garage</label>
          <div class="hs-seg" data-k="garage">
            <button data-v="none">None</button><button data-v="1-car">1-car</button><button data-v="2-car">2-car</button>
          </div>
        </div>
        <div class="hs-field">
          <label>Basement</label>
          <div class="hs-seg" data-k="basement">
            <button data-v="no">No</button><button data-v="yes">Yes</button>
          </div>
        </div>
        <div class="hs-field">
          <label>Matterport tour (optional)</label>
          <input type="url" data-k="mp" placeholder="https://my.matterport.com/show/?m=…">
        </div>
        <div class="hs-field full">
          <label>Floor plans (image or PDF, one per story — optional now, needed to build the 3D model)</label>
          <div data-k="drops"></div>
        </div>
        <div class="hs-err" data-k="err"></div>
        <div class="hs-form-actions">
          <button class="ui-btn" data-k="cancel">Cancel</button>
          <button class="ui-btn primary" data-k="save">${existing ? 'Save changes' : 'Create house'}</button>
        </div>
      </div>`;

    const el = <T extends HTMLElement>(k: string): T => modal.querySelector(`[data-k="${k}"]`) as T;
    const seg = (k: string, initial: string, onSet?: (v: string) => void): (() => string) => {
      const wrap = el<HTMLDivElement>(k);
      let value = initial;
      const paint = (): void => {
        wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
      };
      wrap.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          value = (b as HTMLElement).dataset.v!;
          paint();
          onSet?.(value);
        }),
      );
      paint();
      return () => value;
    };

    // per-story plan slots (rebuilt when the story count changes)
    const drops = el<HTMLDivElement>('drops');
    const planData = new Map<string, { imageData: string; imageW: number; imageH: number }>();
    const rebuildDrops = (stories: number, basement: boolean): void => {
      drops.innerHTML = '';
      const slots = [
        ...Array.from({ length: stories }, (_, i) => ({ key: `s${i}`, label: `Story ${i + 1}` })),
        ...(basement ? [{ key: 'b', label: 'Basement' }] : []),
      ];
      for (const slot of slots) {
        const d = document.createElement('div');
        d.className = 'hs-plan-drop' + (planData.has(slot.key) ? ' has' : '');
        d.style.marginBottom = '6px';
        d.textContent = planData.has(slot.key)
          ? `${slot.label}: plan loaded ✓ (click to replace)`
          : `${slot.label}: click to choose an image or PDF`;
        d.addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/png,image/jpeg,image/webp,application/pdf,.pdf';
          input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            d.textContent = `${slot.label}: loading…`;
            try {
              const plan = await loadPlanFile(file);
              planData.set(slot.key, plan);
              d.classList.add('has');
              d.textContent = `${slot.label}: plan loaded ✓ (click to replace)`;
            } catch (e) {
              d.textContent = `${slot.label}: ${(e as Error).message}`;
            }
          });
          input.click();
        });
        drops.appendChild(d);
      }
    };

    // prefill
    if (existing) {
      el<HTMLInputElement>('name').value = existing.name;
      el<HTMLInputElement>('adults').value = String(existing.adults);
      el<HTMLInputElement>('kids').value = String(existing.kids);
      el<HTMLInputElement>('pets').value = existing.pets;
      el<HTMLInputElement>('sqft').value = String(existing.sqft);
      (el<HTMLSelectElement>('dwelling') as HTMLSelectElement).value = existing.dwelling;
      if (existing.matterportId) el<HTMLInputElement>('mp').value = `https://my.matterport.com/show/?m=${existing.matterportId}`;
      existing.plans.forEach((p, i) => {
        if (p.imageData) planData.set(`s${i}`, { imageData: p.imageData, imageW: p.imageW, imageH: p.imageH });
      });
      if (existing.basementPlan?.imageData) {
        planData.set('b', {
          imageData: existing.basementPlan.imageData,
          imageW: existing.basementPlan.imageW,
          imageH: existing.basementPlan.imageH,
        });
      }
    }
    const getStories = seg('stories', String(existing?.stories ?? 1), () =>
      rebuildDrops(Number(getStories()), getBasement() === 'yes'),
    );
    const getGarage = seg('garage', existing?.garage ?? 'none');
    const getBasement = seg('basement', existing?.basement ? 'yes' : 'no', () =>
      rebuildDrops(Number(getStories()), getBasement() === 'yes'),
    );
    rebuildDrops(Number(getStories()), getBasement() === 'yes');

    const done = (result: House | null): void => {
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
      const sqft = Number(el<HTMLInputElement>('sqft').value);
      const mpRaw = el<HTMLInputElement>('mp').value.trim();
      const matterportId = mpRaw ? parseMatterportId(mpRaw) : null;
      if (!name) {
        err.textContent = 'Give the house a name.';
        return;
      }
      if (!Number.isFinite(sqft) || sqft < 100) {
        err.textContent = 'Enter the size in square feet.';
        return;
      }
      if (mpRaw && !matterportId) {
        err.textContent = 'That Matterport link doesn’t look right — expected …show/?m=MODELID.';
        return;
      }
      const stories = Number(getStories()) as 1 | 2 | 3;
      const basement = getBasement() === 'yes';
      const fields = {
        name,
        adults: Math.max(0, Number(el<HTMLInputElement>('adults').value) || 0),
        kids: Math.max(0, Number(el<HTMLInputElement>('kids').value) || 0),
        pets: el<HTMLInputElement>('pets').value.trim(),
        sqft,
        stories,
        basement,
        garage: getGarage() as GarageType,
        dwelling: el<HTMLSelectElement>('dwelling').value as DwellingType,
        matterportId,
      };
      const house: House = existing
        ? {
            ...existing,
            ...fields,
            plans: Array.from({ length: stories }, (_, i) => existing.plans[i] ?? emptyPlanLike()),
            basementPlan: basement ? (existing.basementPlan ?? emptyPlanLike(96)) : null,
          }
        : newHouse(fields);
      // fold in any newly loaded plan rasters (keeps existing tracing when the
      // image is unchanged; replacing an image resets that story's tracing)
      const applyPlan = (key: string, idx: number | 'b'): void => {
        const data = planData.get(key);
        if (!data) return;
        const target = idx === 'b' ? house.basementPlan : house.plans[idx];
        if (!target || target.imageData === data.imageData) return;
        target.imageData = data.imageData;
        target.imageW = data.imageW;
        target.imageH = data.imageH;
        target.inPerPx = 0;
        target.boundaryPx = [];
        target.wallsPx = [];
        target.openingsPx = [];
      };
      for (let i = 0; i < stories; i++) applyPlan(`s${i}`, i);
      if (basement) applyPlan('b', 'b');
      try {
        saveHouse(house);
      } catch (e) {
        err.textContent = (e as Error).message;
        return;
      }
      done(house);
    });
  });
}

function emptyPlanLike(wallHeightIn = 108) {
  return {
    imageData: null,
    imageW: 0,
    imageH: 0,
    inPerPx: 0,
    boundaryPx: [],
    wallsPx: [],
    openingsPx: [],
    wallHeightIn,
  };
}
