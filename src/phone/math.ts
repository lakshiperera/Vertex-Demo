export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
/** 3×3 matrix, row-major, 9 numbers. */
export type Mat3 = number[];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Pinhole camera intrinsics, in source-image pixels (OpenCV convention: x right, y down, z forward). */
export interface Intrinsics {
  f: number;
  cx: number;
  cy: number;
}

/**
 * Rigid pose of a plane in camera coordinates (mm).
 * r1, r2 = plane x / y axes, r3 = plane normal (towards the camera), t = plane origin.
 */
export interface Pose {
  r1: Vec3;
  r2: Vec3;
  r3: Vec3;
  t: Vec3;
}

export function intrinsicsFromFov(width: number, height: number, fovDegLongSide: number): Intrinsics {
  const f = Math.max(width, height) / 2 / Math.tan((fovDegLongSide * Math.PI) / 360);
  return { f, cx: width / 2, cy: height / 2 };
}

export function project(p: Vec3, K: Intrinsics): Vec2 | null {
  if (p[2] < 1) return null; // behind or too close to the camera
  return [K.f * (p[0] / p[2]) + K.cx, K.f * (p[1] / p[2]) + K.cy];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function mat3Inv(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

export function applyH(H: Mat3, x: number, y: number): Vec2 {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Solve A·x = b (n×n) with Gaussian elimination and partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const fct = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= fct * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Hartley normalisation: centroid to origin, mean distance √2. */
function normalisation(pts: Vec2[]): Mat3 {
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  let d = 0;
  for (const [x, y] of pts) d += Math.hypot(x - mx, y - my);
  d /= pts.length;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

/**
 * Homography mapping src → dst (≥ 4 points), normalised DLT with h33 = 1,
 * least squares over all points.
 */
export function findHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const Ts = normalisation(src);
  const Td = normalisation(dst);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const addRow = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < src.length; k++) {
    const [x, y] = applyH(Ts, src[k][0], src[k][1]);
    const [u, v] = applyH(Td, dst[k][0], dst[k][1]);
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn: Mat3 = [...h, 1];
  const TdInv = mat3Inv(Td);
  if (!TdInv) return null;
  const H = mat3Mul(mat3Mul(TdInv, Hn), Ts);
  return H.map((v) => v / H[8]);
}

/** Decompose a plane→image homography into a camera-space pose, given intrinsics. */
export function poseFromHomography(H: Mat3, K: Intrinsics): Pose | null {
  const Kinv: Mat3 = [1 / K.f, 0, -K.cx / K.f, 0, 1 / K.f, -K.cy / K.f, 0, 0, 1];
  const B = mat3Mul(Kinv, H);
  const b1: Vec3 = [B[0], B[3], B[6]];
  const b2: Vec3 = [B[1], B[4], B[7]];
  const b3: Vec3 = [B[2], B[5], B[8]];
  let lambda = 2 / (norm(b1) + norm(b2));
  if (!Number.isFinite(lambda)) return null;
  if (b3[2] * lambda < 0) lambda = -lambda; // plane must be in front of the camera
  const r1 = normalize(scale(b1, lambda));
  let r2 = scale(b2, lambda);
  r2 = normalize(sub(r2, scale(r1, dot(r1, r2)))); // Gram–Schmidt
  const r3 = cross(r1, r2);
  const t = scale(b3, lambda);
  return { r1, r2, r3, t };
}

/**
 * Estimate the camera focal length (pixels) from a plane→image homography, assuming square
 * pixels and a principal point at (cx, cy). Uses both of Zhang's constraints (orthogonal,
 * equal-length rotation columns) in least squares. Only reliable when the plane is tilted
 * relative to the camera, so it also returns the tilt angle for weighting.
 */
export function focalFromHomography(H: Mat3, cx: number, cy: number): { f: number; tiltDeg: number } | null {
  const a1 = H[0] - cx * H[6];
  const b1 = H[3] - cy * H[6];
  const c1 = H[6];
  const a2 = H[1] - cx * H[7];
  const b2 = H[4] - cy * H[7];
  const c2 = H[7];
  const A1 = a1 * a2 + b1 * b2;
  const C1 = c1 * c2;
  const A2 = a1 * a1 + b1 * b1 - a2 * a2 - b2 * b2;
  const C2 = c1 * c1 - c2 * c2;
  const den = A1 * A1 + A2 * A2;
  if (!(den > 0)) return null;
  const u = -(A1 * C1 + A2 * C2) / den; // u = 1 / f²
  if (!(u > 0)) return null;
  const f = 1 / Math.sqrt(u);
  const pose = poseFromHomography(H, { f, cx, cy });
  if (!pose) return null;
  const tiltDeg = (Math.acos(Math.min(1, Math.abs(pose.r3[2]))) * 180) / Math.PI;
  return { f, tiltDeg };
}

export function planeToCamera(pose: Pose, x: number, y: number): Vec3 {
  return add(add(pose.t, scale(pose.r1, x)), scale(pose.r2, y));
}
