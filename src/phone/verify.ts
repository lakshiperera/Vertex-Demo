import { matchingModels, screenMismatch, type ScreenFacts } from '../shared/hardwareMatch';
import type { MarkerPayload } from '../shared/payload';
import type { ChassisTone, LaptopModel } from '../shared/types';
import { baseToCamera, lidToCamera, type LaptopFrame } from './laptopPose';
import { dot, normalize, project, scale, type Intrinsics, type Vec3 } from './math';

/**
 * "Is this really the selected laptop?" check, in two parts:
 *
 * 1. Screen (deterministic): the QR carries the marker page's size. Its aspect ratio
 *    (and its width, when the laptop page was card-calibrated) must match the model.
 *
 * 2. Body colour (heuristic): once the markers lock, sample the palm rest and express its
 *    brightness relative to the screen's own white page and the markers' black cells,
 *    t = (body − screenBlack) / (screenWhite − screenBlack). That cancels most of the
 *    camera's exposure changes, but room lighting and screen brightness still move it,
 *    so the default bands are wide and the user can confirm "it's correct" once, which
 *    stores the measured value for that model on this phone.
 *
 * Also measured (shown in debug only): contrast along the bottom-bezel logo line. All
 * three supported laptops carry a logo there, so it can't tell brands apart on its own.
 */

/** Default bands for t. They overlap on purpose: only clear contradictions are reported. */
export const TONE_BANDS: Record<ChassisTone, [number, number]> = {
  silver: [0.2, 3],
  grey: [0.05, 0.55],
  black: [-1, 0.18],
};
const LEARNED_SPREAD = 0.12;
const MIN_SAMPLES = 12;

export function payloadFacts(p: MarkerPayload): ScreenFacts | null {
  if (!p.w || !p.h) return null;
  return { aspect: p.w / p.h, widthMm: p.c ? p.w : null };
}

export interface Verdict {
  kind: 'screen' | 'chassis' | null;
  reason: string | null;
  /** Other models that fit what was observed. */
  suggestions: LaptopModel[];
  /** Median normalised body brightness, once enough samples exist. */
  tone: number | null;
  logoContrast: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

export function toneBand(model: LaptopModel, learned: number | null): [number, number] | null {
  if (learned !== null) return [learned - LEARNED_SPREAD, learned + LEARNED_SPREAD];
  return model.appearance ? TONE_BANDS[model.appearance.chassisTone] : null;
}

export class HardwareVerifier {
  private tones: number[] = [];
  private logos: number[] = [];

  reset() {
    this.tones = [];
    this.logos = [];
  }

  get sampleCount() {
    return this.tones.length;
  }

  get medianTone(): number | null {
    return this.tones.length >= MIN_SAMPLES ? median(this.tones) : null;
  }

  /**
   * Take one measurement from a tracked frame.
   * @param img processing image; `toSource` converts its pixels to source pixels (K's units)
   */
  sample(img: ImageData, toSource: number, K: Intrinsics, f: LaptopFrame, model: LaptopModel, p: MarkerPayload) {
    const app = model.appearance;
    if (!app) return;
    const lum = (pt: Vec3): number | null => {
      const q = project(pt, K);
      if (!q) return null;
      const x = Math.round(q[0] / toSource);
      const y = Math.round(q[1] / toSource);
      if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) return null;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((y + dy) * img.width + (x + dx)) * 4;
          sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        }
      return sum / 9;
    };
    const mean = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    // Display point (x right, y up from the display's bottom edge) → camera, using the screen pose.
    const hinge = model.display.hingeToDisplayBottomMm;
    const disp = (x: number, y: number) => lidToCamera(f, x, hinge + y);

    // References from the marker page itself: white quiet zone next to each marker, black border cells.
    const s = p.s;
    const cyMid = p.k.reduce((a, [, y]) => a + y, 0) / p.k.length;
    const whites: (number | null)[] = [];
    const blacks: (number | null)[] = [];
    for (const [cx, cy] of p.k) {
      const towardCentre = cy > cyMid ? -1 : 1;
      whites.push(lum(disp(cx, cy + towardCentre * (s / 2 + s * 0.15))));
      for (const [sx, sy] of [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ])
        blacks.push(lum(disp(cx + sx * (s / 2 - s / 16), cy + sy * (s / 2 - s / 16))));
    }
    const white = mean(whites);
    const black = mean(blacks);
    if (white === null || black === null || white - black < 40) return; // too little contrast to compare

    // Body: palm-rest points, only when the top surface faces the camera.
    const toCam = (pt: Vec3) => normalize(scale(pt, -1));
    const body: (number | null)[] = [];
    for (const { x, z } of app.chassisSamplesMm) {
      for (const [ox, oz] of [
        [0, 0],
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ]) {
        const pt = baseToCamera(f, x + ox, 0, z + oz);
        if (dot(f.Y, toCam(pt)) > 0.2) body.push(lum(pt));
      }
    }
    const b = mean(body);
    if (b === null) return;
    this.push(this.tones, (b - black) / (white - black));

    if (app.bezelLogo) {
      const L = app.bezelLogo;
      const line: (number | null)[] = [];
      for (let x = -L.widthMm / 2; x <= L.widthMm / 2; x += 1) line.push(lum(lidToCamera(f, L.xMm + x, L.vMm)));
      const v = line.filter((n): n is number => n !== null);
      if (v.length > L.widthMm * 0.6) this.push(this.logos, (Math.max(...v) - Math.min(...v)) / (white - black));
    }
  }

  private push(arr: number[], v: number) {
    if (!Number.isFinite(v)) return;
    arr.push(v);
    if (arr.length > 45) arr.shift();
  }

  verdict(model: LaptopModel, p: MarkerPayload, all: LaptopModel[], learned: (id: string) => number | null): Verdict {
    const others = all.filter((m) => m.id !== model.id);
    const tone = this.medianTone;
    const logoContrast = this.logos.length >= MIN_SAMPLES ? median(this.logos) : null;
    const facts = payloadFacts(p);

    if (facts) {
      const reason = screenMismatch(model, facts);
      if (reason) {
        let suggestions = matchingModels(others, facts);
        // Narrow down by body colour when that's known too.
        if (tone !== null && suggestions.length > 1) {
          const byTone = suggestions.filter((m) => {
            const band = toneBand(m, learned(m.id));
            return band && tone >= band[0] && tone <= band[1];
          });
          if (byTone.length) suggestions = byTone;
        }
        return { kind: 'screen', reason, suggestions, tone, logoContrast };
      }
    }

    const band = toneBand(model, learned(model.id));
    if (tone !== null && band && (tone < band[0] || tone > band[1]) && model.appearance) {
      // Say lighter/darker rather than naming a colour: lighting shifts the absolute value.
      const seen = tone > band[1] ? 'lighter' : 'darker';
      const suggestions = others.filter((m) => {
        const b = toneBand(m, learned(m.id));
        const fits = b && tone >= b[0] && tone <= b[1];
        return fits && (!facts || screenMismatch(m, facts) === null);
      });
      return {
        kind: 'chassis',
        reason: `The laptop body looks much ${seen} than the ${model.appearance.chassisTone} body of a ${model.displayName}.`,
        suggestions,
        tone,
        logoContrast,
      };
    }
    return { kind: null, reason: null, suggestions: [], tone, logoContrast };
  }
}
