import type { FinetuneAxis } from '../interact/buildTools';

export interface FinetuneHandlers {
  title: string;
  axes: FinetuneAxis[];
  onChange(values: Record<string, number>): void;
  onConfirm(): void;
  onCancel(): void;
}

export interface FinetunePanel {
  open(h: FinetuneHandlers): void;
  close(): void;
  isOpen(): boolean;
  /** reflect whether the current offsets are placeable (toggles the ✓ button) */
  setValid(valid: boolean, msg?: string): void;
}

/** The location finetuner: a floating card of offset sliders (+ typed values)
 * with a green ✓ to commit and ✕ to cancel. Reused by any deferred placement. */
export function buildFinetunePanel(root: HTMLElement): FinetunePanel {
  const panel = document.createElement('div');
  panel.className = 'hs-finetune';
  panel.style.display = 'none';
  root.appendChild(panel);

  let handlers: FinetuneHandlers | null = null;
  let values: Record<string, number> = {};
  let okBtn: HTMLButtonElement | null = null;

  const rebuild = (h: FinetuneHandlers): void => {
    values = {};
    for (const a of h.axes) values[a.key] = a.value;

    panel.innerHTML = `
      <div class="hs-ft-head">
        <span>◈ ${h.title}</span>
        <span class="hs-ft-hint">nudge, then place</span>
      </div>
      <div class="hs-ft-axes" data-k="axes"></div>
      <div class="hs-ft-actions">
        <button class="hs-ft-cancel" data-k="cancel" title="Cancel">✕</button>
        <button class="hs-ft-ok" data-k="ok" title="Place">✓ Place</button>
      </div>`;
    const axesEl = panel.querySelector('[data-k="axes"]') as HTMLElement;

    for (const a of h.axes) {
      const row = document.createElement('div');
      row.className = 'hs-ft-row';
      const label = document.createElement('label');
      label.textContent = a.label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(a.min);
      slider.max = String(a.max);
      slider.step = String(a.step);
      slider.value = String(a.value);
      slider.className = 'hs-ft-slider';
      const num = document.createElement('input');
      num.type = 'number';
      num.min = String(a.min);
      num.max = String(a.max);
      num.step = String(a.step);
      num.value = String(a.value);
      num.className = 'hs-ft-num';
      const clamp = (n: number): number => Math.max(a.min, Math.min(a.max, n));
      const push = (n: number, from: 'slider' | 'num'): void => {
        const c = clamp(n);
        values[a.key] = c;
        if (from !== 'slider') slider.value = String(c);
        if (from !== 'num') num.value = String(c);
        handlers?.onChange({ ...values });
      };
      slider.addEventListener('input', () => push(Number(slider.value), 'slider'));
      num.addEventListener('input', () => {
        const n = Number(num.value);
        if (Number.isFinite(n)) push(n, 'num');
      });
      row.append(label, slider, num);
      axesEl.appendChild(row);
    }

    okBtn = panel.querySelector('[data-k="ok"]') as HTMLButtonElement;
    (panel.querySelector('[data-k="cancel"]') as HTMLButtonElement).addEventListener('click', () => handlers?.onCancel());
    okBtn.addEventListener('click', () => handlers?.onConfirm());
  };

  return {
    open(h) {
      handlers = h;
      rebuild(h);
      panel.style.display = '';
      h.onChange({ ...values });
    },
    close() {
      handlers = null;
      panel.style.display = 'none';
    },
    isOpen: () => handlers !== null,
    setValid(valid, msg) {
      if (!okBtn) return;
      okBtn.disabled = !valid;
      okBtn.title = valid ? 'Place' : msg ?? "Doesn't fit here";
    },
  };
}
