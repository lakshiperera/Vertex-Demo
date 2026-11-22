import QRCode from 'qrcode';
import { computeMarkerLayout, renderMarkerPage } from '../shared/markers';
import { encodePayloadUrl, type MarkerPayload } from '../shared/payload';
import type { LaptopModel, Port } from '../shared/types';
import {
  add,
  applyH,
  cross,
  dot,
  intrinsicsFromFov,
  mat3Inv,
  mat3Mul,
  normalize,
  scale,
  sub,
  type Intrinsics,
  type Mat3,
  type Vec3,
} from './math';
import type { FrameSource } from './sources';

const PAGE_PPM = 4; // texture pixels per mm for the simulated screen

/** Port slot sizes (width × height, mm) for drawing the simulated laptop. */
const SLOT: Record<string, [number, number]> = {
  'usb-c': [9, 3.5],
  'usb-a': [13, 5.5],
  hdmi: [15, 5.5],
  audio: [4, 4],
  sd: [12, 1.6],
  lock: [7, 3.5],
  led: [3, 3],
  power: [14, 9],
  rj45: [14, 11],
  vga: [17, 7],
  'power-in': [10, 6],
  smartcard: [56, 2],
  sim: [12, 1.6],
  switch: [8, 3],
  fingerprint: [12, 12],
};

/**
 * Simulated camera orbiting a virtual laptop that shows the real marker page.
 * Lets you try the full pipeline (QR → markers → pose → base frame → labels)
 * on a desktop browser without a phone.
 */
export class DemoSource implements FrameSource {
  readonly kind = 'demo' as const;
  readonly width = 960;
  readonly height = 720;
  /** The simulated camera's true FOV. The app is not told this; it must calibrate it. */
  readonly trueFovDeg = 60;
  readonly lidDeg = 110;
  readonly payload: MarkerPayload;

  private ctx: CanvasRenderingContext2D;
  private K: Intrinsics;
  private page!: ImageData;
  private up: Vec3 = [0, -1, 0];
  private start = performance.now();

  private constructor(
    readonly element: HTMLCanvasElement,
    private model: LaptopModel,
  ) {
    element.width = this.width;
    element.height = this.height;
    this.ctx = element.getContext('2d', { willReadFrequently: true })!;
    this.K = intrinsicsFromFov(this.width, this.height, this.trueFovDeg);
    const layout = computeMarkerLayout(model.display.widthMm, model.display.heightMm);
    this.payload = { v: 1, m: model.id, s: layout.markerSizeMm, k: layout.centers };
  }

  static async create(canvas: HTMLCanvasElement, model: LaptopModel): Promise<DemoSource> {
    const demo = new DemoSource(canvas, model);
    await demo.buildPage();
    return demo;
  }

