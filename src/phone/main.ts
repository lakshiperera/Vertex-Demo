import { fetchModel, fetchModelIndex } from '../shared/models';
import { decodePayloadText, type MarkerPayload } from '../shared/payload';
import type { LaptopModel, Port } from '../shared/types';
import { DemoSource } from './demo';
import { FocalEstimator, fovFromFocal } from './focal';
import { GravitySensor } from './gravity';
import { computeLaptopFrame, type LaptopFrame } from './laptopPose';
import { intrinsicsFromFov, type Intrinsics, type Mat3, type Vec2 } from './math';
import { coverMap, PORT_ICONS, PortsOverlay } from './overlay';
import { QrScanner } from './qr';
import { CameraSource, type FrameSource } from './sources';
import { MarkerTracker } from './tracker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Settings (remembered per browser) ----------
interface Settings {
  fov: number;
  autoFov: boolean;
  lidDeg: number;
  useGravity: boolean;
  showOutline: boolean;
  debug: boolean;
}
const DEFAULTS: Settings = { fov: 64, autoFov: true, lidDeg: 110, useGravity: true, showOutline: true, debug: false };
function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('arSettings') ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try {
    localStorage.setItem('arSettings', JSON.stringify(settings));
  } catch {
    /* storage blocked: settings just won't persist */
  }
}
const settings = loadSettings();

// ---------- State ----------
const params = new URLSearchParams(location.search);
const isDemo = params.get('demo') === '1';
let payload: MarkerPayload | null = params.get('d') ? decodePayloadText(location.href) : null;
let model: LaptopModel | null = null;
let modelLoading = false;
let source: FrameSource | null = null;
let frozen = false;
let frameNo = 0;
let lastFrame: LaptopFrame | null = null;
let lastK: Intrinsics | null = null;
let lastSeen = -Infinity;
let markerCount = 0;
let debugCorners: Vec2[][] | null = null;
let selected: Port | null = null;
let demoStart = 0;

const tracker = new MarkerTracker();
const qr = new QrScanner();
const gravity = new GravitySensor();
const focal = new FocalEstimator();
let focalSize = '';
let lastFovSave = 0;

/** Intrinsics for this frame: learned focal length when auto-FOV is on and ready, else the FOV setting. */
function intrinsicsFor(H: Mat3 | null, markerCount: number, w: number, h: number): Intrinsics {
  const size = `${w}x${h}`;
  if (size !== focalSize) {
    focal.reset(); // the estimate is specific to one camera resolution
    focalSize = size;
  }
  if (H) focal.add(H, w, h, markerCount);
  const f = settings.autoFov ? focal.focal() : null;
  if (f) {
    const now = performance.now();
    if (now - lastFovSave > 2000) {
      // Remember it, so the next session starts close to the right value.
      lastFovSave = now;
      settings.fov = Math.round(fovFromFocal(f, w, h));
      saveSettings();
      updateFovLabel();
    }
    return { f, cx: w / 2, cy: h / 2 };
  }
  return intrinsicsFromFov(w, h, settings.fov);
}

