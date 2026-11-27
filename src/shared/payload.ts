/**
 * Data carried by the QR code on the laptop screen.
 * The QR holds a full URL (phone.html?d=...) so a phone's normal camera app can open
 * the web app directly; the in-app scanner reads the same `d` parameter.
 */
export interface MarkerPayload {
  v: 1;
  /** Laptop model id (matches public/models/<id>.json). */
  m: string;
  /** Marker size in mm (outer black square). */
  s: number;
  /**
   * Marker centres in mm for ids 0..3 (TL, TR, BR, BL), in display coordinates:
   * origin = bottom-centre of the lit display area, x = right, y = up.
   */
  k: [number, number][];
  /**
   * First marker id: the page shows ids i…i+3 (TL, TR, BR, BL). A fresh random value
   * for every rendered page lets the phone tell screens apart: markers with other ids
   * belong to a different laptop (or an older layout), so it re-reads the QR.
   * Omitted = 0.
   */
  i?: number;
  /** Size of the marker page (full-screen viewport) in mm, same units as `k`. */
  w?: number;
  h?: number;
  /**
   * 1 = the laptop page's px/mm came from a credit-card calibration (true physical size).
   * 0 = estimated from the selected model's display width, so absolute sizes are only
   * right if the selected model is the real laptop.
   */
  c?: 0 | 1;
}

/** Highest allowed first id (ARUCO_MIP_36h12 has 250 markers: ids 0…249). */
export const MAX_BASE_ID = 244;

export function markerIdsOf(p: MarkerPayload): number[] {
  const i = p.i ?? 0;
  return [i, i + 1, i + 2, i + 3];
}

/** Two payloads describe the same marker page. */
export function samePayload(a: MarkerPayload | null, b: MarkerPayload | null): boolean {
  if (!a || !b) return a === b;
  return a.m === b.m && a.s === b.s && (a.i ?? 0) === (b.i ?? 0) && JSON.stringify(a.k) === JSON.stringify(b.k);
}

const MODEL_ID_RE = /^[a-z0-9-]{1,64}$/;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function encodePayloadUrl(phonePageUrl: string, p: MarkerPayload): string {
  const compact: MarkerPayload = { v: 1, m: p.m, s: round1(p.s), k: p.k.map(([x, y]) => [round1(x), round1(y)]) };
  if (p.i) compact.i = p.i;
  if (p.w && p.h) {
    compact.w = round1(p.w);
    compact.h = round1(p.h);
  }
  if (p.c) compact.c = 1;
  const url = new URL(phonePageUrl);
  url.searchParams.set('d', toBase64Url(JSON.stringify(compact)));
  return url.toString();
}

/** Validate untrusted input (it comes from a scanned QR or the page URL). */
export function validatePayload(obj: unknown): MarkerPayload | null {
  if (!obj || typeof obj !== 'object') return null;
  const p = obj as Record<string, unknown>;
  if (p.v !== 1 || typeof p.m !== 'string' || !MODEL_ID_RE.test(p.m)) return null;
  if (typeof p.s !== 'number' || !(p.s >= 5 && p.s <= 300)) return null;
  if (!Array.isArray(p.k) || p.k.length !== 4) return null;
  for (const c of p.k) {
    if (!Array.isArray(c) || c.length !== 2 || !c.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  }
  let i = 0;
  if (p.i !== undefined) {
    if (typeof p.i !== 'number' || !Number.isInteger(p.i) || p.i < 0 || p.i > MAX_BASE_ID) return null;
    i = p.i;
  }
  const out: MarkerPayload = { v: 1, m: p.m, s: p.s, k: p.k as [number, number][], i };
  const okSize = (n: unknown) => typeof n === 'number' && n > 10 && n < 2000;
  if (okSize(p.w) && okSize(p.h)) {
    out.w = p.w as number;
    out.h = p.h as number;
  }
  if (p.c === 1) out.c = 1;
  return out;
}

/** Accepts a full URL with `d=`, or the raw `d` value. */
export function decodePayloadText(text: string): MarkerPayload | null {
  let d: string | null;
  try {
    d = new URL(text).searchParams.get('d');
  } catch {
    d = text.trim();
  }
  if (!d || d.length > 2000) return null;
  try {
    return validatePayload(JSON.parse(fromBase64Url(d)));
  } catch {
    return null;
  }
}
