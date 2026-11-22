import jsQR from 'jsqr';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageData): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

/** QR decoding: native BarcodeDetector where available (Android Chrome), jsQR elsewhere (iPhone). */
export class QrScanner {
  private native: BarcodeDetectorLike | null = null;
  private busy = false;

  constructor() {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Ctor) {
      try {
        this.native = new Ctor({ formats: ['qr_code'] });
      } catch {
        this.native = null;
      }
    }
  }

  get isBusy() {
    return this.busy;
  }

  async scan(image: ImageData): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      if (this.native) {
        try {
          const found = await this.native.detect(image);
          if (found.length) return found[0].rawValue;
        } catch {
          this.native = null; // fall back to jsQR from now on
        }
      }
      const res = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      return res?.data ?? null;
    } finally {
      this.busy = false;
    }
  }
}
