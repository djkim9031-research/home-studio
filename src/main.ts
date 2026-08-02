import './ui/style.css';
import { CameraRig, setCameraWorld, setTargetElevation } from './scene/camera';
import { createSceneHost } from './scene/host';
import { buildGround } from './scene/ground';
import { moonState, sunPosition } from './scene/sun';
import { buildSunPanel, type SunPanelState } from './ui/sunPanel';

const app = document.getElementById('app')!;
app.innerHTML = `<div class="viewport" data-k="viewport"></div>`;
const viewport = app.querySelector('[data-k="viewport"]') as HTMLElement;

const host = createSceneHost(viewport);
buildGround(host.scene);
setCameraWorld({ x: 0, z: 0 }, 300, []);
const rig = new CameraRig(host.canvas);

// ---- sun -------------------------------------------------------------------

const sunToInput = (s: SunPanelState) => {
  if (!s.enabled) return null;
  const pos = sunPosition(s.date, s.minutes);
  const moon = moonState(s.date, s.minutes);
  return {
    altitudeDeg: pos.altitudeDeg,
    azimuthModelDeg: pos.azimuthModelDeg,
    clouds: s.clouds ? s.cloudPct / 100 : 0,
    moon: {
      altitudeDeg: moon.altitudeDeg,
      azimuthModelDeg: moon.azimuthModelDeg,
      fraction: moon.fraction,
      brightLimbDeg: moon.brightLimbDeg,
    },
  };
};

const sunPanel = buildSunPanel(app, (s) => host.applySun(sunToInput(s)));

// ---- boot / QA -------------------------------------------------------------

host.start(rig.camera, (dt) => rig.update(dt));

const params = new URLSearchParams(location.hash.replace(/^#/, ''));
if (params.get('burn') === '1') host.onFrame(() => true);
if (params.get('cam') === 'low') {
  // near-ground view toward the SOUTHERN horizon (sun/moon territory) —
  // sky/stars/moon captures
  rig.controls.maxPolarAngle = 2.4; // allow looking up at the sky
  setTargetElevation(14);
  rig.camera.position.set(0, 2.5, -26);
  rig.controls.update();
}
if (params.get('probe') === 'sky') {
  setTimeout(() => {
    const sky = (window as unknown as { __sky: { stars: { visible: boolean; position: { x: number; z: number } }; starMat: { opacity: number }; moonSprite: { visible: boolean; position: { x: number; y: number; z: number } }; moonMat: { opacity: number } } }).__sky;
    const m = sky.moonSprite.position;
    document.title = `SKYPROBE stars=${sky.stars.visible} op=${sky.starMat.opacity.toFixed(2)} moon=${sky.moonSprite.visible} mop=${sky.moonMat.opacity.toFixed(2)} mpos=${m.x.toFixed(0)},${m.y.toFixed(0)},${m.z.toFixed(0)} cam=${rig.camera.position.toArray().map((v) => Number(v).toFixed(1))}`;
  }, 6000);
}
{
  // deterministic captures: #sun=YYYY-MM-DD,minutes[,cloudPct] or #sun=off
  const sunParam = params.get('sun');
  if (sunParam === 'off') {
    sunPanel.set({ enabled: false });
  } else if (sunParam) {
    const [date, minutes, clouds] = sunParam.split(',');
    sunPanel.set({
      enabled: true,
      date,
      minutes: parseInt(minutes, 10),
      clouds: !!clouds,
      cloudPct: clouds ? parseInt(clouds, 10) : 0,
    });
  }
}
