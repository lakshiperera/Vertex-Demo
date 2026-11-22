import type { LaptopModel, Port, PortSide } from '../shared/types';
import { add, cross, dot, normalize, scale, sub, type Pose, type Vec3 } from './math';

/** The laptop base frame expressed in camera coordinates (mm). */
export interface LaptopFrame {
  /** Centre of the hinge line on the top surface of the base. */
  origin: Vec3;
  /** Right (along the hinge). */
  X: Vec3;
  /** Up (perpendicular to the desk). */
  Y: Vec3;
  /** Towards the user (front of the laptop). */
  Z: Vec3;
  /** Lid "up" direction and screen normal, from the marker pose. */
  lidUp: Vec3;
  lidNormal: Vec3;
  lidAngleDeg: number;
  usedGravity: boolean;
}

/**
 * Work out where the base is from the screen pose.
 *
 * The screen tells us the hinge line (bottom edge of the lid) but not the lid angle.
 * The base lies flat on the desk, so it is the horizontal plane through the hinge line:
 * we take "horizontal" from the phone's gravity sensor. Without a sensor we assume
 * the model's default lid angle.
 */
export function computeLaptopFrame(
  screen: Pose,
  model: LaptopModel,
  upCam: Vec3 | null,
  fallbackLidDeg: number,
): LaptopFrame {
  const X = screen.r1;
  const lidUp = screen.r2;
  const lidNormal = screen.r3;
  const origin = sub(screen.t, scale(lidUp, model.display.hingeToDisplayBottomMm));

  let Y: Vec3 | null = null;
  let usedGravity = false;
  if (upCam) {
    // Fix the sign: the lid always leans upwards, so "up" must agree with the lid direction.
    const up = dot(upCam, lidUp) < 0 ? scale(upCam, -1) : upCam;
    const yCand = normalize(sub(up, scale(X, dot(up, X))));
    const zCand = cross(X, yCand);
    const angle = (Math.atan2(dot(lidUp, yCand), dot(lidUp, zCand)) * 180) / Math.PI;
    // Ignore implausible angles (e.g. phone held sideways, sensor glitch).
    if (angle > 60 && angle < 170) {
      Y = yCand;
      usedGravity = true;
    }
  }
  if (!Y) {
    const th = (fallbackLidDeg * Math.PI) / 180;
    // lidUp = sinθ·Y + cosθ·Z and lidNormal = −cosθ·Y + sinθ·Z  ⇒  Y = sinθ·lidUp − cosθ·lidNormal
    Y = normalize(sub(scale(lidUp, Math.sin(th)), scale(lidNormal, Math.cos(th))));
  }
  const Z = cross(X, Y);
  const lidAngleDeg = (Math.atan2(dot(lidUp, Y), dot(lidUp, Z)) * 180) / Math.PI;
  return { origin, X, Y, Z, lidUp, lidNormal, lidAngleDeg, usedGravity };
}

/** Base-frame point (mm) → camera coordinates. */
export function baseToCamera(f: LaptopFrame, x: number, y: number, z: number): Vec3 {
  return add(add(add(f.origin, scale(f.X, x)), scale(f.Y, y)), scale(f.Z, z));
}

/** Lid-frame point (x right, v up the lid from the hinge) → camera coordinates. */
export function lidToCamera(f: LaptopFrame, x: number, v: number): Vec3 {
  return add(add(f.origin, scale(f.X, x)), scale(f.lidUp, v));
}

export function portToCamera(f: LaptopFrame, p: Port): Vec3 {
  const { x, y, z } = p.positionMm;
  return p.side === 'lid' ? lidToCamera(f, x, y) : baseToCamera(f, x, y, z);
}

/** Outward normal of the face a port sits on, in camera coordinates. */
export function sideNormal(f: LaptopFrame, side: PortSide): Vec3 {
  switch (side) {
    case 'left':
      return scale(f.X, -1);
    case 'right':
      return f.X;
    case 'front':
      return f.Z;
    case 'back':
      return scale(f.Z, -1);
    case 'top':
      return f.Y;
    case 'lid':
      return f.lidNormal;
  }
}
