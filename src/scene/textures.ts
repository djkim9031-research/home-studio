import * as THREE from 'three';

/** Deterministic rng so rebuilt textures always match. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Wall finishes — near-white bases so the per-element color tint reads true.
// ---------------------------------------------------------------------------

export function paintTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (g) => {
    g.fillStyle = '#fdfdfd';
    g.fillRect(0, 0, 64, 64);
  });
}

export function plasterTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#fbfaf8';
    g.fillRect(0, 0, s, s);
    const rnd = mulberry32(0x9e11);
    for (let i = 0; i < 5200; i++) {
      const shade = 236 + Math.floor(rnd() * 20);
      g.fillStyle = `rgba(${shade},${shade - 2},${shade - 5},${0.25 + rnd() * 0.4})`;
      const r = 0.6 + rnd() * 2.4;
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** repeats: one tile of this texture covers 32" × 32" of wall */
export function brickTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const rnd = mulberry32(0xb51c);
    g.fillStyle = '#d9d4cc'; // mortar
    g.fillRect(0, 0, s, s);
    const rows = 12; // courses in the tile
    const bh = s / rows;
    const bw = s / 4;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let cIdx = -1; cIdx < 5; cIdx++) {
        const x = cIdx * bw + off;
        const tone = 200 + Math.floor(rnd() * 45);
        g.fillStyle = `rgb(${tone},${tone - 8},${tone - 16})`;
        g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
        // subtle per-brick shading
        g.fillStyle = `rgba(120,100,90,${rnd() * 0.14})`;
        g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
  });
}

/** vertical shiplap-style boards; one tile = 32" × 32" */
export function woodPanelTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const rnd = mulberry32(0x77d1);
    const boards = 6;
    const bw = s / boards;
    for (let b = 0; b < boards; b++) {
      const tone = 224 + Math.floor(rnd() * 22);
      g.fillStyle = `rgb(${tone},${tone - 6},${tone - 14})`;
      g.fillRect(b * bw, 0, bw, s);
      g.strokeStyle = 'rgba(90,74,60,0.35)';
      g.lineWidth = 2;
      g.strokeRect(b * bw + 1, -2, bw - 2, s + 4);
      // grain streaks
      g.strokeStyle = `rgba(150,128,104,${0.12 + rnd() * 0.1})`;
      g.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const x = b * bw + 4 + rnd() * (bw - 8);
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + rnd() * 6 - 3, s * 0.33, x + rnd() * 6 - 3, s * 0.66, x + rnd() * 4 - 2, s);
        g.stroke();
      }
    }
  });
}

/** two-tone vertical wallpaper stripes; one tile = 32" */
export function stripesTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const bands = 8;
    const bw = s / bands;
    for (let b = 0; b < bands; b++) {
      g.fillStyle = b % 2 ? '#f6f3ec' : '#e4ddd0';
      g.fillRect(b * bw, 0, bw, s);
    }
  });
}

/** fine beadboard panels with groove shadows; one tile = 24" */
export function beadboardTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const rnd = mulberry32(0xbead);
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, s, s);
    const boards = 8;
    const bw = s / boards;
    for (let b = 0; b < boards; b++) {
      const tone = 240 + Math.floor(rnd() * 10);
      g.fillStyle = `rgb(${tone},${tone - 2},${tone - 6})`;
      g.fillRect(b * bw + 2, 0, bw - 4, s);
      g.strokeStyle = 'rgba(110,100,86,0.4)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(b * bw + 1, 0);
      g.lineTo(b * bw + 1, s);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(b * bw + 4, 0);
      g.lineTo(b * bw + 4, s);
      g.stroke();
    }
  });
}

/** floral damask-style wallpaper motif; one tile = 24" */
export function damaskTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(150,132,104,0.5)';
    g.fillStyle = 'rgba(150,132,104,0.28)';
    const motif = (cx: number, cy: number, r: number): void => {
      g.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.34, r * 0.16, a, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
      g.fill();
    };
    // offset grid of motifs
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        motif(col * 128 + (row % 2 ? 64 : 0) + 32, row * 128 + 64, 42);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Floor finishes
// ---------------------------------------------------------------------------

/** oak planks; one tile = 48" × 48" */
export function oakPlankTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const rnd = mulberry32(0x0a4b);
    const rows = 8;
    const rh = s / rows;
    const palette = ['#c8a97c', '#bfa072', '#d1b286', '#b9975f', '#cbad80'];
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 120;
      while (x < s) {
        const w = 100 + rnd() * 140;
        g.fillStyle = palette[Math.floor(rnd() * palette.length)];
        g.fillRect(x, r * rh, w, rh);
        g.fillStyle = `rgba(90,64,40,${0.06 + rnd() * 0.1})`;
        g.fillRect(x, r * rh, w, rh);
        g.strokeStyle = 'rgba(80,58,38,0.5)';
        g.lineWidth = 1.4;
        g.strokeRect(x, r * rh + 0.5, w, rh - 1);
        // grain
        g.strokeStyle = `rgba(122,90,58,${0.16 + rnd() * 0.12})`;
        g.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const y = r * rh + 2 + rnd() * (rh - 4);
          g.beginPath();
          g.moveTo(x + 2, y);
          g.bezierCurveTo(x + w * 0.3, y + rnd() * 3 - 1.5, x + w * 0.6, y + rnd() * 3 - 1.5, x + w - 2, y + rnd() * 2 - 1);
          g.stroke();
        }
        x += w;
      }
    }
  });
}

/** ceramic tile grid; one tile = 48" × 48" (4 tiles of 12") */
export function tileTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const rnd = mulberry32(0x711e);
    g.fillStyle = '#c9c4bb'; // grout
    g.fillRect(0, 0, s, s);
    const n = 4;
    const tw = s / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const tone = 232 + Math.floor(rnd() * 16);
        g.fillStyle = `rgb(${tone},${tone - 2},${tone - 6})`;
        g.fillRect(c * tw + 3, r * tw + 3, tw - 6, tw - 6);
        g.fillStyle = `rgba(255,255,255,${rnd() * 0.12})`;
        g.beginPath();
        g.ellipse(c * tw + tw * 0.35, r * tw + tw * 0.3, tw * 0.28, tw * 0.16, -0.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

/** carpet fuzz; one tile = 32" × 32" */
export function carpetTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#e3ddd2';
    g.fillRect(0, 0, s, s);
    const rnd = mulberry32(0xca9e);
    for (let i = 0; i < 20000; i++) {
      const t = 205 + Math.floor(rnd() * 40);
      g.fillStyle = `rgba(${t},${t - 4},${t - 12},0.5)`;
      g.fillRect(rnd() * s, rnd() * s, 1.6, 1.6);
    }
  });
}

/** sealed concrete; one tile = 64" × 64" */
export function concreteTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#d7d6d2';
    g.fillRect(0, 0, s, s);
    const rnd = mulberry32(0xc0dc);
    for (let i = 0; i < 4200; i++) {
      const t = 190 + Math.floor(rnd() * 46);
      g.fillStyle = `rgba(${t},${t},${t - 3},${0.12 + rnd() * 0.25})`;
      const r = 0.8 + rnd() * 3.4;
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
      g.fill();
    }
    // hairline cracks
    g.strokeStyle = 'rgba(120,118,112,0.35)';
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      let x = rnd() * s;
      let y = rnd() * s;
      g.beginPath();
      g.moveTo(x, y);
      for (let seg = 0; seg < 6; seg++) {
        x += rnd() * 90 - 45;
        y += rnd() * 90 - 45;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}
