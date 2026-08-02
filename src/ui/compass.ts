import { getSite } from '../scene/sun';

export interface Compass {
  /** point the dial for a camera looking from `pos` toward `target` (world). */
  update(pos: { x: number; z: number }, target: { x: number; z: number }): void;
}

/** A little N/E/S/W dial, fixed bottom-right, that spins so N always points at
 * true north as the camera orbits. Model −z faces the site's true north. */
export function buildCompass(root: HTMLElement): Compass {
  const el = document.createElement('div');
  el.className = 'hs-compass';
  el.innerHTML = `
    <div class="hs-compass-dial" data-k="dial">
      <span class="hs-compass-n">N</span>
      <span class="hs-compass-e">E</span>
      <span class="hs-compass-s">S</span>
      <span class="hs-compass-w">W</span>
      <span class="hs-compass-needle"></span>
    </div>`;
  root.appendChild(el);
  const dial = el.querySelector('[data-k="dial"]') as HTMLElement;

  let last = 999;
  return {
    update(pos, target) {
      const fx = target.x - pos.x;
      const fz = target.z - pos.z;
      if (fx === 0 && fz === 0) return;
      // bearing the camera faces: 0 = looking north (−z), 90 = east (+x)
      const heading = Math.atan2(fx, -fz) * (180 / Math.PI);
      // spin the dial opposite the heading so N stays put; offset for site north
      const rot = getSite().northOffsetDeg - heading;
      if (Math.abs(rot - last) < 0.3) return;
      last = rot;
      dial.style.transform = `rotate(${rot}deg)`;
    },
  };
}
