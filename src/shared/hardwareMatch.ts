import type { LaptopModel } from './types';

/** What we know about the real screen the marker page is shown on. */
export interface ScreenFacts {
  /** Width ÷ height of the full screen. */
  aspect: number;
  /** Physical width in mm, only when it was measured (card calibration). Otherwise null. */
  widthMm: number | null;
}

/** Aspect ratios differing by more than this are different screens (16:10 = 1.6 vs 16:9 = 1.78 is 11%). */
export const ASPECT_TOLERANCE = 0.05;
/** Calibrated physical widths differing by more than this (mm) are different screens. */
export const WIDTH_TOLERANCE_MM = 15;

const ratioLabel = (a: number) => (Math.abs(a - 16 / 10) < 0.03 ? '16:10' : Math.abs(a - 16 / 9) < 0.03 ? '16:9' : a.toFixed(2));

/** Why the screen doesn't match the model, or null when it's consistent. */
export function screenMismatch(model: LaptopModel, facts: ScreenFacts): string | null {
  const modelAspect = model.display.widthMm / model.display.heightMm;
  if (Math.abs(facts.aspect / modelAspect - 1) > ASPECT_TOLERANCE) {
    return `Screen shape is ${ratioLabel(facts.aspect)}, but ${model.displayName} has a ${ratioLabel(modelAspect)} screen.`;
  }
  if (facts.widthMm !== null && Math.abs(facts.widthMm - model.display.widthMm) > WIDTH_TOLERANCE_MM) {
    return `Screen is ${Math.round(facts.widthMm)} mm wide, but ${model.displayName}'s is ${Math.round(model.display.widthMm)} mm.`;
  }
  return null;
}

/** Models whose screen matches these facts. */
export function matchingModels(models: LaptopModel[], facts: ScreenFacts): LaptopModel[] {
  return models.filter((m) => screenMismatch(m, facts) === null);
}
