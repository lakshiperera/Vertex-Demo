import type { LaptopModel, Port } from '../shared/types';
import { add, dot, normalize, project, scale, type Intrinsics, type Vec2, type Vec3 } from './math';
import { baseToCamera, lidToCamera, portToCamera, sideNormal, type LaptopFrame } from './laptopPose';
import { PointSmoother } from './smoothing';

export const PORT_ICONS: Record<string, string> = {
  'usb-c': 'C',
  'usb-a': 'A',
  hdmi: 'H',
  audio: '🎧',
  sd: 'SD',
  lock: '🔒',
  led: '💡',
  power: '⏻',
  camera: '📷',
};

/** Maps source-image pixels to CSS pixels for an element shown with object-fit: cover. */
export interface ViewMap {
  s: number;
  ox: number;
  oy: number;
}

export function coverMap(sw: number, sh: number, cw: number, ch: number): ViewMap {
  const s = Math.max(cw / sw, ch / sh);
  return { s, ox: (cw - sw * s) / 2, oy: (ch - sh * s) / 2 };
}

export interface OverlayState {
  frame: LaptopFrame | null;
  K: Intrinsics;
  view: ViewMap;
  opacity: number;
  showOutline: boolean;
  debugCorners: Vec2[][] | null;
  selectedId: string | null;
  now: number;
}

