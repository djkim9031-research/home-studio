import { getMpKey, setMpKey } from './extract';

/** Collapsible reference panel embedding the house's Matterport walkthrough.
 * With the SDK key attached, "Pull layout" extracts every scan position and
 * builds measured floor outlines. */
export function buildMatterportPanel(
  root: HTMLElement,
  modelId: string | null,
  onPull?: (iframe: HTMLIFrameElement, setBusy: (b: boolean) => void) => void,
): void {
  if (!modelId) return;
  const key = getMpKey();
  const panel = document.createElement('div');
  panel.className = 'hs-mp-panel';
  const src = key
    ? `https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&brand=0&play=1&applicationKey=${encodeURIComponent(key)}`
    : `https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&brand=0&play=0`;
  panel.innerHTML = `
    <div class="head">
      <span>Matterport tour</span>
      <span style="display:flex;gap:6px;">
        <button class="ui-btn" data-k="pull" title="Measure the footprint from the tour's scan points">⤓ Pull layout</button>
        <button class="ui-btn" data-k="toggle">—</button>
      </span>
    </div>
    <div class="hs-mp-key" data-k="keyrow" style="display:${key ? 'none' : 'flex'};gap:6px;padding:8px 10px;align-items:center;">
      <input type="password" data-k="key" placeholder="Matterport SDK key (stays in this browser)" style="flex:1;padding:6px 8px;border:1px solid var(--hairline);border-radius:6px;background:#fffdf8;font:inherit;">
      <button class="ui-btn" data-k="keysave">Save</button>
    </div>
    <iframe
      src="${src}"
      allow="fullscreen; vr; xr-spatial-tracking"
      title="Matterport walkthrough"></iframe>`;
  root.appendChild(panel);
  const keyInput = panel.querySelector('[data-k="key"]') as HTMLInputElement;
  (panel.querySelector('[data-k="keysave"]') as HTMLButtonElement).addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (!v) return;
    setMpKey(v);
    panel.remove();
    buildMatterportPanel(root, modelId, onPull); // rebuild with the key attached
  });
  const iframe = panel.querySelector('iframe')!;
  const toggle = panel.querySelector('[data-k="toggle"]') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const hidden = iframe.style.display === 'none';
    iframe.style.display = hidden ? 'block' : 'none';
    toggle.textContent = hidden ? '—' : '▢';
  });
  const pull = panel.querySelector('[data-k="pull"]') as HTMLButtonElement;
  if (!key) pull.disabled = true;
  if (onPull) {
    pull.addEventListener('click', () =>
      onPull(iframe as HTMLIFrameElement, (b) => {
        pull.disabled = b;
        pull.textContent = b ? '⤓ measuring…' : '⤓ Pull layout';
      }),
    );
  } else {
    pull.style.display = 'none';
  }
}
