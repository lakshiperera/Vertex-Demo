import { AR, type ArucoDictionary } from '../vendor/js-aruco2/aruco.js';
import type { MarkerPayload } from './payload';

export const DICTIONARY_NAME = 'ARUCO_MIP_36h12';

let dict: ArucoDictionary | null = null;
function dictionary() {
  if (!dict) dict = new AR.Dictionary(DICTIONARY_NAME);
  return dict;
}

export interface MarkerLayout {
  markerSizeMm: number;
  centers: [number, number][];
}

/**
 * Place 4 markers (ids 0..3 = TL, TR, BR, BL) in the corners of a display of the
 * given size in mm. Coordinates: origin = bottom-centre of the display, x right, y up.
 */
export function computeMarkerLayout(displayWmm: number, displayHmm: number): MarkerLayout {
  const s = Math.max(20, Math.min(50, Math.min(displayWmm, displayHmm) * 0.22));
  const margin = (s / 8) * 1.5; // white quiet zone between marker and display edge
  const x = displayWmm / 2 - margin - s / 2;
  const yBottom = margin + s / 2;
  const yTop = displayHmm - margin - s / 2;
  return {
    markerSizeMm: s,
    centers: [
      [-x, yTop],
      [x, yTop],
      [x, yBottom],
      [-x, yBottom],
    ],
  };
}

/** Draw ArUco marker `id` with its outer black square at (x, y), `size` px wide. */
export function drawArucoMarker(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, size: number) {
  const d = dictionary();
  const grid = d.markSize; // includes the black border
  const n = grid - 2;
  const code = d.codeList[id];
  const cell = size / grid;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#fff';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code[r * n + c] === '1') {
        // Slight overdraw avoids hairline gaps between neighbouring cells.
        ctx.fillRect(x + (c + 1) * cell - 0.25, y + (r + 1) * cell - 0.25, cell + 0.5, cell + 0.5);
      }
    }
  }
}

/**
 * Render the marker page: white background, 4 corner markers, QR in the centre.
 * `ppm` = canvas pixels per millimetre. Display origin is the bottom-centre.
 */
export function renderMarkerPage(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  ppm: number,
  payload: MarkerPayload,
  qr: HTMLCanvasElement | null,
  caption?: string,
) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  const sizePx = payload.s * ppm;
  payload.k.forEach(([cx, cy], id) => {
    const px = widthPx / 2 + cx * ppm - sizePx / 2;
    const py = heightPx - cy * ppm - sizePx / 2;
    drawArucoMarker(ctx, id, px, py, sizePx);
  });
  if (qr) {
    const qrSize = Math.min(heightPx * 0.5, widthPx * 0.32);
    const qx = (widthPx - qrSize) / 2;
    const qy = (heightPx - qrSize) / 2 - heightPx * 0.04;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qr, qx, qy, qrSize, qrSize);
    if (caption) {
      ctx.fillStyle = '#1f2937';
      ctx.font = `600 ${Math.round(qrSize * 0.075)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(caption, widthPx / 2, qy + qrSize + qrSize * 0.06);
    }
  }
}
