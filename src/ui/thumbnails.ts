/** 48×48 SVG card icons. */
const S = (body: string): string =>
  `<svg viewBox="0 0 48 48" width="44" height="44" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const THUMBS = {
  wall: S(
    `<rect x="6" y="14" width="36" height="22" rx="1.5" fill="#efe9dd" stroke="#8a7a64" stroke-width="2"/>
     <line x1="6" y1="25" x2="42" y2="25" stroke="#c9bda9" stroke-width="1.4"/>
     <line x1="16" y1="14" x2="16" y2="25" stroke="#c9bda9" stroke-width="1.4"/>
     <line x1="30" y1="25" x2="30" y2="36" stroke="#c9bda9" stroke-width="1.4"/>`,
  ),
  door: S(
    `<rect x="14" y="8" width="20" height="34" rx="1.5" fill="#e8ddc8" stroke="#8a7a64" stroke-width="2"/>
     <rect x="18" y="13" width="12" height="10" fill="none" stroke="#a8977c" stroke-width="1.6"/>
     <rect x="18" y="27" width="12" height="10" fill="none" stroke="#a8977c" stroke-width="1.6"/>
     <circle cx="31" cy="26" r="1.6" fill="#8a7a64"/>`,
  ),
  window: S(
    `<rect x="9" y="11" width="30" height="26" rx="1.5" fill="#dceaf2" stroke="#8a7a64" stroke-width="2"/>
     <line x1="24" y1="11" x2="24" y2="37" stroke="#8a7a64" stroke-width="1.8"/>
     <line x1="9" y1="24" x2="39" y2="24" stroke="#8a7a64" stroke-width="1.8"/>`,
  ),
  stair: S(
    `<path d="M8 40 h8 v-8 h8 v-8 h8 v-8 h8 v-4 h-2 v2 h-8 v8 h-8 v8 h-8 v8 h-6 z" fill="#d9c9a8" stroke="#8a7a64" stroke-width="2" stroke-linejoin="round"/>`,
  ),
  floor: S(
    `<rect x="7" y="15" width="34" height="20" rx="1.5" fill="#d9c9a8" stroke="#8a7a64" stroke-width="2" transform="skewX(-12)" transform-origin="24 25"/>
     <line x1="12" y1="25" x2="40" y2="25" stroke="#a8977c" stroke-width="1.4" transform="skewX(-12)" transform-origin="24 25"/>
     <line x1="20" y1="15" x2="20" y2="35" stroke="#a8977c" stroke-width="1.4" transform="skewX(-12)" transform-origin="24 25"/>
     <line x1="30" y1="15" x2="30" y2="35" stroke="#a8977c" stroke-width="1.4" transform="skewX(-12)" transform-origin="24 25"/>`,
  ),
};
