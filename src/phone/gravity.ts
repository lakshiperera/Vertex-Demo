import { normalize, type Vec3 } from './math';

type MotionPermissionFn = () => Promise<'granted' | 'denied'>;

/**
 * Reads the accelerometer and gives the "up" direction in rear-camera coordinates
 * (x right, y down, z forward out of the back of the phone).
 *
 * The overall sign differs between browsers (iOS reports the opposite sign to Android),
 * so callers must fix the sign using scene knowledge; see laptopPose.ts.
 */
export class GravitySensor {
  private up: Vec3 | null = null;
  private lastTs = 0;
  private listening = false;

  /** Must be called from a user gesture (iOS asks for permission). */
  static async requestPermission(): Promise<boolean> {
    const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: MotionPermissionFn } }).DeviceMotionEvent;
    if (!DME) return false;
    if (typeof DME.requestPermission === 'function') {
      try {
        return (await DME.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('devicemotion', this.onMotion);
  }

  stop() {
    this.listening = false;
    window.removeEventListener('devicemotion', this.onMotion);
  }

  /** Latest up vector in camera coordinates, or null if no recent sensor data. */
  getUp(): Vec3 | null {
    if (!this.up || performance.now() - this.lastTs > 1000) return null;
    return this.up;
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    // Rotate device axes into the current screen orientation (video is shown upright).
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const sx = a.x * Math.cos(angle) - a.y * Math.sin(angle);
    const sy = a.x * Math.sin(angle) + a.y * Math.cos(angle);
    // Device: x right, y up, z out of the screen. Rear camera: x right, y down, z out of the back.
    const v = normalize([sx, -sy, -a.z]);
    if (!this.up) this.up = v;
    else {
      const k = 0.2; // low-pass filter
      this.up = normalize([
        this.up[0] + (v[0] - this.up[0]) * k,
        this.up[1] + (v[1] - this.up[1]) * k,
        this.up[2] + (v[2] - this.up[2]) * k,
      ]);
    }
    this.lastTs = performance.now();
  };
}
