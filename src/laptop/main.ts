import QRCode from 'qrcode';
import { computeMarkerLayout, qrSizePx, renderMarkerPage } from '../shared/markers';
import { matchingModels, screenMismatch, type ScreenFacts } from '../shared/hardwareMatch';
import { fetchAllModels, fetchModel, fetchModelIndex } from '../shared/models';
import { encodePayloadUrl, MAX_BASE_ID, type MarkerPayload } from '../shared/payload';
import type { LaptopModel } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const setup = $('setup');
const modelSelect = $<HTMLSelectElement>('model');
const sizeInfo = $('sizeInfo');
const showBtn = $<HTMLButtonElement>('showBtn');
const calibBtn = $<HTMLButtonElement>('calibBtn');
const errorBox = $('error');
const canvas = $<HTMLCanvasElement>('markerCanvas');
const calib = $('calib');
const calibCard = $('calibCard');
const calibSlider = $<HTMLInputElement>('calibSlider');

const CARD_W_MM = 85.6;
const CARD_H_MM = 53.98;
const calibKey = () => `ppm:${screen.width}x${screen.height}`;

let model: LaptopModel | null = null;
let allModels: LaptopModel[] = [];
let baseId = -1;

/** The real screen this page runs on. Physical width only counts when card-calibrated. */
function screenFacts(): ScreenFacts {
  const ppm = savedPpm();
  return { aspect: screen.width / screen.height, widthMm: ppm ? screen.width / ppm : null };
}

/**
 * Warn when the selected model can't be this laptop (screen shape, or calibrated width),
 * and offer the models that do match.
 */
function checkHardware() {
  const box = $('hwWarning');
  if (!model) return box.classList.add('hidden');
  const facts = screenFacts();
  const reason = screenMismatch(model, facts);
  if (!reason) return box.classList.add('hidden');

  const title = document.createElement('b');
  title.textContent = `⚠️ Hardware Mismatch Warning: This display does not match the selected ${model.displayName} dimensions.`;
  const detail = document.createElement('div');
  detail.textContent = reason;
  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = '8px';
  const matches = matchingModels(allModels, facts);
  if (matches.length) {
    for (const m of matches) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `Use ${m.displayName}`;
      b.addEventListener('click', () => {
        modelSelect.value = m.id;
        void loadModel(m.id);
      });
      actions.append(b);
    }
  } else {
    actions.textContent = 'None of the listed models match this screen. Add a model file for this laptop (see README).';
  }
  box.replaceChildren(title, detail, actions);
  box.classList.remove('hidden');
}

/**
 * New random marker ids for every rendered page (multiple of 4, different from the last).
 * A phone holding an older layout (other laptop, other window size) then sees ids it
 * doesn't expect and re-reads the QR instead of mis-fitting the markers.
 */
function nextBaseId(): number {
  let id: number;
  do id = 4 * Math.floor(Math.random() * (MAX_BASE_ID / 4 + 1));
  while (id === baseId);
  return (baseId = id);
}

function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

/** CSS pixels per millimetre, estimated from the model's physical display width. */
function estimatedPpm(): number {
  return model ? screen.width / model.display.widthMm : 96 / 25.4;
}