interface LabelBox {
  port: Port;
  el: HTMLButtonElement;
  anchor: Vec2;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEADER_PX = 64;

export class PortsOverlay {
  private ctx: CanvasRenderingContext2D;
  private labels = new Map<string, HTMLButtonElement>();
  private sizes = new Map<string, [number, number]>();
  private smoother = new PointSmoother();
  private model: LaptopModel | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private layer: HTMLElement,
    private onSelect: (port: Port) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  setModel(model: LaptopModel | null) {
    this.model = model;
    this.layer.replaceChildren();
    this.labels.clear();
    this.sizes.clear();
    if (!model) return;
    for (const port of model.ports) {
      const el = document.createElement('button');
      el.className = 'port-label';
      el.style.visibility = 'hidden';
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = PORT_ICONS[port.type] ?? '•';
      const text = document.createElement('span');
      text.textContent = port.label;
      el.append(icon, text);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelect(port);
      });
      this.layer.append(el);
      this.labels.set(port.id, el);
    }
  }

  resetSmoothing() {
    this.smoother.reset();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(st: OverlayState) {
    this.resize();
    const { ctx } = this;
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    ctx.clearRect(0, 0, cw, ch);

    const toScreen = (p: Vec3, key?: string): Vec2 | null => {
      const q = project(p, st.K);
      if (!q) return null;
      const x = q[0] * st.view.s + st.view.ox;
      const y = q[1] * st.view.s + st.view.oy;
      return key ? this.smoother.smooth(key, x, y, st.now) : [x, y];
    };

    if (st.debugCorners) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      for (const quad of st.debugCorners) {
        ctx.beginPath();
        quad.forEach(([x, y], i) => {
          const sx = x * st.view.s + st.view.ox;
          const sy = y * st.view.s + st.view.oy;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
        // Mark corner 0 (marker top-left) to check orientation.
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(quad[0][0] * st.view.s + st.view.ox - 3, quad[0][1] * st.view.s + st.view.oy - 3, 6, 6);
      }
    }

    const f = st.frame;
    if (!f || !this.model || st.opacity <= 0) {
      for (const el of this.labels.values()) el.style.visibility = 'hidden';
      return;
    }
    const model = this.model;
    ctx.globalAlpha = st.opacity;

    if (st.showOutline) this.drawOutline(f, model, toScreen);

    // Ports: anchor, visibility and label placement
    const boxes: LabelBox[] = [];
    for (const port of model.ports) {
      const el = this.labels.get(port.id)!;
      const p = portToCamera(f, port);
      const n = sideNormal(f, port.side);
      const toCam = normalize(scale(p, -1));
      const facing = dot(n, toCam);
      const a = facing > 0.06 ? toScreen(p, `a:${port.id}`) : null;
      const b = a ? toScreen(add(p, scale(n, 40)), `b:${port.id}`) : null;
      if (!a || !b || a[0] < -20 || a[0] > cw + 20 || a[1] < -20 || a[1] > ch + 20) {
        el.style.visibility = 'hidden';
        continue;
      }
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) {
        dx = 0;
        dy = -1;
      } else {
        dx /= len;
        dy /= len;
      }
      let size = this.sizes.get(port.id);
      if (!size) {
        size = [el.offsetWidth || 120, el.offsetHeight || 32];
        this.sizes.set(port.id, size);
      }
      const [w, h] = size;
      const tx = a[0] + dx * LEADER_PX;
      const ty = a[1] + dy * LEADER_PX;
      let x: number;
      let y: number;
      if (Math.abs(dx) >= Math.abs(dy)) {
        x = dx < 0 ? tx - w : tx;
        y = ty - h / 2;
      } else {
        x = tx - w / 2;
        y = dy < 0 ? ty - h : ty;
      }
      boxes.push({ port, el, anchor: a, x, y, w, h });
    }

    this.resolveOverlaps(boxes, cw, ch);

    const pulse = 0.5 + 0.5 * Math.sin(st.now / 300);
    for (const bx of boxes) {
      const selected = bx.port.id === st.selectedId;
      // Leader line to the nearest point on the label
      const lx = Math.min(Math.max(bx.anchor[0], bx.x), bx.x + bx.w);
      const ly = Math.min(Math.max(bx.anchor[1], bx.y), bx.y + bx.h);
      ctx.strokeStyle = selected ? '#22d3ee' : 'rgba(34,211,238,0.85)';
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(bx.anchor[0], bx.anchor[1]);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      // Hotspot
      ctx.beginPath();
      ctx.arc(bx.anchor[0], bx.anchor[1], (selected ? 11 : 8) + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34,211,238,${0.35 + 0.4 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx.anchor[0], bx.anchor[1], selected ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#22d3ee';
      ctx.fill();

      bx.el.style.visibility = 'visible';
      bx.el.style.opacity = String(st.opacity);
      bx.el.style.transform = `translate(${Math.round(bx.x)}px, ${Math.round(bx.y)}px)`;
      bx.el.classList.toggle('selected', selected);
    }
    ctx.globalAlpha = 1;
  }

  private drawOutline(f: LaptopFrame, model: LaptopModel, toScreen: (p: Vec3, key?: string) => Vec2 | null) {
    const { ctx } = this;
    const { widthMm: bw, depthMm: bd, thicknessMm: bt } = model.base;
    const xs = [-bw / 2, bw / 2];
    const ys = [0, -bt];
    const zs = [0, bd];
    const pts: (Vec2 | null)[] = [];
    let i = 0;
    for (const x of xs) for (const y of ys) for (const z of zs) pts.push(toScreen(baseToCamera(f, x, y, z), `o${i++}`));
    // Index = xi*4 + yi*2 + zi
    const edges = [
      [0, 1], [2, 3], [4, 5], [6, 7], // along z
      [0, 4], [1, 5], [2, 6], [3, 7], // along x
      [0, 2], [1, 3], [4, 6], [5, 7], // along y
    ];
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    for (const [a, b] of edges) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Hinge line (where the screen meets the base)
    const h0 = toScreen(baseToCamera(f, -bw / 2, 0, 0), 'h0');
    const h1 = toScreen(baseToCamera(f, bw / 2, 0, 0), 'h1');
    if (h0 && h1) {
      ctx.strokeStyle = 'rgba(250,204,21,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(h0[0], h0[1]);
      ctx.lineTo(h1[0], h1[1]);
      ctx.stroke();
    }

    // Display outline (shows how well the marker pose fits the screen)
    const { widthMm: dw, heightMm: dh, hingeToDisplayBottomMm: hinge } = model.display;
    const d = [
      [-dw / 2, hinge],
      [dw / 2, hinge],
      [dw / 2, hinge + dh],
      [-dw / 2, hinge + dh],
    ].map(([x, v], k) => toScreen(lidToCamera(f, x, v), `d${k}`));
    if (d.every(Boolean)) {
      ctx.strokeStyle = 'rgba(34,211,238,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      d.forEach((p, k) => (k === 0 ? ctx.moveTo(p![0], p![1]) : ctx.lineTo(p![0], p![1])));
      ctx.closePath();
      ctx.stroke();
    }
  }

  /** Push overlapping labels apart vertically, then keep them on screen. */
  private resolveOverlaps(boxes: LabelBox[], cw: number, ch: number) {
    const pad = 4;
    for (let iter = 0; iter < 12; iter++) {
      let moved = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + pad;
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + pad;
          if (ox > 0 && oy > 0) {
            const push = oy / 2;
            if (a.y + a.h / 2 <= b.y + b.h / 2) {
              a.y -= push;
              b.y += push;
            } else {
              a.y += push;
              b.y -= push;
            }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    for (const b of boxes) {
      b.x = Math.min(Math.max(8, b.x), cw - b.w - 8);
      b.y = Math.min(Math.max(64, b.y), ch - b.h - 8);
    }
  }
}
