/** World scale: the 3D scene is in meters, all layout math is in inches. */
export const IN = 0.0254;
export const i2m = (n: number) => n * IN;

/** Default wall/story heights (inches). */
export const WALL_H_MAIN = 108; // 9'
export const WALL_H_BASEMENT = 96; // 8'
export const JOIST_T = 14; // structure between stories
export const WALL_T = 5; // rendered wall thickness
