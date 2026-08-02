/** Collapsible reference panel embedding the house's Matterport walkthrough.
 * The tour is the measuring reference while tracing (its measure mode gives
 * the dimensions you calibrate against). */
export function buildMatterportPanel(root: HTMLElement, modelId: string | null): void {
  if (!modelId) return;
  const panel = document.createElement('div');
  panel.className = 'hs-mp-panel';
  panel.innerHTML = `
    <div class="head">
      <span>Matterport tour</span>
      <button class="ui-btn" data-k="toggle">—</button>
    </div>
    <iframe
      src="https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&brand=0&play=0"
      allow="fullscreen; vr"
      title="Matterport walkthrough"></iframe>`;
  root.appendChild(panel);
  const iframe = panel.querySelector('iframe')!;
  const btn = panel.querySelector('[data-k="toggle"]') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const hidden = iframe.style.display === 'none';
    iframe.style.display = hidden ? 'block' : 'none';
    btn.textContent = hidden ? '—' : '▢';
  });
}
