// Units: the three.js scene is in METERS; every layout/build measurement in
// the app is in INCHES. Convert only at the scene boundary.
export const IN = 0.0254;
export const i2m = (n: number): number => n * IN;

/** structural gap between a story's wall top and the next story's floor */
export const JOIST_T = 14;

export const DEFAULT_WALL_H = 96;
export const DEFAULT_WALL_T = 5;
export const DEFAULT_DOOR = { w: 36, h: 82 };
export const DEFAULT_WINDOW = { w: 36, h: 48, sill: 36 };
export const DEFAULT_STAIR = { w: 36, run: 132 };
/** Sims-style cutaway: lowered walls clip at this height above their floor */
export const CUTAWAY_H = 36;

export const SNAP = {
  grid: 1, // inches
  angleDeg: 15, // wall bearing snap step
  rightAngleWinDeg: 3, // 0/45/90 win within this margin
  weld: 6, // endpoint magnet radius, inches
};

export const COLORS = {
  brass: 0xb08d57,
  hover: 0x8a9a7b,
  valid: 0x8a9a7b,
  invalid: 0xb4655a,
};
