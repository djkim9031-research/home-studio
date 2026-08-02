import * as THREE from 'three';
import { i2m } from '../constants';
import * as store from '../state/store';
import { floorBaseIn, type Vec2, type Wall } from '../types';
import type { CameraRig } from '../scene/camera';
import type { ElementMeshes } from '../scene/elementMeshes';
import type { Tool } from './buildTools';

/** Capture-phase gesture router: exactly one active tool at a time; presses
 * the tool doesn't claim fall through to OrbitControls. */
export class PointerController {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private rig: CameraRig;
  private meshes: ElementMeshes;
  private ray = new THREE.Raycaster();
  private tool: Tool | null = null;
  private fallback: Tool | null = null;
  private activePointer: number | null = null;
  private claimed = false;
  onToolDone: (() => void) | null = null;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, rig: CameraRig, meshes: ElementMeshes) {
    this.container = container;
    this.canvas = canvas;
    this.rig = rig;
    this.meshes = meshes;

    container.addEventListener('pointerdown', this.onDown, true);
    container.addEventListener('pointermove', this.onMove, true);
    container.addEventListener('pointerup', this.onUp, true);
    container.addEventListener('pointercancel', this.onCancel, true);
    container.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    container.addEventListener('contextmenu', (e) => {
      if (this.tool) e.preventDefault();
    });
  }

  /** Arm a build tool (or null to fall back to selection). */
  setTool(tool: Tool | null): void {
    this.tool?.cancel();
    this.tool = tool;
    store.setGhost(null);
  }

  setFallback(tool: Tool): void {
    this.fallback = tool;
  }

  activeTool(): Tool | null {
    return this.tool;
  }

  private current(): Tool | null {
    return this.tool ?? this.fallback;
  }

  /** Plan-space (inches) hit on the ACTIVE floor's build plane. */
  clientToFloor(cx: number, cy: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.rig.camera);
    const s = store.getState();
    const y = i2m(floorBaseIn(s.elements, s.activeFloor));
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) return null;
    return { x: hit.x / i2m(1), z: hit.z / i2m(1) };
  }

  /** Raycasters ignore clipping planes — drop hits on the clipped-away part
   * of a cutaway-lowered wall so picks match what's on screen. */
  private hitClipped(h: THREE.Intersection): boolean {
    const mesh = h.object as THREE.Mesh;
    if (!mesh.isMesh) return false;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const planes = mat?.clippingPlanes as THREE.Plane[] | null;
    if (!planes || !planes.length) return false;
    return planes.some((p) => p.distanceToPoint(h.point) < 0);
  }

  /** Raycast placed-element meshes; nearest element id. */
  pickElement(ev: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.rig.camera);
    const groups = [...this.meshes.allEntries().values()].map((e) => e.group);
    const hits = this.ray.intersectObjects(groups, true);
    for (const h of hits) {
      if (this.hitClipped(h)) continue;
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.itemId) return o.userData.itemId as string;
        o = o.parent;
      }
    }
    return null;
  }

  /** Camera distance to the active floor's build plane under the cursor. */
  floorHitDistance(ev: PointerEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.rig.camera);
    const s = store.getState();
    const y = i2m(floorBaseIn(s.elements, s.activeFloor));
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) return null;
    return hit.distanceTo(this.rig.camera.position);
  }

  /** Raycast only the ACTIVE floor's wall meshes. */
  pickWall(ev: PointerEvent): { wallId: string; point: Vec2; distance: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.rig.camera);
    const s = store.getState();
    const wallGroups: THREE.Group[] = [];
    for (const e of s.elements) {
      if (e.kind !== 'wall' || e.floor !== s.activeFloor) continue;
      const g = this.meshes.getGroup(e.id);
      if (g) wallGroups.push(g);
    }
    const hits = this.ray.intersectObjects(wallGroups, true);
    for (const h of hits) {
      if (this.hitClipped(h)) continue;
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.itemId) {
          const el = s.elements.find((x) => x.id === o!.userData.itemId);
          if (el?.kind === 'wall') {
            return { wallId: el.id, point: { x: h.point.x / i2m(1), z: h.point.z / i2m(1) }, distance: h.distance };
          }
          // fall through openings back to their wall
          if (el && (el.kind === 'door' || el.kind === 'window')) {
            const wall = s.elements.find((x): x is Wall => x.kind === 'wall' && x.id === el.wallId);
            if (wall && wall.floor === s.activeFloor) {
              return { wallId: wall.id, point: { x: h.point.x / i2m(1), z: h.point.z / i2m(1) }, distance: h.distance };
            }
          }
        }
        o = o.parent;
      }
    }
    return null;
  }

  private onDown = (ev: PointerEvent): void => {
    if (ev.button !== 0) {
      if (ev.button === 2 && this.tool) {
        // right-click cancels the armed tool
        this.setTool(null);
        this.onToolDone?.();
      }
      return;
    }
    if ((ev.target as HTMLElement).closest('.hs-panel, .topbar, .sun-panel, .palette, .items-panel, .hs-modal-overlay')) return;
    const tool = this.current();
    if (!tool) return;
    this.activePointer = ev.pointerId;
    const claimed = tool.onDown(this.clientToFloor(ev.clientX, ev.clientY), ev);
    this.claimed = claimed;
    if (claimed) {
      this.rig.setGestureLock(true);
      ev.stopPropagation();
      ev.preventDefault();
    }
  };

  private onMove = (ev: PointerEvent): void => {
    const tool = this.current();
    if (!tool) return;
    if (this.activePointer === ev.pointerId && this.claimed) {
      tool.onMove(this.clientToFloor(ev.clientX, ev.clientY), ev);
      ev.stopPropagation();
    } else if (this.activePointer === null) {
      tool.onHover(this.clientToFloor(ev.clientX, ev.clientY), ev);
    }
  };

  private onUp = (ev: PointerEvent): void => {
    if (this.activePointer !== ev.pointerId) return;
    const tool = this.current();
    this.activePointer = null;
    if (tool && this.claimed) {
      tool.onUp(this.clientToFloor(ev.clientX, ev.clientY), ev);
      this.rig.setGestureLock(false);
      ev.stopPropagation();
    }
    this.claimed = false;
  };

  private onCancel = (ev: PointerEvent): void => {
    if (this.activePointer !== ev.pointerId) return;
    this.activePointer = null;
    this.claimed = false;
    this.current()?.cancel();
    this.rig.setGestureLock(false);
  };

  private onWheel = (ev: WheelEvent): void => {
    const tool = this.current();
    if (tool?.onWheel?.(ev.deltaY)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };
}
