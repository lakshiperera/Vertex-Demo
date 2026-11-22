import { focalFromHomography, type Mat3 } from './math';

/**
 * Learns the phone camera's focal length from the marker homographies, so users don't
 * have to guess the field of view. A wrong FOV mostly misplaces parts far from the
 * screen (the front edge, touchpad area), which is how labels end up on the wrong part.
 *
 * Frames are weighted by how tilted the screen is (head-on views carry no focal
 * information); the estimate is a weighted running mean in log space.
 */
export class FocalEstimator {
  private logF = 0;
  private weight = 0;

  /** Feed one homography (source-image pixels). Needs ≥ 3 markers for a stable estimate. */
  add(H: Mat3, width: number, height: number, markerCount: number) {
    if (markerCount < 3) return;
    const est = focalFromHomography(H, width / 2, height / 2);
    if (!est || est.tiltDeg < 15) return;
    const fov = fovFromFocal(est.f, width, height);
    if (fov < 40 || fov > 95) return; // implausible for a phone main camera
    const w = Math.sin((est.tiltDeg * Math.PI) / 180) ** 2;
    const total = this.weight + w;
    this.logF = (this.logF * this.weight + Math.log(est.f) * w) / total;
    this.weight = Math.min(total, 25); // cap so it keeps adapting if the camera changes
  }

  get ready() {
    return this.weight >= 3;
  }

  /** Focal length in pixels for an image of this size (estimate is resolution-specific). */
  focal(): number | null {
    return this.ready ? Math.exp(this.logF) : null;
  }

  reset() {
    this.logF = 0;
    this.weight = 0;
  }
}

export function fovFromFocal(f: number, width: number, height: number): number {
  return (2 * Math.atan(Math.max(width, height) / 2 / f) * 180) / Math.PI;
}
