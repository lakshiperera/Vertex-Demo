import { AR, type ArucoMarker } from '../vendor/js-aruco2/aruco.js';
import { DICTIONARY_NAME } from '../shared/markers';
import type { MarkerPayload } from '../shared/payload';
import { applyH, findHomography, poseFromHomography, type Intrinsics, type Mat3, type Pose, type Vec2 } from './math';

export interface TrackResult {
  pose: Pose;
  /** Plane (mm) → source image (px) homography, used for focal-length calibration. */
  H: Mat3;
  markerIds: number[];
  /** Detected marker corners in source-image pixels (for the debug view). */
  corners: Vec2[][];
  reprojErrorPx: number;
}

export class MarkerTracker {
  private detector = new AR.Detector({ dictionaryName: DICTIONARY_NAME, maxHammingDistance: 4 });

  /** Consecutive frames whose markers matched the ids but not the layout. */
  inconsistent = 0;

  detect(img: ImageData): ArucoMarker[] {
    return this.detector.detectImage(img.width, img.height, img.data);
  }

  /**
   * Estimate the pose of the laptop display plane from detected markers.
   * @param toSource factor that converts processing-image pixels to source-image pixels
   */
  estimate(
    markers: ArucoMarker[],
    payload: MarkerPayload,
    toSource: number,
    getK: (H: Mat3, markerCount: number) => Intrinsics,
  ): TrackResult | null {
    // Keep the best detection per marker of this page (ids i…i+3 → index 0…3).
    const base = payload.i ?? 0;
    const best = new Map<number, ArucoMarker>();
    for (const m of markers) {
      const k = m.id - base;
      if (k < 0 || k > 3) continue;
      const prev = best.get(k);
      if (!prev || m.hammingDistance < prev.hammingDistance) best.set(k, m);
    }
    if (best.size === 0) return null;

    const h = payload.s / 2;
    const src: Vec2[] = [];
    const dst: Vec2[] = [];
    const corners: Vec2[][] = [];
    for (const [k, m] of best) {
      const [cx, cy] = payload.k[k];
      // Corner order from the detector: TL, TR, BR, BL of the marker as drawn (display y is up).
      const plane: Vec2[] = [
        [cx - h, cy + h],
        [cx + h, cy + h],
        [cx + h, cy - h],
        [cx - h, cy - h],
      ];
      const img: Vec2[] = m.corners.map((c) => [c.x * toSource, c.y * toSource]);
      corners.push(img);
      for (let i = 0; i < 4; i++) {
        src.push(plane[i]);
        dst.push(img[i]);
      }
    }

    const H = findHomography(src, dst);
    if (!H) return null;

    let err = 0;
    for (let i = 0; i < src.length; i++) {
      const [u, v] = applyH(H, src[i][0], src[i][1]);
      err += Math.hypot(u - dst[i][0], v - dst[i][1]);
    }
    err /= src.length;
    if (err > 6 * toSource) {
      this.inconsistent++;
      return null; // markers don't fit this layout (stale QR data, bad corners)
    }
    this.inconsistent = 0;

    // The caller may refine its focal-length estimate from H before choosing intrinsics.
    const pose = poseFromHomography(H, getK(H, best.size));
    if (!pose || pose.t[2] < 80 || pose.t[2] > 4000) return null;
    return { pose, H, markerIds: [...best.keys()], corners, reprojErrorPx: err };
  }
}
