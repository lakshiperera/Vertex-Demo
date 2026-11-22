import type { Vec3 } from './math';

/** Something that provides camera frames: the real camera or the demo simulator. */
export interface FrameSource {
  readonly kind: 'camera' | 'demo';
  /** Element shown full screen behind the overlay. */
  readonly element: HTMLVideoElement | HTMLCanvasElement;
  /** Source image size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Known field of view (demo only); otherwise the user setting is used. */
  readonly fovDeg?: number;
  /** Processing image plus the factor that converts its pixels to source pixels. */
  grab(): { image: ImageData; toSource: number } | null;
  /** Exact gravity (demo only). */
  gravityUp?(): Vec3 | null;
  stop(): void;
}

const MAX_PROCESSING_SIDE = 800;

export class CameraSource implements FrameSource {
  readonly kind = 'camera' as const;
  private work = document.createElement('canvas');
  private ctx = this.work.getContext('2d', { willReadFrequently: true })!;

  private constructor(
    readonly element: HTMLVideoElement,
    private stream: MediaStream,
  ) {}

  static async start(video: HTMLVideoElement): Promise<CameraSource> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot open the camera. Use Chrome on Android or Safari on iPhone, over HTTPS.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    return new CameraSource(video, stream);
  }

  get width() {
    return this.element.videoWidth;
  }

  get height() {
    return this.element.videoHeight;
  }

  grab() {
    const sw = this.width;
    const sh = this.height;
    if (!sw || !sh) return null;
    const s = Math.min(1, MAX_PROCESSING_SIDE / Math.max(sw, sh));
    const pw = Math.round(sw * s);
    const ph = Math.round(sh * s);
    if (this.work.width !== pw || this.work.height !== ph) {
      this.work.width = pw;
      this.work.height = ph;
    }
    this.ctx.drawImage(this.element, 0, 0, pw, ph);
    return { image: this.ctx.getImageData(0, 0, pw, ph), toSource: sw / pw };
  }

  stop() {
    for (const t of this.stream.getTracks()) t.stop();
  }
}
