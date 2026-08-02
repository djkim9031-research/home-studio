/** Floor-plan ingestion: images pass through, PDFs render their first page.
 * Everything becomes a dataURL raster so houses persist self-contained. */

const MAX_DIM = 2200; // downscale huge plans — tracing doesn't need more
const MAX_BYTES = 4_000_000;

export interface LoadedPlan {
  imageData: string;
  imageW: number;
  imageH: number;
}

export async function loadPlanFile(file: File): Promise<LoadedPlan> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const canvas = isPdf ? await renderPdfFirstPage(file) : await drawImageFile(file);
  const scaled = downscale(canvas);
  const imageData = scaled.toDataURL('image/png');
  if (imageData.length > MAX_BYTES * 1.4) {
    // fall back to jpeg for photographic plans
    const jpeg = scaled.toDataURL('image/jpeg', 0.85);
    if (jpeg.length > MAX_BYTES * 1.4) {
      throw new Error('plan too large even after downscaling — crop it and retry');
    }
    return { imageData: jpeg, imageW: scaled.width, imageH: scaled.height };
  }
  return { imageData, imageW: scaled.width, imageH: scaled.height };
}

async function drawImageFile(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('could not read that image'));
      im.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderPdfFirstPage(file: File): Promise<HTMLCanvasElement> {
  // main-thread pdf.js: no worker file to ship, fine for one page at a time
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '';
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, disableWorker: true } as never).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, MAX_DIM / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(viewport.width);
  c.height = Math.round(viewport.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport } as never).promise;
  await doc.destroy();
  return c;
}

function downscale(c: HTMLCanvasElement): HTMLCanvasElement {
  const m = Math.max(c.width, c.height);
  if (m <= MAX_DIM) return c;
  const s = MAX_DIM / m;
  const out = document.createElement('canvas');
  out.width = Math.round(c.width * s);
  out.height = Math.round(c.height * s);
  out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height);
  return out;
}
