import * as THREE from 'three';

// All textures are Canvas2D-generated (single-file CSP: no external assets)
// and seeded so they come out identical on every load.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d')!;
}

function toTexture(ctx: CanvasRenderingContext2D, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(ctx.canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Hardwood floor — 1024px == one 128" tile (8 px/inch), ~5" planks along v.
// ---------------------------------------------------------------------------

export function floorWoodTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  // 2048px == one 128" tile (16 px/in). Classic 2.5" red-oak strip flooring
  // per the venue photos: boards run E-W (u axis), satin sheen, honey→amber.
  const S = 2048;
  const rnd = mulberry32(0xf100d);
  const rows = 51; // 128/51 ≈ 2.5" strips
  const h = S / rows;
  const palette = ['#9C6C41', '#AA7A4B', '#855832', '#B4885A', '#8F6139', '#A17044', '#764C2A'];

  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S);
  ctx.fillStyle = '#7E5230';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#4a4a4a'; // satin base ~0.29
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const segs: { x0: number; x1: number; c: string; ro: number }[] = [];
    let x = -(60 + rnd() * 700);
    while (x < S) {
      const len = (24 + rnd() * 60) * 16; // 24–84" boards
      segs.push({ x0: x, x1: x + len, c: palette[(rnd() * palette.length) | 0], ro: 0.2 + rnd() * 0.18 });
      x += len;
    }
    segs[segs.length - 1].c = segs[0].c;
    segs[segs.length - 1].ro = segs[0].ro;
    for (const sg of segs) {
      const w = sg.x1 - sg.x0;
      ctx.fillStyle = sg.c;
      ctx.fillRect(sg.x0, y + 0.6, w - 1.2, h - 1.2);
      const g = Math.round(sg.ro * 255);
      rough.fillStyle = `rgb(${g},${g},${g})`;
      rough.fillRect(sg.x0, y + 0.6, w - 1.2, h - 1.2);

      // fine straight grain: many low-alpha length-wise streaks
      const nGrain = 8 + ((rnd() * 6) | 0);
      for (let i = 0; i < nGrain; i++) {
        const dark = rnd() < 0.68;
        ctx.strokeStyle = dark ? '#5E3B1E' : '#D8AC72';
        ctx.globalAlpha = 0.05 + rnd() * 0.1;
        ctx.lineWidth = 0.6 + rnd() * 1.1;
        const gy = y + 2 + rnd() * (h - 4);
        ctx.beginPath();
        ctx.moveTo(sg.x0 + 2, gy);
        let gx = sg.x0 + 2;
        let cy = gy;
        while (gx < sg.x1 - 4) {
          gx += 90 + rnd() * 140;
          cy = Math.min(y + h - 1.5, Math.max(y + 1.5, cy + (rnd() - 0.5) * 3));
          ctx.lineTo(Math.min(gx, sg.x1 - 4), cy);
        }
        ctx.stroke();
      }
      // occasional cathedral arcs
      if (rnd() < 0.4 && w > 300) {
        const cxr = sg.x0 + w * (0.25 + rnd() * 0.5);
        ctx.strokeStyle = '#6B441F';
        for (let a = 0; a < 4; a++) {
          ctx.globalAlpha = 0.1 - a * 0.018;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(cxr, y + h * 0.5, 60 + a * 34, h * (0.16 + a * 0.09), 0, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // end joint
      if (sg.x0 > 0 && sg.x0 < S) {
        ctx.fillStyle = '#4E3115';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
        ctx.globalAlpha = 1;
        rough.fillStyle = '#8c8c8c';
        rough.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
        bump.fillStyle = '#5a5a5a';
        bump.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
      }
      // per-board tone drift along the length (sun bleach / wear)
      const nW = 3 + ((rnd() * 3) | 0);
      for (let i = 0; i < nW; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(236,200,148,1)' : 'rgba(72,44,20,1)';
        ctx.globalAlpha = 0.03 + rnd() * 0.05;
        ctx.fillRect(sg.x0 + rnd() * w, y + 0.6, 60 + rnd() * 220, h - 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // strip joint line + milled micro-bevel (soft to avoid shimmer)
    ctx.fillStyle = '#4E3115';
    ctx.globalAlpha = 0.42;
    ctx.fillRect(0, y + h - 1.1, S, 1.4);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#F0CE96';
    ctx.fillRect(0, y + 0.6, S, 1.2);
    ctx.globalAlpha = 1;
    rough.fillStyle = '#909090';
    rough.fillRect(0, y + h - 1, S, 1.2);
    bump.fillStyle = '#565656';
    bump.fillRect(0, y + h - 1.2, S, 1.6);
    bump.fillStyle = '#a2a2a2';
    bump.fillRect(0, y + 0.4, S, 1);
  }

  const mapTex = toTexture(ctx, true);
  mapTex.anisotropy = 16;
  const roughTex = toTexture(rough, false);
  roughTex.anisotropy = 16;
  const bumpTex = toTexture(bump, false);
  bumpTex.anisotropy = 8;
  return { map: mapTex, roughnessMap: roughTex, bumpMap: bumpTex };
}

