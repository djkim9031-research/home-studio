import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { i2m } from '../constants';

/** Live sun input: real solar altitude/azimuth (model frame) + cloud cover. */
export interface SunInput {
  altitudeDeg: number;
  azimuthModelDeg: number;
  /** 0 = clear, 1 = fully overcast */
  clouds: number;
  /** real moon state for the same instant (drives the night sky) */
  moon?: {
    altitudeDeg: number;
    azimuthModelDeg: number;
    fraction: number;
    brightLimbDeg: number;
  };
}

export interface Lighting {
  invalidateShadows(): void;
  /** Drive the rig from a real sun state; null restores the showcase preset. */
  applySun(input: SunInput | null): void;
  /** Re-center the sky dome + refit the shadow box to the built content. */
  setSunWorld(centerIn: { x: number; z: number }, halfSpanIn: number): void;
}

const DEG = Math.PI / 180;

export function setupLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Lighting {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // on-demand via invalidateShadows()
  renderer.shadowMap.needsUpdate = true;

  const center = new THREE.Vector3(0, 0, 0);
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // horizon: the lawn runs past the fog's far plane, so ground fades into the
  // sky color instead of ending in a visible disc edge
  const fog = new THREE.Fog(0xe8eef2, 70, 260);
  scene.fog = fog;
  const bg = new THREE.Color(0xdfe9f0);
  scene.background = bg;

  // Showcase default: late-afternoon sun from the NW (~24° elevation)
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
  sun.position.set(-18, 14, -26);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(mobile ? 1024 : 4096);
  const cam = sun.shadow.camera;
  cam.left = -24;
  cam.right = 24;
  cam.top = 24;
  cam.bottom = -24;
  cam.near = 5;
  cam.far = 95;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd4ee, 0x8a6b4c, 0.5);
  scene.add(hemi);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const sceneEnv = scene as THREE.Scene & { environmentIntensity?: number };
  if ('environmentIntensity' in scene) sceneEnv.environmentIntensity = 0.35;

  // Sun disc on the sky + incoming-ray arrow over the build
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  disc.visible = false;
  scene.add(disc);
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(),
    6,
    0xb08d57,
    1.4,
    0.7,
  );
  arrow.visible = false;
  scene.add(arrow);

  // Starfield: seeded canvas dome, faded in past nautical twilight
  const starC = document.createElement('canvas');
  starC.width = 2048;
  starC.height = 1024;
  {
    const g = starC.getContext('2d')!;
    let seed = 0x57a5;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    g.clearRect(0, 0, 2048, 1024);
    // suburban sky: dense overhead, thinning toward the light dome at the
    // horizon — but stars reach ALL the way down so low camera angles still
    // read as a starry night
    for (let i = 0; i < 2300; i++) {
      const x = rnd() * 2048;
      const y = rnd() * 950; // hemisphere v: 0 = zenith, ~1024 = horizon rim
      const highSky = 1 - y / 950;
      const mag = rnd();
      if (mag < 0.35 && highSky < 0.3) continue; // only the faintest drown low down
      const r = mag < 0.9 ? 0.7 + rnd() * 0.9 : 1.6 + rnd() * 1.5;
      const tint = rnd();
      g.fillStyle = tint < 0.12 ? '#cfe0ff' : tint < 0.2 ? '#ffe9c9' : '#ffffff';
      g.globalAlpha = (0.3 + mag * 0.7) * (0.5 + 0.5 * highSky);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    const dome = g.createLinearGradient(0, 620, 0, 1024);
    dome.addColorStop(0, 'rgba(70,72,88,0)');
    dome.addColorStop(1, 'rgba(96,92,104,0.35)');
    g.fillStyle = dome;
    g.fillRect(0, 620, 2048, 404);
    g.globalAlpha = 1;
  }
  const starTex = new THREE.CanvasTexture(starC);
  starTex.colorSpace = THREE.SRGBColorSpace;
  const starMat = new THREE.MeshBasicMaterial({
    map: starTex,
    transparent: true,
    opacity: 0,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // upper hemisphere only — no stars can ever show below the horizon
  const stars = new THREE.Mesh(new THREE.SphereGeometry(238, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), starMat);
  stars.renderOrder = -2;
  stars.visible = false;
  scene.add(stars);

  // Moon: phase-correct disc painted per instant (bright limb toward the sun)
  const moonC = document.createElement('canvas');
  moonC.width = 256;
  moonC.height = 256;
  const moonTex = new THREE.CanvasTexture(moonC);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false });
  const moonSprite = new THREE.Sprite(moonMat);
  moonSprite.scale.setScalar(4.6); // ≈0.55° at the dome distance
  moonSprite.renderOrder = -2;
  moonSprite.visible = false;
  scene.add(moonSprite);
  let moonKey = '';
  const drawMoon = (fraction: number, limbDeg: number, darkAlpha: number): void => {
    const key = `${fraction.toFixed(3)}|${limbDeg.toFixed(1)}|${darkAlpha.toFixed(2)}`;
    if (key === moonKey) return;
    moonKey = key;
    const g = moonC.getContext('2d')!;
    const R = 108;
    g.clearRect(0, 0, 256, 256);
    g.save();
    g.translate(128, 128);
    // canonical bright limb at +x, then swing it toward the real sun
    g.rotate((limbDeg - 90) * DEG);
    // the shadowed side: solid at night, transparent by day (a daytime moon
    // shows only its lit portion against the sky)
    if (darkAlpha > 0.02) {
      g.fillStyle = '#232733';
      g.globalAlpha = darkAlpha;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    // lit region: right semicircle closed by the terminator half-ellipse
    const rx = Math.abs(2 * fraction - 1) * R;
    g.fillStyle = '#E9E6DC';
    g.beginPath();
    g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    g.ellipse(0, 0, rx, R, 0, Math.PI / 2, Math.PI * 1.5, fraction < 0.5);
    g.fill();
    // mare blotches, clipped to the disc
    g.save();
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.clip();
    let seed = 0x300d;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    g.fillStyle = '#b9b5a8';
    for (let i = 0; i < 9; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.2;
      g.beginPath();
      g.ellipse((rnd() - 0.5) * 150, (rnd() - 0.5) * 150, 14 + rnd() * 26, 10 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.restore();
    moonTex.needsUpdate = true;
  };

  // Sunset glow: a soft orange arc hugging the horizon around the sun azimuth
  const glowC = document.createElement('canvas');
  glowC.width = 256;
  glowC.height = 256;
  {
    const g = glowC.getContext('2d')!;
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      const vy = 1 - y / 255;
      const vert = Math.max(0, 1 - vy * 1.45);
      for (let x = 0; x < 256; x++) {
        const hx = 1 - Math.abs(x - 127.5) / 127.5;
        const a = Math.pow(vert, 1.6) * Math.pow(hx, 1.5);
        const o = (y * 256 + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  }
  const glowTex = new THREE.CanvasTexture(glowC);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color: 0xff9a3c,
    transparent: true,
    opacity: 0,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(230, 230, 120, 48, 1, true, -0.95, 1.9), glowMat);
  glow.position.set(0, 34, 0);
  glow.renderOrder = -2;
  glow.visible = false;
  scene.add(glow);

  const setNightSky = (input: SunInput | null, nightF: number): void => {
    const c = input ? THREE.MathUtils.clamp(input.clouds, 0, 1) : 0;
    starMat.opacity = nightF * (1 - 0.97 * c); // overcast blots the stars out
    stars.visible = starMat.opacity > 0.02;
    const m = input?.moon;
    if (m && m.altitudeDeg > 0) {
      drawMoon(m.fraction, m.brightLimbDeg, 0.95 * nightF);
      const ma = m.azimuthModelDeg * DEG;
      const mh = m.altitudeDeg * DEG;
      moonSprite.position
        .set(Math.sin(ma) * Math.cos(mh), Math.sin(mh), -Math.cos(ma) * Math.cos(mh))
        .multiplyScalar(232)
        .add(new THREE.Vector3(center.x, 0, center.z));
      moonMat.opacity = (0.6 + 0.4 * nightF) * (1 - 0.94 * c); // clouds hide the moon
      moonSprite.visible = moonMat.opacity > 0.04;
    } else {
      moonSprite.visible = false;
    }
  };

  const setGlow = (altDeg: number, azModelDeg: number, clouds: number): void => {
    // peaks as the sun touches the horizon, gone by −9° and by +14°
    const up = THREE.MathUtils.clamp(1 - Math.abs(altDeg - 1.5) / (altDeg > 1.5 ? 12 : 10), 0, 1);
    const op = Math.pow(up, 1.35) * (1 - 0.9 * clouds);
    glowMat.opacity = op * 0.85;
    glow.visible = op > 0.02;
    if (!glow.visible) return;
    glow.rotation.y = Math.PI - azModelDeg * DEG;
    glowMat.color.copy(
      altDeg >= 0
        ? colA.setHex(0xff9a3c).lerp(colB.setHex(0xffc37a), THREE.MathUtils.clamp(altDeg / 12, 0, 1))
        : colA.setHex(0xff8a48).lerp(colB.setHex(0xc2547e), THREE.MathUtils.clamp(-altDeg / 9, 0, 1)),
    );
  };

  const invalidateShadows = () => {
    renderer.shadowMap.needsUpdate = true;
  };

  const colA = new THREE.Color();
  const colB = new THREE.Color();
  const lerpHex = (a: number, b: number, t: number): THREE.Color =>
    colA.setHex(a).lerp(colB.setHex(b), THREE.MathUtils.clamp(t, 0, 1));

  const setSky = (sky: THREE.Color, fogHex: number): void => {
    bg.copy(sky);
    fog.color.setHex(fogHex);
  };

  let lastInput: SunInput | null | undefined;
  const applySun = (input: SunInput | null): void => {
    lastInput = input;
    if (!input) {
      sun.visible = true;
      sun.color.setHex(0xffd9a8);
      sun.intensity = 2.4;
      sun.position.set(center.x - 18, 14, center.z - 26);
      hemi.color.setHex(0xbfd4ee);
      hemi.groundColor.setHex(0x8a6b4c);
      hemi.intensity = 0.5;
      sceneEnv.environmentIntensity = 0.35;
      setSky(colA.setHex(0xdfe9f0), 0xe8eef2);
      disc.visible = false;
      arrow.visible = false;
      stars.visible = false;
      moonSprite.visible = false;
      glow.visible = false;
      invalidateShadows();
      return;
    }

    const { altitudeDeg: alt, azimuthModelDeg: azm } = input;
    const c = THREE.MathUtils.clamp(input.clouds, 0, 1);
    const a = azm * DEG;
    const h = Math.max(alt, 1) * DEG; // keep the light above the horizon plane
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h));

    if (alt < 0) {
      // smooth twilight ladder: sunset → civil (−6°) → nautical (−12°) →
      // astronomical (−18°) → night
      const KEYS = [
        { a: 0, hemi: 0xf0a45c, hemiI: 0.42, sky: 0xa06a44, fog: 0xd8bfa5, env: 0.22 },
        { a: -6, hemi: 0x4a5a86, hemiI: 0.34, sky: 0x4a5064, fog: 0x2a3145, env: 0.15 },
        { a: -12, hemi: 0x2a3658, hemiI: 0.26, sky: 0x232c47, fog: 0x17203a, env: 0.12 },
        { a: -18, hemi: 0x1b2440, hemiI: 0.22, sky: 0x141d33, fog: 0x0e1626, env: 0.12 },
      ];
      const aa = Math.max(alt, -18);
      let k = 0;
      while (k < KEYS.length - 2 && aa < KEYS[k + 1].a) k++;
      const k0 = KEYS[k];
      const k1 = KEYS[k + 1];
      const t = THREE.MathUtils.clamp((k0.a - aa) / (k0.a - k1.a), 0, 1);
      sun.visible = false;
      hemi.color.copy(lerpHex(k0.hemi, k1.hemi, t).clone());
      hemi.groundColor.setHex(0x14100c);
      hemi.intensity = THREE.MathUtils.lerp(k0.hemiI, k1.hemiI, t);
      sceneEnv.environmentIntensity = THREE.MathUtils.lerp(k0.env, k1.env, t);
      const sky = lerpHex(k0.sky, k1.sky, t).clone();
      setSky(sky, lerpHex(k0.fog, k1.fog, t).getHex());
      disc.visible = false;
      arrow.visible = false;
      setGlow(alt, azm, c);
      setNightSky(input, THREE.MathUtils.clamp((-alt - 6) / 8, 0, 1));
      invalidateShadows();
      return;
    }

    // Daytime: color/intensity ramp by altitude, damped by cloud cover
    sun.visible = true;
    const warm =
      alt < 8
        ? lerpHex(0xff8c4a, 0xffb877, alt / 8)
        : alt < 25
          ? lerpHex(0xffb877, 0xffd9a8, (alt - 8) / 17)
          : lerpHex(0xffd9a8, 0xfff2dc, (alt - 25) / 40);
    sun.color.copy(warm).lerp(colB.setHex(0xe6e6e6), c * 0.7);
    const altBoost = THREE.MathUtils.clamp(alt / 30, 0.6, 1.15);
    // dramatic reading: hot direct beam over a subdued ambient, so the sun's
    // pools and window patterns clearly dominate the build
    sun.intensity = 4.3 * altBoost * (1 - 0.88 * c);
    sun.position.copy(center).addScaledVector(dir, 40);

    const golden = THREE.MathUtils.clamp(1 - alt / 25, 0, 1);
    hemi.color.copy(lerpHex(0xbfd9f5, 0xf0a45c, golden).clone().lerp(colB.setHex(0xaab2bc), c * 0.7));
    hemi.groundColor.setHex(0x8a6b4c);
    hemi.intensity = 0.5 + 0.12 * (1 - golden) + 0.4 * c;
    const duskFade = THREE.MathUtils.clamp(1 - alt / 6, 0, 1);
    sceneEnv.environmentIntensity = 0.3 - 0.08 * c - 0.08 * duskFade;

    const skyTint = lerpHex(0x9ec7ec, 0xffb066, golden)
      .clone()
      .multiplyScalar(1.1 - 0.3 * golden)
      .lerp(colB.setHex(0x6f767e), c * 0.75);
    setSky(skyTint, c > 0.5 ? 0x9b9ea3 : golden > 0.5 ? 0xd8bfa5 : 0xc9d2dc);

    disc.visible = true;
    disc.material.opacity = 0.95 - 0.75 * c;
    disc.position.copy(center).addScaledVector(dir, 230);
    disc.lookAt(center);

    arrow.visible = true;
    const origin = center.clone().addScaledVector(dir, 14);
    arrow.position.copy(origin);
    arrow.setDirection(dir.clone().negate());
    setGlow(alt, azm, c);
    setNightSky(input, 0); // daytime: stars off; a risen moon shows faintly
    invalidateShadows();
  };

  const setSunWorld = (centerIn: { x: number; z: number }, halfSpanIn: number): void => {
    center.set(i2m(centerIn.x), 0, i2m(centerIn.z));
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    const half = Math.max(14, i2m(halfSpanIn + 140));
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.far = Math.max(95, half * 2 + 45);
    cam.updateProjectionMatrix();
    stars.position.set(center.x, 0, center.z);
    glow.position.set(center.x, 34, center.z);
    applySun(lastInput ?? null);
  };

  // QA probe hook (harmless in production; used by #probe=sky)
  (window as unknown as { __sky?: unknown }).__sky = { stars, starMat, moonSprite, moonMat, glow };

  return { invalidateShadows, applySun, setSunWorld };
}
