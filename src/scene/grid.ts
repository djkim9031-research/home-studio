import * as THREE from 'three';
import { i2m } from '../constants';

const SPAN_FT = 400; // grid extent, feet

/** Build-mode reference grid: 1 ft × 1 ft cells riding the active floor. */
export class BuildGrid {
  private grid: THREE.GridHelper;

  constructor(scene: THREE.Scene) {
    this.grid = new THREE.GridHelper(i2m(SPAN_FT * 12), SPAN_FT, 0x46523a, 0x46523a);
    const mat = this.grid.material as THREE.LineBasicMaterial;
    mat.transparent = true;
    mat.opacity = 0.2;
    mat.depthWrite = false;
    this.grid.renderOrder = 1;
    scene.add(this.grid);
  }

  /** Center on the build (inches) and sit just above the active floor. */
  place(centerXIn: number, centerZIn: number, floorBase: number): void {
    // snap the grid's own lines to whole feet so cells line up with the ruler
    const snap = (v: number): number => Math.round(v / 12) * 12;
    this.grid.position.set(i2m(snap(centerXIn)), i2m(floorBase) + 0.006, i2m(snap(centerZIn)));
  }

  setVisible(v: boolean): void {
    this.grid.visible = v;
  }

  visible(): boolean {
    return this.grid.visible;
  }
}
