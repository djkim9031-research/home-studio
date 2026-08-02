/** 31.5 -> "31½", 8.25 -> "8¼" (nearest ¼"). */
export function fmtInches(n: number): string {
  const q = Math.round(n * 4) / 4;
  const whole = Math.trunc(q);
  const frac = Math.abs(q - whole);
  const glyph = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  if (glyph && whole === 0) return `${q < 0 ? '-' : ''}${glyph}`;
  return `${whole}${glyph}`;
}

/** Architectural feet-inches: 114 -> 9' 6", 20.5 -> 20½". */
export function formatFeetInches(inches: number): string {
  const half = Math.round(inches * 2) / 2;
  const abs = Math.abs(half);
  if (abs < 24) return `${fmtInches(half)}"`;
  const sign = half < 0 ? '-' : '';
  const ft = Math.floor(abs / 12);
  const rem = abs - ft * 12;
  return rem === 0 ? `${sign}${ft}'` : `${sign}${ft}' ${fmtInches(rem)}"`;
}

/** Feet-inches with the plain inch total alongside: 114 -> 9' 6" (114"). */
export function formatFeetInchesFull(inches: number): string {
  const half = Math.round(inches * 2) / 2;
  if (Math.abs(half) < 24) return `${fmtInches(half)}"`;
  return `${formatFeetInches(inches)} (${fmtInches(half)}")`;
}
