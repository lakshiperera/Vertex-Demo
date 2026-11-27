# Laptop AR Guide (web starter)

Point a phone at a laptop and see every port labelled in AR, right in the mobile browser with no app install.

- **Laptop page** (`laptop.html`) shows 4 ArUco tracking markers and a QR code full screen.
- **Phone page** (`phone.html`) opens the camera, reads the QR, tracks the markers, works out where the laptop base is, and draws tappable labels on the ports.
- **Demo mode** (`phone.html?demo=1`) simulates a camera orbiting a virtual laptop, so you can try the whole pipeline on a desktop.

## Run it

```powershell
cd laptop-ar-web
npm install
npm run dev
```

Vite prints a **Network** address such as `https://192.168.1.20:5173`. Both devices must be on the same Wi-Fi.

1. **On the laptop:** open `https://<network-address>/laptop.html`, pick the model, and press **Show marker**. Don't use `localhost`, because the phone can't reach that.
2. **On the phone:** scan the QR with the normal camera app (it opens the web app), or open `https://<network-address>/phone.html`, then tap **Start AR**.
3. Accept the self-signed certificate warning once on each device. Camera access needs HTTPS.
4. Point the phone at the screen, then move to the left or right side to see the side ports.

For desktop-only testing without HTTPS: `npm run dev:http`, then open `http://localhost:5174/phone.html?demo=1`.

Production build: `npm run build` writes static files to `dist/`. Host them on any HTTPS static host (Netlify, Vercel, GitHub Pages and so on).

## How it works

```
Laptop screen                         Phone browser
─────────────                         ─────────────
4 ArUco markers (corners)  ─camera─►  js-aruco2 finds marker corners
QR = phone.html?d=<payload>           jsQR / BarcodeDetector reads payload (model id, marker size + positions in mm)
                                      Homography (DLT) → screen pose (camera intrinsics from FOV setting)
                                      Hinge line + gravity (DeviceMotion) → laptop base pose, at any lid angle
                                      Project port positions → hotspots + HTML labels (tap for info)
```

- **Lid angle problem:** the markers give the *screen* pose, but the ports are on the *base*. The bottom of the screen is the hinge line, and the base lies flat on the desk. So the base is the horizontal plane through the hinge, with "horizontal" taken from the phone's accelerometer. Without a sensor, the lid angle from Settings is used.
- **True marker size:** the laptop page draws the markers at a real size in millimetres, using the model's display width (or a credit-card calibration) and puts the sizes in the QR.
- **Hold and freeze:** labels stay for about 1 second after the screen leaves the view. The 📸 button freezes the frame so you can tap labels at leisure.

## Wrong-model protection

If the dropdown on the laptop page doesn't match the physical laptop, the overlay would put one laptop's ports on another's body. Two checks catch that:

- **Laptop page (instant):** compares the screen's aspect ratio (and, after a card calibration, its physical width) with the selected model. On a mismatch it shows a red warning with **Use <model>** buttons for the models that fit.
- **Phone (after the markers lock):**
  - **Screen check (exact):** the QR carries the marker page's size, so a 16:10 screen with a 16:9 model selected (or the reverse) is flagged at once.
  - **Body check (approximate):** the palm rest's brightness is measured relative to the screen's own white page and black marker cells. It catches clear cases like a black Dell profile on a grey Lenovo. Lighting still affects it, so the banner's **It's correct** button stores the measured value for that model on that phone, and the check learns.
  - The red banner's **Switch to <model>** fixes the overlay on the spot. Without a card calibration it also rescales the page geometry by (real ÷ selected screen width).

Each model file has `brand` and `appearance` (`chassisTone`, `chassisSamplesMm` palm-rest points, `bezelLogo`).

Demo: `phone.html?demo=1&model=<physical>&as=<selected>` simulates choosing the wrong model, for example `?demo=1&model=lenovo-loq-15arp10e&as=dell-latitude-3470`.

## Project layout

```
index.html, laptop.html, phone.html
public/models/index.json          list of laptop models (laptop-page dropdown)
public/models/hp-elitebook-845-g11.json
public/models/dell-latitude-3470.json
public/models/lenovo-loq-15irx9.json
src/shared/                       payload (QR data), marker drawing, model types/loading
src/laptop/main.ts                marker page + card calibration
src/phone/main.ts                 app controller / main loop
src/phone/tracker.ts              ArUco detection → homography → screen pose
src/phone/laptopPose.ts           hinge + gravity → base frame, port positions
src/phone/overlay.ts              hotspots, outline, label placement
src/phone/demo.ts                 simulated camera + laptop
src/phone/gravity.ts, qr.ts, sources.ts, math.ts, smoothing.ts
src/vendor/js-aruco2/             ArUco detector (vendored, patched to an ES module)
```

## Add your own laptop

Each model file has a `source` field saying where its layout came from and how exact the positions are. Positions taken from manufacturer photos are about ±5 mm; anything marked as an estimate should be checked on a real unit.

1. Copy an existing model file (for example `public/models/hp-elitebook-845-g11.json`) to `public/models/<your-id>.json` (lowercase letters, numbers, dashes only).
2. Measure with a ruler or caliper:
   - `display.widthMm` / `heightMm`: the **lit** screen area.
   - `display.hingeToDisplayBottomMm`: from the hinge axis up to the bottom of the lit area.
   - `base.widthMm` / `depthMm` / `thicknessMm`.
3. For each port, set `positionMm` in the base frame. The origin is the **centre of the hinge line on the top surface of the base**, with X to the right, Y up and Z towards you.
   - Left-side port: `x = -width/2`, `y = -(height above the desk measured down from the top surface)`, `z = distance from the back edge`.
   - `side: "lid"` items use `x` (right) and `y` (distance up the lid from the hinge).
   - If the base sticks out behind the hinge (gaming laptops with a rear port block), set `base.hingeFromBackMm`. Back-edge ports then have `z = -hingeFromBackMm`.
   - Parts only some configurations have (fingerprint reader, smart card reader, SIM slot) get `"optional": true`. They stay hidden until the user ticks them under Settings → "Parts fitted on your laptop".
   - Only add a part when you know where it is. A guessed position is how a charging light ends up labelled on the touchpad.
4. Add the model to `public/models/index.json`.

## Tuning on a real phone

- **Camera field of view** is calibrated automatically (Settings shows `auto · NN°` once learned). Move around the laptop so the screen is seen at an angle, because head-on views carry no FOV information. The value is remembered for next time. You can switch auto off and set it by hand.
- Turn on **Show detected markers** to check detection: green squares mark each marker, and a red dot marks its top-left corner.
- Use screen brightness at maximum, a matte or low-glare angle, and good room light.

## Known limits (starter)

- With no world tracking in the browser (iPhone has no WebXR AR), labels need the screen markers in view, apart from a short hold and freeze mode.
- Camera focal length comes from the FOV setting, not per-device calibration.
- Laptop model detection is manual, through the dropdown. A small native companion app could read it automatically.
