import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { i2m } from '../constants';
import { pointInPolygon } from '../core/geometry';
import type { Vec2 } from '../types';

const EYE_HEIGHT = 63; // standing eye height, inches
// generous default bounds; setCameraWorld() fits them to the built home
let ROOM_CENTER = new THREE.Vector3(0, 0, 0);
let DEFAULT_DIST = 11;
let TX0 = i2m(-1200);
let TX1 = i2m(1200);
let TZ0 = i2m(-1200);
let TZ1 = i2m(1200);
let TARGET_Y = 0;
let WALK_AREAS: Vec2[][] = [];

/** Fit orbit bounds + stand-mode walk areas to the built home. */
export function setCameraWorld(center: Vec2, halfSpanIn: number, walkAreas: Vec2[][]): void {
  ROOM_CENTER = new THREE.Vector3(i2m(center.x), TARGET_Y, i2m(center.z));
  const m = i2m(halfSpanIn + 120);
  DEFAULT_DIST = Math.max(8, i2m(halfSpanIn) * 2.2);
  TX0 = i2m(center.x) - m;
  TX1 = i2m(center.x) + m;
  TZ0 = i2m(center.z) - m;
  TZ1 = i2m(center.z) + m;
  WALK_AREAS = walkAreas;
}

/** Keep the orbit target at a floor's elevation (meters). */
export function setTargetElevation(yM: number): void {
  TARGET_Y = yM;
  ROOM_CENTER.y = yM;
}

