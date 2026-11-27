import { AR, type ArucoDictionary } from '../vendor/js-aruco2/aruco.js';
import { markerIdsOf, type MarkerPayload } from './payload';

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
  const s = Math.max(20, Math.min(55, Math.min(displayWmm, displayHmm) * 0.24));
  // White quiet zone between the marker and the display edge. It must stay clearly
  // white in a blurry or angled phone photo, otherwise the marker's black border
  // merges with the dark screen bezel and the detector can't find its square outline.
  const margin = (s / 8) * 2.5;
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
 * QR size in canvas pixels: as large as possible while staying between the left and right
 * markers (so it never covers one in a small window). Generate the QR at exactly this size;
 * scaling a QR image afterwards smears its modules and it may stop decoding.
 */
export function qrSizePx(widthPx: number, heightPx: number, ppm: number, payload: MarkerPayload): number {
  const innerHalfMm = Math.min(...payload.k.map(([cx]) => Math.abs(cx))) - payload.s / 2;
  const maxQr = 2 * innerHalfMm * ppm - 0.3 * payload.s * ppm;
  return Math.max(0, Math.floor(Math.min(heightPx * 0.5, widthPx * 0.32, maxQr)));
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
  const ids = markerIdsOf(payload);
  payload.k.forEach(([cx, cy], k) => {
    const px = widthPx / 2 + cx * ppm - sizePx / 2;
    const py = heightPx - cy * ppm - sizePx / 2;
    drawArucoMarker(ctx, ids[k], px, py, sizePx);
  });
  if (qr) {
    const qrSize = qrSizePx(widthPx, heightPx, ppm, payload);
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
