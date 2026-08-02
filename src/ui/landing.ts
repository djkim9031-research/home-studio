import type { HomeProject } from '../types';
import { deleteProject, exportProject, importProjectFile, listProjects, saveProject } from '../state/projects';
import { openIntakeForm } from './intakeForm';

export interface Landing {
  show(): void;
  hide(): void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Front page: the home library. Create a new home, open one, or move homes
 * between machines with JSON export/import. */
export function buildLanding(root: HTMLElement, openProject: (p: HomeProject) => void): Landing {
  const el = document.createElement('div');
  el.className = 'hs-landing';
  root.appendChild(el);

  const badges = (p: HomeProject): string => {
    const m = p.meta;
    const out: string[] = [];
    if (m.dwelling) out.push(m.dwelling);
    if (m.floors) out.push(`${m.floors} floor${m.floors > 1 ? 's' : ''}`);
    if (m.basement) out.push('basement');
    if (m.garageCars) out.push(`${m.garageCars}-car garage`);
    const walls = p.elements.filter((e) => e.kind === 'wall').length;
    if (walls) out.push(`${walls} walls`);
    return out.map((b) => `<span class="hs-badge">${escapeHtml(b)}</span>`).join('');
  };

  const refresh = (): void => {
    const projects = listProjects().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    el.innerHTML = `
      <h1>Home Studio</h1>
      <div class="sub">Build your home in 3D — walls, doors, windows, stairs and floors, under a real sun.</div>
      <div class="hs-cards">
        ${projects
          .map(
            (p) => `
          <div class="hs-card" data-id="${p.id}">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="meta">${p.meta.sqft ? `${p.meta.sqft.toLocaleString()} sqft · ` : ''}${p.elements.length} pieces</div>
            <div class="hs-badges">${badges(p)}</div>
            <div class="hs-card-actions">
              <button class="ui-btn" data-act="open">Open</button>
              <button class="ui-btn" data-act="edit" title="Edit home details">✎</button>
              <button class="ui-btn" data-act="export" title="Export as JSON">⇩</button>
              <button class="ui-btn danger" data-act="delete" title="Delete">✕</button>
            </div>
          </div>`,
          )
          .join('')}
        <div class="hs-card new" data-k="new">+ New home</div>
        <div class="hs-card new" data-k="import">⇧ Import home file</div>
      </div>`;

    el.querySelectorAll<HTMLElement>('.hs-card[data-id]').forEach((card) => {
      const id = card.dataset.id!;
      card.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest('.ui-btn') as HTMLElement | null;
        const project = listProjects().find((p) => p.id === id);
        if (!project) return;
        if (!btn) {
          openProject(project);
          return;
        }
        switch (btn.dataset.act) {
          case 'open':
            openProject(project);
            break;
          case 'edit':
            if (await openIntakeForm(project)) refresh();
            break;
          case 'export':
            exportProject(project);
            break;
          case 'delete':
            if (confirm(`Delete “${project.name}”? This can't be undone.`)) {
              deleteProject(id);
              refresh();
            }
            break;
        }
      });
    });

    (el.querySelector('[data-k="new"]') as HTMLElement).addEventListener('click', async () => {
      const project = await openIntakeForm(null);
      if (project) openProject(project); // straight into the builder
    });

    (el.querySelector('[data-k="import"]') as HTMLElement).addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const project = await importProjectFile(file);
        if (!project) {
          alert('Could not read that home file.');
          return;
        }
        saveProject(project);
        refresh();
      });
      input.click();
    });
  };

  refresh();
  return {
    show() {
      refresh();
      el.style.display = '';
    },
    hide() {
      el.style.display = 'none';
    },
  };
}