export type RigMode = 'orbit' | 'stand';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mode: RigMode = 'orbit';
  onModeChange: ((mode: RigMode) => void) | null = null;

  private canvas: HTMLCanvasElement;
  private tween: {
    t: number;
    dur: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;

  // stand mode
  private standYaw = 0;
  private standPitch = 0;
  private standPos = new THREE.Vector3();
  private keys = new Set<string>();
  private lookActive = false;
  private lookLast = { x: 0, y: 0 };
  private lookMoved = 0;
  private savedOrbit: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private standDirty = false;
  /** set while a build gesture owns the pointer */
  private gestureLock = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // tight near/far: low-precision depth buffers (Firefox on Tegra gets one)
    // z-fight badly with a sloppy range
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.35, 340);
    this.camera.position.set(ROOM_CENTER.x + DEFAULT_DIST * 0.18, DEFAULT_DIST * 0.6, ROOM_CENTER.z + DEFAULT_DIST * 1.02);

    this.controls = new OrbitControls(this.camera, canvas);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minPolarAngle = 0.05;
    c.maxPolarAngle = 1.45;
    c.minDistance = 1.2;
    c.maxDistance = 60;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.target.copy(ROOM_CENTER);
    this.camera.lookAt(c.target);

    canvas.addEventListener('pointerdown', this.standPointerDown);
    window.addEventListener('pointermove', this.standPointerMove);
    window.addEventListener('pointerup', this.standPointerUp);
    window.addEventListener('keydown', this.standKey);
    window.addEventListener('keyup', this.standKeyUp);
    // stuck-key guard: keyup never arrives once the window loses focus
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys.clear();
    });
  }

  /** Frame the camera on freshly loaded content (meters) — the same low 3/4
   * vantage the wedding planner opens with. */
  frameContent(center: { x: number; y: number; z: number }, halfSpanM: number): void {
    if (this.mode === 'stand') this.exitStand();
    const d = Math.max(7, halfSpanM * 1.9);
    this.camera.position.set(center.x + d * 0.18, TARGET_Y + d * 0.6, center.z + d * 1.02);
    this.controls.target.set(center.x, TARGET_Y, center.z);
    this.controls.update();
  }

  /** Tween to the bird's-eye angle centred on a point, at the regular span —
   * used to re-frame on a clicked wall corner before drawing from it. */
  flyTo(center: { x: number; z: number }, halfSpanM: number): void {
    if (this.mode === 'stand') this.exitStand();
    const d = Math.max(9, halfSpanM * 1.9);
    const target = new THREE.Vector3(center.x, TARGET_Y, center.z);
    const pos = new THREE.Vector3(center.x + d * 0.18, TARGET_Y + d * 0.6, center.z + d * 1.02);
    this.startTween(pos, target, 320);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Build gestures call this to keep OrbitControls out of the way. */
  setGestureLock(locked: boolean): void {
    this.gestureLock = locked;
    this.controls.enabled = !locked && this.mode === 'orbit' && !this.tween;
  }

  toTopView(): void {
    if (this.mode === 'stand') this.exitStand();
    const target = ROOM_CENTER.clone();
    const h = Math.max(14, DEFAULT_DIST * 1.6);
    // land just inside minPolarAngle so controls don't kick after the tween
    const pos = target.clone().add(new THREE.Vector3(0, h, h * Math.tan(0.06)));
    this.startTween(pos, target, 350);
  }

  toDefaultView(): void {
    if (this.mode === 'stand') this.exitStand();
    this.startTween(
      new THREE.Vector3(
        ROOM_CENTER.x + DEFAULT_DIST * 0.18,
        TARGET_Y + DEFAULT_DIST * 0.6,
        ROOM_CENTER.z + DEFAULT_DIST * 1.02,
      ),
      ROOM_CENTER.clone(),
      350,
    );
  }

  enterStand(at?: Vec2): void {
    if (this.mode === 'stand') return;
    this.tween = null; // a running view tween must not hijack the stand camera
    this.keys.clear();
    this.savedOrbit = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
    const p = at ?? { x: ROOM_CENTER.x / i2m(1), z: ROOM_CENTER.z / i2m(1) + 120 };
    this.standPos.set(i2m(p.x), TARGET_Y + i2m(EYE_HEIGHT), i2m(p.z));
    const look = ROOM_CENTER.clone().sub(this.standPos);
    this.standYaw = Math.atan2(-look.x, -look.z);
    this.standPitch = 0;
    this.mode = 'stand';
    this.controls.enabled = false;
    this.applyStand();
    this.onModeChange?.('stand');
  }

  exitStand(): void {
    if (this.mode !== 'stand') return;
    this.mode = 'orbit';
    if (this.savedOrbit) {
      this.camera.position.copy(this.savedOrbit.pos);
      this.controls.target.copy(this.savedOrbit.target);
    }
    this.controls.enabled = !this.gestureLock;
    this.standDirty = true;
    this.onModeChange?.('orbit');
  }

  /** Teleport (stand mode) to a floor point given in inches. */
  teleport(p: Vec2): void {
    if (WALK_AREAS.length && !WALK_AREAS.some((poly) => pointInPolygon(p, poly))) return;
    this.standPos.set(i2m(p.x), TARGET_Y + i2m(EYE_HEIGHT), i2m(p.z));
    this.standDirty = true;
  }

  private startTween(pos: THREE.Vector3, target: THREE.Vector3, dur: number): void {
    this.tween = {
      t: 0,
      dur,
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
    this.controls.enabled = false;
  }

  private applyStand(): void {
    this.camera.position.copy(this.standPos);
    const e = new THREE.Euler(this.standPitch, this.standYaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
    this.standDirty = true;
  }

  // --- stand-mode pointer/key handlers (no PointerLock: touch friendly) ----

  private standPointerDown = (e: PointerEvent) => {
    if (this.mode !== 'stand') return;
    this.lookActive = true;
    this.lookMoved = 0;
    this.lookLast = { x: e.clientX, y: e.clientY };
  };

  private standPointerMove = (e: PointerEvent) => {
    if (this.mode !== 'stand' || !this.lookActive) return;
    const dx = e.clientX - this.lookLast.x;
    const dy = e.clientY - this.lookLast.y;
    this.lookLast = { x: e.clientX, y: e.clientY };
    this.lookMoved += Math.abs(dx) + Math.abs(dy);
    this.standYaw -= dx * 0.005;
    this.standPitch = THREE.MathUtils.clamp(this.standPitch - dy * 0.005, -1.05, 1.05);
    this.applyStand();
  };

  private standPointerUp = (e: PointerEvent) => {
    if (this.mode !== 'stand' || !this.lookActive) return;
    this.lookActive = false;
    if (this.lookMoved < 6 && e.target === this.canvas) {
      // tap = teleport to the tapped floor point
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TARGET_Y), hit)) {
        this.teleport({ x: hit.x / i2m(1), z: hit.z / i2m(1) });
      }
    }
  };

  private standKey = (e: KeyboardEvent) => {
    if (this.mode !== 'stand') return;
    this.keys.add(e.code);
  };

  private standKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** Per-frame tick; returns true when the camera moved (needs render). */
  update(dt: number): boolean {
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt * 1000;
      const k = Math.min(tw.t / tw.dur, 1);
      const ease = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, ease);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, ease);
      this.camera.lookAt(this.controls.target);
      if (k >= 1) {
        this.tween = null;
        this.controls.enabled = this.mode === 'orbit' && !this.gestureLock;
      }
      return true;
    }

    if (this.mode === 'stand') {
      let moved = this.standDirty;
      this.standDirty = false;
      const speed = 1.6; // m/s — walking pace
      const fwd = new THREE.Vector3(-Math.sin(this.standYaw), 0, -Math.cos(this.standYaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const v = new THREE.Vector3();
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v.add(fwd);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v.sub(fwd);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v.sub(right);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v.add(right);
      if (v.lengthSq() > 0) {
        v.normalize().multiplyScalar(speed * dt);
        const next = this.standPos.clone().add(v);
        const p = { x: next.x / i2m(1), z: next.z / i2m(1) };
        if (!WALK_AREAS.length || WALK_AREAS.some((poly) => pointInPolygon(p, poly))) {
          this.standPos.copy(next);
        }
        moved = true;
      }
      if (moved) this.applyStand();
      return moved;
    }

    const changed = this.controls.update();
    const t = this.controls.target;
    t.x = THREE.MathUtils.clamp(t.x, TX0, TX1);
    t.z = THREE.MathUtils.clamp(t.z, TZ0, TZ1);
    t.y = TARGET_Y;
    return changed;
  }
}
