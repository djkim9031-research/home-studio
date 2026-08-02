import type { House, StoryPlan, Vec2 } from '../types';
import { saveHouse } from '../state/houses';

type Tool = 'calibrate' | 'boundary' | 'walls' | 'openings';

const SNAP_DEG = 7; // snap to 0/45/90 when within this of an axis

/** Full-screen calibrate + trace editor for one story's plan.
 * Resolves true when saved. */
export function openTracer(house: House, storyKey: number | 'basement'): Promise<boolean> {
  const plan = storyKey === 'basement' ? house.basementPlan : house.plans[storyKey];
  if (!plan || !plan.imageData) return Promise.resolve(false);

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'hs-tracer';
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'hs-tracer-canvas';
    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);
    const col = document.createElement('div');
    col.className = 'hs-tracer-col';
    root.append(canvasWrap, col);
    document.body.appendChild(root);

    const storyLabel = storyKey === 'basement' ? 'Basement' : `Story ${storyKey + 1}`;
    col.innerHTML = `
      <h3>${house.name} — ${storyLabel}</h3>
      <div class="hs-step" data-k="step-calibrate">
        <b>1 · Calibrate</b><br>Click both ends of a known dimension on the plan,
        then enter its real length.
        <div class="row" style="margin-top:6px;display:flex;gap:6px;align-items:center;">
          <input type="number" data-k="calft" min="0" max="200" step="1" style="width:54px" placeholder="ft"> ft
          <input type="number" data-k="calin" min="0" max="11.75" step="0.25" style="width:54px" placeholder="in" value="0"> in
          <button class="ui-btn" data-k="calapply">Apply</button>
        </div>
        <small data-k="calinfo"></small>
      </div>
      <div class="hs-step" data-k="step-boundary">
        <b>2 · Exterior boundary</b><br>Click along the outside walls.
        Enter closes the loop, Backspace undoes, Shift disables angle snap.
        <div><small data-k="binfo"></small></div>
      </div>
      <div class="hs-step" data-k="step-walls">
        <b>3 · Interior walls</b> (optional)<br>Click wall runs; Enter ends a run.
        <div><small data-k="winfo"></small></div>
      </div>
      <div class="hs-step" data-k="step-openings">
        <b>4 · Doors &amp; windows</b> (optional)<br>Click on a wall where an opening
        sits, set its width.
        <div class="row" style="margin-top:6px;display:flex;gap:6px;align-items:center;">
          <input type="number" data-k="openw" min="12" max="240" step="1" value="32" style="width:60px"> in wide
          <button class="ui-btn" data-k="opendoor">door</button>
          <button class="ui-btn" data-k="openwin">window</button>
        </div>
        <small data-k="oinfo"></small>
      </div>
      <div style="margin-top:auto;display:flex;gap:8px;">
        <button class="ui-btn" data-k="cancel">Cancel</button>
        <button class="ui-btn" data-k="save" style="flex:1;background:var(--brass);color:#fffdf8;font-weight:600;">Save story</button>
      </div>`;

    const el = <T extends HTMLElement>(k: string): T => col.querySelector(`[data-k="${k}"]`) as T;

    // working copies (committed on Save)
    const work: Pick<StoryPlan, 'inPerPx' | 'boundaryPx' | 'wallsPx' | 'openingsPx'> = {
      inPerPx: plan.inPerPx,
      boundaryPx: plan.boundaryPx.map((p) => ({ ...p })),
      wallsPx: plan.wallsPx.map((w) => w.map((p) => ({ ...p }))),
      openingsPx: plan.openingsPx.map((o) => ({ ...o })),
    };
    let tool: Tool = work.inPerPx > 0 ? 'boundary' : 'calibrate';
    let calPts: Vec2[] = [];
    let boundaryOpen = work.boundaryPx.length === 0;
    let currentWall: Vec2[] = [];
    let openingKind = true; // true = door
    let hover: Vec2 | null = null;

    const img = new Image();
    img.src = plan.imageData!;

    // view transform: image px -> screen px
    const view = { scale: 1, ox: 0, oy: 0 };
    const fitView = (): void => {
      const W = canvasWrap.clientWidth;
      const H = canvasWrap.clientHeight;
      view.scale = Math.min(W / plan.imageW, H / plan.imageH) * 0.94;
      view.ox = (W - plan.imageW * view.scale) / 2;
      view.oy = (H - plan.imageH * view.scale) / 2;
    };
    const toImg = (sx: number, sy: number): Vec2 => ({
      x: (sx - view.ox) / view.scale,
      z: (sy - view.oy) / view.scale,
    });
    const toScr = (p: Vec2): [number, number] => [p.x * view.scale + view.ox, p.z * view.scale + view.oy];

    const snapPoint = (p: Vec2, prev: Vec2 | null, free: boolean): Vec2 => {
      if (!prev || free) return p;
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      const ang = (Math.atan2(dz, dx) * 180) / Math.PI;
      const len = Math.hypot(dx, dz);
      for (const a of [0, 45, 90, 135, 180, -45, -90, -135, -180]) {
        if (Math.abs(ang - a) < SNAP_DEG) {
          const r = (a * Math.PI) / 180;
          return { x: prev.x + len * Math.cos(r), z: prev.z + len * Math.sin(r) };
        }
      }
      return p;
    };

    const fmtLen = (px: number): string => {
      if (!work.inPerPx) return '';
      const inches = px * work.inPerPx;
      const ft = Math.floor(inches / 12);
      return `${ft}'${Math.round(inches - ft * 12)}"`;
    };

    // nearest point on any traced segment (for openings)
    const nearestOnWalls = (p: Vec2): { x: number; z: number; d: number } | null => {
      let best: { x: number; z: number; d: number } | null = null;
      const test = (a: Vec2, b: Vec2): void => {
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1)));
        const qx = a.x + abx * t;
        const qz = a.z + abz * t;
        const d = Math.hypot(p.x - qx, p.z - qz);
        if (!best || d < best.d) best = { x: qx, z: qz, d };
      };
      const b = work.boundaryPx;
      for (let i = 0; i < b.length; i++) test(b[i], b[(i + 1) % b.length]);
      for (const w of work.wallsPx) for (let i = 0; i < w.length - 1; i++) test(w[i], w[i + 1]);
      return best;
    };

    const setTool = (t: Tool): void => {
      tool = t;
      for (const key of ['calibrate', 'boundary', 'walls', 'openings'] as const) {
        el(`step-${key}`).classList.toggle('on', key === tool);
      }
      draw();
    };
    for (const key of ['calibrate', 'boundary', 'walls', 'openings'] as const) {
      el(`step-${key}`).addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return;
        setTool(key);
      });
    }

    const refreshInfo = (): void => {
      el('calinfo').textContent = work.inPerPx
        ? `scale: 1 px = ${work.inPerPx.toFixed(3)}" (${(work.inPerPx * plan.imageW / 12).toFixed(0)}' plan width)`
        : calPts.length === 1
          ? 'now click the second end…'
          : '';
      el('binfo').textContent = work.boundaryPx.length
        ? `${work.boundaryPx.length} corners${boundaryOpen ? ' (Enter to close)' : ' · closed ✓'}`
        : '';
      el('winfo').textContent = work.wallsPx.length
        ? `${work.wallsPx.length} wall runs`
        : '';
      el('oinfo').textContent = work.openingsPx.length
        ? `${work.openingsPx.length} openings (${work.openingsPx.filter((o) => o.door).length} doors)`
        : '';
    };

    // ---- render ----
    const draw = (): void => {
      const W = canvasWrap.clientWidth;
      const H = canvasWrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#ddd6c9';
      g.fillRect(0, 0, W, H);
      if (img.complete && img.naturalWidth) {
        g.drawImage(img, view.ox, view.oy, plan.imageW * view.scale, plan.imageH * view.scale);
      }

      const seg = (a: Vec2, b: Vec2, color: string, width: number, dash: number[] = []): void => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.setLineDash(dash);
        g.beginPath();
        g.moveTo(...toScr(a));
        g.lineTo(...toScr(b));
        g.stroke();
        g.setLineDash([]);
      };
      const dot = (p: Vec2, color: string, r = 4): void => {
        g.fillStyle = color;
        g.beginPath();
        g.arc(...toScr(p), r, 0, Math.PI * 2);
        g.fill();
      };
      const label = (a: Vec2, b: Vec2): void => {
        if (!work.inPerPx) return;
        const [x1, y1] = toScr(a);
        const [x2, y2] = toScr(b);
        const text = fmtLen(Math.hypot(b.x - a.x, b.z - a.z));
        g.font = '11px system-ui';
        g.fillStyle = '#463f35';
        g.strokeStyle = 'rgba(250,246,240,0.85)';
        g.lineWidth = 3;
        g.strokeText(text, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 4);
        g.fillText(text, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 4);
      };

      // calibration line
      if (calPts.length) {
        const end = calPts[1] ?? (tool === 'calibrate' ? hover : null);
        if (end) seg(calPts[0], end, '#b4655a', 2, [6, 4]);
        dot(calPts[0], '#b4655a');
        if (calPts[1]) dot(calPts[1], '#b4655a');
      }
      // boundary
      const b = work.boundaryPx;
      for (let i = 0; i < b.length - (boundaryOpen ? 1 : 0); i++) {
        const a = b[i];
        const c = b[(i + 1) % b.length];
        seg(a, c, '#b08d57', 3);
        label(a, c);
      }
      b.forEach((p) => dot(p, '#b08d57'));
      if (boundaryOpen && b.length && hover && tool === 'boundary') {
        seg(b[b.length - 1], snapPoint(hover, b[b.length - 1], shiftHeld), '#b08d57', 1.5, [5, 4]);
      }
      // interior walls
      for (const w of [...work.wallsPx, currentWall]) {
        for (let i = 0; i < w.length - 1; i++) {
          seg(w[i], w[i + 1], '#5a7d8a', 2.5);
          label(w[i], w[i + 1]);
        }
        w.forEach((p) => dot(p, '#5a7d8a', 3));
      }
      if (currentWall.length && hover && tool === 'walls') {
        seg(currentWall[currentWall.length - 1], snapPoint(hover, currentWall[currentWall.length - 1], shiftHeld), '#5a7d8a', 1.5, [5, 4]);
      }
      // openings
      for (const o of work.openingsPx) {
        dot(o, o.door ? '#8a9a7b' : '#7b8a9a', 6);
        g.font = '10px system-ui';
        g.fillStyle = '#fffdf8';
        const [sx, sy] = toScr(o);
        g.fillText(o.door ? 'D' : 'W', sx - 3, sy + 3);
      }
      refreshInfo();
    };

    // ---- interaction ----
    let shiftHeld = false;
    let panning: { x: number; y: number; ox: number; oy: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        panning = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const p = toImg(e.clientX - rect.left, e.clientY - rect.top);
      if (tool === 'calibrate') {
        if (calPts.length >= 2) calPts = [];
        calPts.push(p);
      } else if (tool === 'boundary') {
        if (!boundaryOpen) {
          boundaryOpen = true;
          work.boundaryPx = [];
        }
        work.boundaryPx.push(snapPoint(p, work.boundaryPx[work.boundaryPx.length - 1] ?? null, e.shiftKey));
      } else if (tool === 'walls') {
        currentWall.push(snapPoint(p, currentWall[currentWall.length - 1] ?? null, e.shiftKey));
      } else if (tool === 'openings') {
        const near = nearestOnWalls(p);
        if (near && near.d * view.scale < 14) {
          work.openingsPx.push({
            x: near.x,
            z: near.z,
            widthIn: Math.max(12, Number(el<HTMLInputElement>('openw').value) || 32),
            door: openingKind,
          });
        }
      }
      draw();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', onMove);
    function onMove(e: PointerEvent): void {
      if (panning) {
        view.ox = panning.ox + (e.clientX - panning.x);
        view.oy = panning.oy + (e.clientY - panning.y);
        draw();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      hover = toImg(e.clientX - rect.left, e.clientY - rect.top);
      shiftHeld = e.shiftKey;
      draw();
    }
    window.addEventListener('pointerup', onUp);
    function onUp(): void {
      panning = null;
    }
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const before = toImg(mx, my);
      view.scale *= e.deltaY > 0 ? 0.88 : 1.14;
      view.scale = Math.min(12, Math.max(0.05, view.scale));
      view.ox = mx - before.x * view.scale;
      view.oy = my - before.z * view.scale;
      draw();
    }, { passive: false });

    window.addEventListener('keydown', onKey);
    function onKey(e: KeyboardEvent): void {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Enter') {
        if (tool === 'boundary' && work.boundaryPx.length >= 3) boundaryOpen = false;
        if (tool === 'walls' && currentWall.length >= 2) {
          work.wallsPx.push(currentWall);
          currentWall = [];
        }
        draw();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (tool === 'calibrate') calPts.pop();
        else if (tool === 'boundary' && boundaryOpen) work.boundaryPx.pop();
        else if (tool === 'walls') {
          if (currentWall.length) currentWall.pop();
          else work.wallsPx.pop();
        } else if (tool === 'openings') work.openingsPx.pop();
        draw();
      } else if (e.key === 'Escape') {
        finish(false);
      }
    }

    el<HTMLButtonElement>('calapply').addEventListener('click', () => {
      if (calPts.length !== 2) {
        el('calinfo').textContent = 'click the two ends of a known dimension first';
        return;
      }
      const lenIn = (Number(el<HTMLInputElement>('calft').value) || 0) * 12 + (Number(el<HTMLInputElement>('calin').value) || 0);
      const px = Math.hypot(calPts[1].x - calPts[0].x, calPts[1].z - calPts[0].z);
      if (lenIn < 6 || px < 4) {
        el('calinfo').textContent = 'enter the real length of that line (≥ 6")';
        return;
      }
      work.inPerPx = lenIn / px;
      setTool('boundary');
    });
    const setKind = (door: boolean): void => {
      openingKind = door;
      el('opendoor').classList.toggle('on', door);
      el('openwin').classList.toggle('on', !door);
    };
    el<HTMLButtonElement>('opendoor').addEventListener('click', () => setKind(true));
    el<HTMLButtonElement>('openwin').addEventListener('click', () => setKind(false));
    setKind(true);

    const finish = (save: boolean): void => {
      if (save) {
        if (currentWall.length >= 2) work.wallsPx.push(currentWall);
        plan.inPerPx = work.inPerPx;
        plan.boundaryPx = work.boundaryPx;
        plan.wallsPx = work.wallsPx;
        plan.openingsPx = work.openingsPx;
        saveHouse(house);
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      root.remove();
      resolve(save);
    };
    el<HTMLButtonElement>('cancel').addEventListener('click', () => finish(false));
    el<HTMLButtonElement>('save').addEventListener('click', () => {
      if (!work.inPerPx) {
        el('calinfo').textContent = 'calibrate first — the 3D model needs a scale';
        setTool('calibrate');
        return;
      }
      if (boundaryOpen || work.boundaryPx.length < 3) {
        el('binfo').textContent = 'trace and close the exterior boundary first';
        setTool('boundary');
        return;
      }
      finish(true);
    });

    const ro = new ResizeObserver(() => {
      draw();
    });
    ro.observe(canvasWrap);
    img.onload = () => {
      fitView();
      draw();
    };
    fitView();
    setTool(tool);
  });
}
