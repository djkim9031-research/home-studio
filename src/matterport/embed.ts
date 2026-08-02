import { getMpKey, setMpKey } from './extract';

/** Collapsible reference panel embedding the house's Matterport walkthrough.
 * With the SDK key attached, "Pull layout" extracts every scan position and
 * builds measured floor outlines. */
export function buildMatterportPanel(
  root: HTMLElement,
  modelId: string | null,
  onPull?: (setBusy: (b: boolean) => void) => void,
): void {
  if (!modelId) return;
  const panel = document.createElement('div');
  panel.className = 'hs-mp-panel';
  // the visible tour NEVER carries the key — a bad key or missing allowlist
  // entry must not break the walkthrough; the SDK uses its own hidden player
  panel.innerHTML = `
    <div class="head">
      <span>Matterport tour</span>
      <span style="display:flex;gap:6px;">
        <button class="ui-btn" data-k="pull" title="Measure the footprint from the tour's scan points">⤓ Pull layout</button>
        <button class="ui-btn" data-k="keyedit" title="Set or change your Matterport SDK key">✎ key</button>
        <button class="ui-btn" data-k="toggle">—</button>
      </span>
    </div>
    <div class="hs-mp-key" data-k="keyrow" style="display:none;gap:6px;padding:8px 10px;align-items:center;flex-wrap:wrap;">
      <input type="password" data-k="key" placeholder="Matterport SDK key (stays in this browser)" style="flex:1;min-width:180px;padding:6px 8px;border:1px solid var(--hairline);border-radius:6px;background:#fffdf8;font:inherit;">
      <button class="ui-btn" data-k="keysave">Save</button>
      <button class="ui-btn danger" data-k="keyclear" title="Forget the saved key">✕</button>
      <small style="width:100%;color:#7a7266;">Create one at my.matterport.com → Settings → Developer Tools, and add
      <b>${location.hostname || 'localhost'}</b> to its allow list.</small>
    </div>
    <iframe
      src="https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&brand=0&play=0"
      allow="fullscreen; vr; xr-spatial-tracking"
      title="Matterport walkthrough"></iframe>`;
  root.appendChild(panel);

  const keyRow = panel.querySelector('[data-k="keyrow"]') as HTMLDivElement;
  const keyInput = panel.querySelector('[data-k="key"]') as HTMLInputElement;
  const pull = panel.querySelector('[data-k="pull"]') as HTMLButtonElement;
  const refreshKeyState = (): void => {
    pull.disabled = !getMpKey();
    pull.title = getMpKey()
      ? 'Measure the footprint from the tour’s scan points'
      : 'Save your SDK key first (✎ key)';
  };
  (panel.querySelector('[data-k="keyedit"]') as HTMLButtonElement).addEventListener('click', () => {
    keyRow.style.display = keyRow.style.display === 'none' ? 'flex' : 'none';
    keyInput.value = getMpKey() ?? '';
  });
  (panel.querySelector('[data-k="keysave"]') as HTMLButtonElement).addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (v) setMpKey(v);
    keyRow.style.display = 'none';
    refreshKeyState();
  });
  (panel.querySelector('[data-k="keyclear"]') as HTMLButtonElement).addEventListener('click', () => {
    setMpKey(null);
    keyInput.value = '';
    keyRow.style.display = 'none';
    refreshKeyState();
  });
  if (!getMpKey()) keyRow.style.display = 'flex'; // first run: invite the key

  const iframe = panel.querySelector('iframe')!;
  const toggle = panel.querySelector('[data-k="toggle"]') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const hidden = iframe.style.display === 'none';
    iframe.style.display = hidden ? 'block' : 'none';
    toggle.textContent = hidden ? '—' : '▢';
  });
  if (onPull) {
    pull.addEventListener('click', () =>
      onPull((b) => {
        pull.disabled = b || !getMpKey();
        pull.textContent = b ? '⤓ measuring…' : '⤓ Pull layout';
      }),
    );
  } else {
    pull.style.display = 'none';
  }
  refreshKeyState();
}
