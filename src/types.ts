export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose extends Vec2 {
  yawDeg: number;
}

export type DwellingType = 'house' | 'apartment' | 'townhouse' | 'duplex' | 'condo';
export type GarageType = 'none' | '1-car' | '2-car';

/** One story's floor plan: the raw image + calibration + traced geometry. */
export interface StoryPlan {
  /** plan raster as a dataURL (image upload or rendered PDF page) */
  imageData: string | null;
  /** image pixel size (for aspect + tracing space) */
  imageW: number;
  imageH: number;
  /** inches per image pixel (set by calibration; 0 = uncalibrated) */
  inPerPx: number;
  /** exterior boundary, traced in IMAGE PIXELS (converted via inPerPx) */
  boundaryPx: Vec2[];
  /** interior wall polylines, image pixels */
  wallsPx: Vec2[][];
  /** door/window openings: segment midpoints on walls (image px) + width in */
  openingsPx: { x: number; z: number; widthIn: number; door: boolean }[];
  /** wall height for this story, inches */
  wallHeightIn: number;
}

export interface House {
  id: string;
  name: string;
  adults: number;
  kids: number;
  pets: string; // free text, e.g. "1 dog (corgi), 2 cats"
  sqft: number;
  stories: 1 | 2 | 3;
  basement: boolean;
  garage: GarageType;
  dwelling: DwellingType;
  matterportId: string | null;
  /** index 0 = story 1, 1 = story 2, …; basement stored separately */
  plans: StoryPlan[];
  basementPlan: StoryPlan | null;
  createdAt: string;
}

export interface HouseFile {
  version: 1;
  kind: 'home-studio-house';
  house: House;
}

export function emptyStoryPlan(wallHeightIn = 108): StoryPlan {
  return {
    imageData: null,
    imageW: 0,
    imageH: 0,
    inPerPx: 0,
    boundaryPx: [],
    wallsPx: [],
    openingsPx: [],
    wallHeightIn,
  };
}