// ---------- Optional parts (fingerprint reader, smart card…) per laptop model ----------
function optionalKey(modelId: string) {
  return `optional:${modelId}`;
}
function loadOptional(modelId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(optionalKey(modelId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveOptional(modelId: string, ids: string[]) {
  try {
    localStorage.setItem(optionalKey(modelId), JSON.stringify(ids));
  } catch {
    /* storage blocked */
  }
}
function renderOptionalSettings(m: LaptopModel | null) {
  const box = $('optionalParts');
  const list = $('optionalList');
  const optional = m?.ports.filter((p) => p.optional) ?? [];
  box.classList.toggle('hidden', optional.length === 0);
  if (!m || optional.length === 0) {
    list.replaceChildren();
    return;
  }
  const enabled = new Set(loadOptional(m.id));
  overlay.setEnabledOptional(enabled);
  list.replaceChildren(
    ...optional.map((p) => {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled.has(p.id);
      input.addEventListener('change', () => {
        if (input.checked) enabled.add(p.id);
        else enabled.delete(p.id);
        saveOptional(m.id, [...enabled]);
        overlay.setEnabledOptional(enabled);
      });
      label.append(input, document.createTextNode(` ${p.label}`));
      return label;
    }),
  );
}

const video = $<HTMLVideoElement>('video');
const demoCanvas = $<HTMLCanvasElement>('demo');
const freezeCanvas = $<HTMLCanvasElement>('freeze');
const statusDot = $('statusDot');
const statusText = $('statusText');
const infoSheet = $('infoSheet');
const settingsSheet = $('settingsSheet');

const overlay = new PortsOverlay($<HTMLCanvasElement>('overlay'), $('labels'), (port) => openInfo(port));

// ---------- UI helpers ----------
function setStatus(text: string, kind: 'ok' | 'warn' | 'idle') {
  if (statusText.textContent !== text) statusText.textContent = text;
  statusDot.className = `dot ${kind === 'idle' ? '' : kind}`;
}

function openInfo(port: Port) {
  selected = port;
  $('infoIcon').textContent = PORT_ICONS[port.type] ?? '•';
  $('infoTitle').textContent = port.label;
  $('infoText').textContent = port.info;
  const specs = $('infoSpecs');
  specs.replaceChildren(
    ...(port.specs ?? []).map((s) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = s;
      return c;
    }),
  );
  const tips = $('infoTips');
  tips.replaceChildren(
    ...(port.tips ?? []).map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  settingsSheet.classList.remove('open');
  infoSheet.classList.add('open');
}

function closeSheets() {
  selected = null;
  infoSheet.classList.remove('open');
  settingsSheet.classList.remove('open');
}

async function ensureModel() {
  if (!payload || model || modelLoading) return;
  modelLoading = true;
  try {
    model = await fetchModel(payload.m);
    overlay.setModel(model);
    renderOptionalSettings(model);
    if (!localStorageHasLid()) settings.lidDeg = model.defaultLidAngleDeg;
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'warn');
    payload = null;
  } finally {
    modelLoading = false;
  }
}

function localStorageHasLid() {
  try {
    return 'lidDeg' in JSON.parse(localStorage.getItem('arSettings') ?? '{}');
  } catch {
    return false;
  }
}

function setPayload(p: MarkerPayload) {
  if (payload && payload.m === p.m && JSON.stringify(payload.k) === JSON.stringify(p.k)) return;
  payload = p;
  if (model && model.id !== p.m) {
    model = null;
    overlay.setModel(null);
  }
  void ensureModel();
}

async function tryQr(image: ImageData) {
  const text = await qr.scan(image);
  if (!text) return;
  const p = decodePayloadText(text);
  if (p) setPayload(p);
}

// ---------- Main loop ----------
function tick(now: number) {
  requestAnimationFrame(tick);
  if (!source || !source.width) return;
  frameNo++;

  if (!frozen) {
    const grabbed = source.grab();
    if (!grabbed) return;
    if (!payload && !qr.isBusy && frameNo % 3 === 0) void tryQr(grabbed.image);
    // Demo fallback: if the simulated QR is too small to decode, load the payload directly.
    if (!payload && source instanceof DemoSource && now - demoStart > 4000) setPayload(source.payload);

    if (payload && model) {
      const w = source.width;
      const h = source.height;
      let K: Intrinsics = intrinsicsFromFov(w, h, settings.fov);
      const markers = tracker.detect(grabbed.image);
      const res = tracker.estimate(markers, payload, grabbed.toSource, (H, n) => (K = intrinsicsFor(H, n, w, h)));
      debugCorners = settings.debug ? res?.corners ?? markers.map((m) => m.corners.map((c) => [c.x * grabbed.toSource, c.y * grabbed.toSource] as Vec2)) : null;
      if (res) {
        const up = settings.useGravity ? (source.gravityUp?.() ?? gravity.getUp()) : null;
        lastFrame = computeLaptopFrame(res.pose, model, up, settings.lidDeg);
        lastK = K;
        lastSeen = now;
        markerCount = res.markerIds.length;
      }
    }
  }

  // Keep labels briefly when tracking drops (e.g. the screen leaves the view), then fade out.
  let opacity = 0;
  if (lastFrame) {
    const age = now - lastSeen;
    opacity = frozen ? 1 : age < 900 ? 1 : Math.max(0, 1 - (age - 900) / 400);
    if (opacity === 0) {
      lastFrame = null;
      overlay.resetSmoothing();
    }
  }

  const view = coverMap(source.width, source.height, window.innerWidth, window.innerHeight);
  overlay.render({
    frame: lastFrame,
    K: lastK ?? intrinsicsFromFov(source.width, source.height, settings.fov),
    view,
    opacity,
    showOutline: settings.showOutline,
    debugCorners,
    selectedId: selected?.id ?? null,
    now,
  });

  updateStatus(now);
}

function updateStatus(now: number) {
  if (frozen) return setStatus('Frozen · tap a label for details', 'ok');
  if (!payload) return setStatus('Point at the QR code on the laptop screen', 'warn');
  if (!model) return setStatus('Loading laptop model…', 'idle');
  if (lastFrame && now - lastSeen < 300) {
    const lid = Math.round(lastFrame.lidAngleDeg);
    const lidText = lastFrame.usedGravity ? `lid ${lid}°` : `lid ${lid}° (assumed)`;
    return setStatus(`Tracking · ${markerCount}/4 markers · ${lidText}`, 'ok');
  }
  if (lastFrame) return setStatus('Holding · bring the screen back into view', 'warn');
  return setStatus(`${model.displayName} · looking for the screen markers`, 'warn');
}

// ---------- Start ----------
async function start() {
  const startBtn = $<HTMLButtonElement>('startBtn');
  const err = $('startError');
  startBtn.disabled = true;
  err.classList.add('hidden');
  try {
    if (isDemo) {
      // Demo laptop: ?model=<id>, else the first model in the list.
      const wanted = params.get('model');
      const index = await fetchModelIndex();
      const id = index.find((e) => e.id === wanted)?.id ?? index[0].id;
      const m = await fetchModel(id);
      const demo = await DemoSource.create(demoCanvas, m);
      video.classList.add('hidden');
      demoCanvas.classList.remove('hidden');
      source = demo;
      demoStart = performance.now();
    } else {
      // Ask for motion permission inside the tap (required on iPhone), in parallel with the camera.
      const [motionOk, cam] = await Promise.all([GravitySensor.requestPermission(), CameraSource.start(video)]);
      if (motionOk) gravity.start();
      source = cam;
    }
    $('start').classList.add('hidden');
    void ensureModel();
    requestAnimationFrame(tick);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err.textContent =
      msg.includes('Permission') || msg.includes('NotAllowed')
        ? 'Camera permission was blocked. Allow camera access for this site in your browser settings, then try again.'
        : `Couldn't start: ${msg}`;
    err.classList.remove('hidden');
    startBtn.disabled = false;
  }
}

function toggleFreeze() {
  if (!source) return;
  frozen = !frozen;
  $('freezeBtn').classList.toggle('active', frozen);
  if (source.kind === 'camera') {
    if (frozen) {
      freezeCanvas.width = source.width;
      freezeCanvas.height = source.height;
      freezeCanvas.getContext('2d')!.drawImage(video, 0, 0);
      freezeCanvas.classList.remove('hidden');
    } else {
      freezeCanvas.classList.add('hidden');
    }
  }
  if (!frozen) lastSeen = performance.now(); // avoid an instant fade after unfreezing
}

// ---------- Settings sheet ----------
function updateFovLabel() {
  const el = document.getElementById('fovValue');
  if (!el) return;
  const f = focal.focal();
  const w = source?.width ?? 0;
  const h = source?.height ?? 0;
  if (settings.autoFov) {
    el.textContent = f && w ? `auto · ${fovFromFocal(f, w, h).toFixed(1)}°` : `auto · learning (using ${settings.fov}°)`;
  } else {
    el.textContent = `${settings.fov}°`;
  }
}

function bindSettings() {
  const fov = $<HTMLInputElement>('fov');
  const autoFov = $<HTMLInputElement>('autoFov');
  const lid = $<HTMLInputElement>('lid');
  const useGravity = $<HTMLInputElement>('useGravity');
  const showOutline = $<HTMLInputElement>('showOutline');
  const debug = $<HTMLInputElement>('debug');
  const sync = () => {
    fov.value = String(settings.fov);
    autoFov.checked = settings.autoFov;
    lid.value = String(settings.lidDeg);
    useGravity.checked = settings.useGravity;
    showOutline.checked = settings.showOutline;
    debug.checked = settings.debug;
    $('lidValue').textContent = `${settings.lidDeg}°`;
    fov.disabled = settings.autoFov;
    updateFovLabel();
  };
  sync();
  fov.addEventListener('input', () => {
    settings.fov = Number(fov.value);
    saveSettings();
    sync();
  });
  autoFov.addEventListener('change', () => {
    settings.autoFov = autoFov.checked;
    saveSettings();
    sync();
  });
  lid.addEventListener('input', () => {
    settings.lidDeg = Number(lid.value);
    saveSettings();
    sync();
  });
  useGravity.addEventListener('change', () => {
    settings.useGravity = useGravity.checked;
    saveSettings();
  });
  showOutline.addEventListener('change', () => {
    settings.showOutline = showOutline.checked;
    saveSettings();
  });
  debug.addEventListener('change', () => {
    settings.debug = debug.checked;
    saveSettings();
  });
  $('rescanBtn').addEventListener('click', () => {
    payload = null;
    model = null;
    lastFrame = null;
    overlay.setModel(null);
    renderOptionalSettings(null);
    history.replaceState(null, '', location.pathname + (isDemo ? location.search.replace(/[?&]d=[^&]*/, '') : ''));
    if (source instanceof DemoSource) demoStart = performance.now();
    closeSheets();
  });
}

// ---------- Wire up ----------
$('startBtn').addEventListener('click', () => void start());
$('freezeBtn').addEventListener('click', toggleFreeze);
$('settingsBtn').addEventListener('click', () => {
  infoSheet.classList.remove('open');
  selected = null;
  updateFovLabel();
  settingsSheet.classList.toggle('open');
});
$('infoClose').addEventListener('click', closeSheets);
$('settingsClose').addEventListener('click', closeSheets);
$('root').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains('ar-layer') || t.id === 'root') closeSheets();
});
bindSettings();

if (isDemo) {
  $('startLead').textContent = 'Demo mode: a simulated camera orbits a virtual laptop. The real tracking pipeline runs on every frame.';
  $('startBtn').textContent = 'Start demo';
  $('demoLink').classList.add('hidden');
} else if (payload) {
  $('startLead').textContent = 'Laptop QR detected. Tap Start, then point the camera at the laptop screen.';
}
