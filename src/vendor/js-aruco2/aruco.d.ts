// Types for the vendored js-aruco2 v2.0.0 (MIT-style licence, see LICENSE.txt).
// Vendored because Vite 8 (Rolldown) can't bundle the package's `this.AR = AR` export style.

export interface ArucoCorner {
  x: number;
  y: number;
}

export interface ArucoMarker {
  id: number;
  /** Outer corners of the black border: top-left, top-right, bottom-right, bottom-left (marker's own frame). */
  corners: ArucoCorner[];
  hammingDistance: number;
}

export interface ArucoDetector {
  detectImage(width: number, height: number, data: Uint8ClampedArray): ArucoMarker[];
}

export interface ArucoDictionary {
  /** Bit strings, row-major from the top, '1' = white cell. */
  codeList: string[];
  /** Grid size including the black border (e.g. 8 for 36h12). */
  markSize: number;
}

export declare const AR: {
  Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => ArucoDetector;
  Dictionary: new (name: string) => ArucoDictionary;
};
