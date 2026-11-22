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
    // Keep the best detection per id (0..3 only).
    const best = new Map<number, ArucoMarker>();
    for (const m of markers) {
      if (m.id < 0 || m.id > 3) continue;
      const prev = best.get(m.id);
      if (!prev || m.hammingDistance < prev.hammingDistance) best.set(m.id, m);
    }
    if (best.size === 0) return null;

    const h = payload.s / 2;
    const src: Vec2[] = [];
    const dst: Vec2[] = [];
    const corners: Vec2[][] = [];
    for (const [id, m] of best) {
      const [cx, cy] = payload.k[id];
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
    if (err > 6 * toSource) return null; // inconsistent detections (wrong marker, bad corners)

    // The caller may refine its focal-length estimate from H before choosing intrinsics.
    const pose = poseFromHomography(H, getK(H, best.size));
    if (!pose || pose.t[2] < 80 || pose.t[2] > 4000) return null;
    return { pose, H, markerIds: [...best.keys()], corners, reprojErrorPx: err };
  }
}