function savedPpm(): number | null {
  try {
    const v = Number(localStorage.getItem(calibKey()));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function currentPpm(): number {
  return savedPpm() ?? estimatedPpm();
}

function updateSizeInfo() {
  if (!model) return;
  const ppm = currentPpm();
  const source = savedPpm() ? 'calibrated with a card' : `estimated from the ${model.display.widthMm} mm display width`;
  sizeInfo.innerHTML =
    `Screen: <b>${screen.width} × ${screen.height}</b> CSS px · Scale: <b>${ppm.toFixed(2)} px/mm</b> (${source}).` +
    `<br/>If the markers look the wrong size, or this isn't the laptop's built-in screen, use <b>Calibrate</b>.`;
}

function checkHost() {
  const warn = $('hostWarning');
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
    warn.innerHTML =
      `You opened this page as <code>${h}</code>, so your phone can't reach the link in the QR code. ` +
      `Open it using the <b>Network</b> address printed by <code>npm run dev</code> (for example <code>https://192.168.1.20:5173/laptop.html</code>).`;
    warn.classList.remove('hidden');
  }
}

async function loadModel(id: string) {
  try {
    model = await fetchModel(id);
    try {
      localStorage.setItem('laptopModel', id);
    } catch {
      /* storage unavailable: fine */
    }
    showBtn.disabled = false;
    calibBtn.disabled = false;
    updateSizeInfo();
    checkHardware();
  } catch (e) {
    showError(String(e instanceof Error ? e.message : e));
  }
}

async function render() {
  if (!model) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ppmCss = currentPpm();
  const ppmCanvas = ppmCss * dpr;

  // Layout uses the real viewport size in mm; in full screen its bottom edge is the display's bottom edge.
  const layout = computeMarkerLayout(w / ppmCss, h / ppmCss);
  const payload: MarkerPayload = {
    v: 1,
    m: model.id,
    s: layout.markerSizeMm,
    k: layout.centers,
    i: nextBaseId(),
    // Page size and whether the scale is measured: lets the phone check the screen against the model.
    w: w / ppmCss,
    h: h / ppmCss,
    c: savedPpm() ? 1 : 0,
  };
  const phoneUrl = new URL('phone.html', location.href).toString();
  const url = encodePayloadUrl(phoneUrl, payload);

  const qrSize = qrSizePx(canvas.width, canvas.height, ppmCanvas, payload);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, { width: qrSize, margin: 2, errorCorrectionLevel: 'M' });

  const ctx = canvas.getContext('2d')!;
  renderMarkerPage(ctx, canvas.width, canvas.height, ppmCanvas, payload, qr, 'Scan with your phone camera');
}

function showMarker() {
  // Show straight away; entering full screen triggers a resize, which re-renders at the final size.
  // If full screen is refused (e.g. inside an iframe) the marker still shows, with a less exact hinge offset.
  showMarkerView();
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

function showMarkerView() {
  setup.classList.add('hidden');
  canvas.classList.remove('hidden');
  void render();
}

function hideMarkerView() {
  canvas.classList.add('hidden');
  setup.classList.remove('hidden');
}

document.addEventListener('fullscreenchange', () => {
  // Leaving full screen (Esc) returns to the setup screen.
  if (!document.fullscreenElement) hideMarkerView();
});

window.addEventListener('resize', () => {
  if (!canvas.classList.contains('hidden')) void render();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.fullscreenElement) hideMarkerView();
});

// ---------- Card calibration ----------
function drawCalibCard() {
  const ppm = estimatedPpm() * Number(calibSlider.value);
  calibCard.style.width = `${CARD_W_MM * ppm}px`;
  calibCard.style.height = `${CARD_H_MM * ppm}px`;
}

calibBtn.addEventListener('click', () => {
  calibSlider.value = String(currentPpm() / estimatedPpm());
  drawCalibCard();
  calib.classList.remove('hidden');
});
calibSlider.addEventListener('input', drawCalibCard);
$('calibSave').addEventListener('click', () => {
  try {
    localStorage.setItem(calibKey(), String(estimatedPpm() * Number(calibSlider.value)));
  } catch {
    showError('Could not save the calibration (browser storage is blocked).');
  }
  calib.classList.add('hidden');
  updateSizeInfo();
  checkHardware(); // a calibrated width makes the size check possible
});
$('calibReset').addEventListener('click', () => {
  try {
    localStorage.removeItem(calibKey());
  } catch {
    /* ignore */
  }
  calibSlider.value = '1';
  drawCalibCard();
  updateSizeInfo();
  checkHardware();
});
$('calibCancel').addEventListener('click', () => calib.classList.add('hidden'));

showBtn.addEventListener('click', showMarker);
canvas.addEventListener('dblclick', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else hideMarkerView();
});
modelSelect.addEventListener('change', () => void loadModel(modelSelect.value));

async function init() {
  checkHost();
  try {
    const index = await fetchModelIndex();
    allModels = await fetchAllModels(); // for the mismatch check's suggestions
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('laptopModel');
    } catch {
      /* ignore */
    }
    for (const m of index) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.displayName;
      modelSelect.append(opt);
    }
    const initial = index.find((m) => m.id === saved)?.id ?? index[0]?.id;
    if (initial) {
      modelSelect.value = initial;
      await loadModel(initial);
    }
  } catch (e) {
    showError(String(e instanceof Error ? e.message : e));
  }
}

void init();