  private async buildPage() {
    const w = Math.round(this.model.display.widthMm * PAGE_PPM);
    const h = Math.round(this.model.display.heightMm * PAGE_PPM);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const url = encodePayloadUrl(new URL('phone.html', location.href).toString(), this.payload);
    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, url, { width: Math.round(Math.min(h * 0.5, w * 0.32)), margin: 2, errorCorrectionLevel: 'M' });
    const ctx = c.getContext('2d')!;
    renderMarkerPage(ctx, w, h, PAGE_PPM, this.payload, qr, 'Scan with your phone camera');
    this.page = ctx.getImageData(0, 0, w, h);
  }

  gravityUp() {
    return this.up;
  }

  stop() {}

  grab() {
    this.render((performance.now() - this.start) / 1000);
    return { image: this.ctx.getImageData(0, 0, this.width, this.height), toSource: 1 };
  }

  private render(t: number) {
    const { ctx, K, model } = this;
    const { widthMm: bw, depthMm: bd, thicknessMm: bt } = model.base;
    const { widthMm: dw, heightMm: dh, hingeToDisplayBottomMm: hinge } = model.display;

    // Camera orbits in front of the laptop so you see the left side, front and right side.
    const yaw = 0.8 * Math.sin(t * 0.35);
    const el = 0.4 + 0.08 * Math.sin(t * 0.23);
    const sizeScale = bw / 314; // bigger laptops: camera further away
    const r = (600 + 50 * Math.sin(t * 0.17)) * sizeScale;
    const target: Vec3 = [0, 50, 80 * sizeScale];
    const C = add(target, [r * Math.sin(yaw) * Math.cos(el), r * Math.sin(el), r * Math.cos(yaw) * Math.cos(el)]);
    const fwd = normalize(sub(target, C));
    const right = normalize(cross(fwd, [0, 1, 0]));
    const down = cross(fwd, right);
    const dirToCam = (d: Vec3): Vec3 => [dot(right, d), dot(down, d), dot(fwd, d)];
    const toCam = (p: Vec3): Vec3 => dirToCam(sub(p, C));
    const proj = (p: Vec3): [number, number] => {
      const c = toCam(p);
      return [K.f * (c[0] / c[2]) + K.cx, K.f * (c[1] / c[2]) + K.cy];
    };
    this.up = dirToCam([0, 1, 0]);

    // Desk
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, '#3f3a36');
    g.addColorStop(1, '#2a2522');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);

    const poly = (pts: Vec3[], fill: string, stroke?: string) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = proj(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    const facing = (n: Vec3, center: Vec3) => dot(n, sub(C, center)) > 0;

    // Base box spans z = zb (back edge) … zf (front edge); the hinge is at z = 0.
    const zb = -(model.base.hingeFromBackMm ?? 0);
    const zf = zb + bd;

    // Shadow under the laptop
    poly(
      [
        [-bw / 2 - 6, -bt, zb - 4],
        [bw / 2 + 6, -bt, zb - 4],
        [bw / 2 + 10, -bt, zf + 8],
        [-bw / 2 - 10, -bt, zf + 8],
      ],
      'rgba(0,0,0,0.35)',
    );

    // Base box (convex: drawing only the faces that face the camera is enough)
    const x0 = -bw / 2;
    const x1 = bw / 2;
    const faces: { n: Vec3; pts: Vec3[]; fill: string }[] = [
      { n: [0, 0, 1], pts: [[x0, 0, zf], [x1, 0, zf], [x1, -bt, zf], [x0, -bt, zf]], fill: '#7c818a' },
      { n: [0, 0, -1], pts: [[x1, 0, zb], [x0, 0, zb], [x0, -bt, zb], [x1, -bt, zb]], fill: '#6b7079' },
      { n: [-1, 0, 0], pts: [[x0, 0, zb], [x0, 0, zf], [x0, -bt, zf], [x0, -bt, zb]], fill: '#6b7079' },
      { n: [1, 0, 0], pts: [[x1, 0, zb], [x1, 0, zf], [x1, -bt, zf], [x1, -bt, zb]], fill: '#6b7079' },
      { n: [0, 1, 0], pts: [[x0, 0, zb], [x1, 0, zb], [x1, 0, zf], [x0, 0, zf]], fill: '#a3a8b0' },
    ];
    for (const f of faces) {
      const center = scale(f.pts.reduce((a, b) => add(a, b)), 0.25);
      if (facing(f.n, center)) poly(f.pts, f.fill, 'rgba(0,0,0,0.25)');
    }
    // Keyboard, and the touchpad where the model says it is
    const kw = Math.min(bw - 40, 300) / 2;
    poly([[-kw, 0, 22], [kw, 0, 22], [kw, 0, 122], [-kw, 0, 122]], '#2b2f36');
    const tp = model.ports.find((p) => p.type === 'touchpad')?.positionMm ?? { x: 0, y: 0, z: zf - 50 };
    poly(
      [
        [tp.x - 58, 0, tp.z - 36],
        [tp.x + 58, 0, tp.z - 36],
        [tp.x + 58, 0, tp.z + 36],
        [tp.x - 58, 0, tp.z + 36],
      ],
      '#959aa3',
      'rgba(0,0,0,0.2)',
    );

    // Port slots
    for (const p of model.ports) this.drawSlot(p, poly, facing);

    // Lid (bezel), leaning back by the lid angle
    const th = (this.lidDeg * Math.PI) / 180;
    const u: Vec3 = [0, Math.sin(th), Math.cos(th)];
    const n: Vec3 = [0, -Math.cos(th), Math.sin(th)];
    const lidTop = hinge + dh + 10;
    const L = (x: number, v: number): Vec3 => add([x, 0, 0], scale(u, v));
    const back = scale(n, -6);
    poly([add(L(x0 + 1, 0), back), add(L(x1 - 1, 0), back), add(L(x1 - 1, lidTop), back), add(L(x0 + 1, lidTop), back)], '#5b6068');
    poly([L(x0 + 1, 0), L(x1 - 1, 0), L(x1 - 1, lidTop), L(x0 + 1, lidTop)], '#15171b');

    // Screen: texture-map the marker page with the exact plane → image homography.
    const r1 = dirToCam([1, 0, 0]);
    const r2 = dirToCam(u);
    const tt = toCam(L(0, hinge));
    const Kmat: Mat3 = [K.f, 0, K.cx, 0, K.f, K.cy, 0, 0, 1];
    const H = mat3Mul(Kmat, [r1[0], r2[0], tt[0], r1[1], r2[1], tt[1], r1[2], r2[2], tt[2]]);
    const Hinv = mat3Inv(H);
    if (!Hinv) return;
    const corners = [
      [-dw / 2, 0],
      [dw / 2, 0],
      [dw / 2, dh],
      [-dw / 2, dh],
    ].map(([x, y]) => applyH(H, x, y));
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    if (maxX <= minX || maxY <= minY) return;
    const bwPx = maxX - minX + 1;
    const bhPx = maxY - minY + 1;
    const out = ctx.getImageData(minX, minY, bwPx, bhPx);
    const pg = this.page;
    for (let y = 0; y < bhPx; y++) {
      for (let x = 0; x < bwPx; x++) {
        const [sx, sy] = applyH(Hinv, minX + x + 0.5, minY + y + 0.5);
        if (sx < -dw / 2 || sx > dw / 2 || sy < 0 || sy > dh) continue;
        const tx = Math.min(pg.width - 1, Math.floor((sx + dw / 2) * PAGE_PPM));
        const ty = Math.min(pg.height - 1, Math.floor((dh - sy) * PAGE_PPM));
        const si = (ty * pg.width + tx) * 4;
        const di = (y * bwPx + x) * 4;
        // Slight dimming so the screen doesn't look perfectly flat-white.
        out.data[di] = pg.data[si] * 0.94;
        out.data[di + 1] = pg.data[si + 1] * 0.95;
        out.data[di + 2] = pg.data[si + 2] * 0.97;
        out.data[di + 3] = 255;
      }
    }
    ctx.putImageData(out, minX, minY);
  }

  private drawSlot(
    p: Port,
    poly: (pts: Vec3[], fill: string, stroke?: string) => void,
    facing: (n: Vec3, c: Vec3) => boolean,
  ) {
    const size = SLOT[p.type];
    if (!size || p.side === 'lid') return;
    const [w, h] = size;
    const { x, y, z } = p.positionMm;
    const c: Vec3 = [x, y, z];
    const fill = p.type === 'led' ? '#f5f5f4' : p.type === 'power' || p.type === 'fingerprint' ? '#3a3f47' : '#111316';
    let pts: Vec3[];
    let nrm: Vec3;
    switch (p.side) {
      case 'left':
      case 'right': {
        const sx = p.side === 'left' ? x - 0.2 : x + 0.2;
        nrm = [p.side === 'left' ? -1 : 1, 0, 0];
        pts = [[sx, y + h / 2, z - w / 2], [sx, y + h / 2, z + w / 2], [sx, y - h / 2, z + w / 2], [sx, y - h / 2, z - w / 2]];
        break;
      }
      case 'front':
      case 'back': {
        const sz = p.side === 'front' ? z + 0.2 : z - 0.2;
        nrm = [0, 0, p.side === 'front' ? 1 : -1];
        pts = [[x - w / 2, y + h / 2, sz], [x + w / 2, y + h / 2, sz], [x + w / 2, y - h / 2, sz], [x - w / 2, y - h / 2, sz]];
        break;
      }
      case 'top': {
        nrm = [0, 1, 0];
        pts = [[x - w / 2, 0.2, z - h / 2], [x + w / 2, 0.2, z - h / 2], [x + w / 2, 0.2, z + h / 2], [x - w / 2, 0.2, z + h / 2]];
        break;
      }
    }
    if (facing(nrm, c)) poly(pts, fill);
  }
}
