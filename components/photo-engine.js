// components/photo-engine.js — the Photo tool's engine, extracted VERBATIM
// from the retired views/photo.liquid (its inline script, wrapped in an
// init/dispose lifecycle for React). This code is live-tested against the
// physical printer: the calibration CURVE (keep in sync with
// scripts/print-calibration.js), the worker viewfinder protocol
// (public/dither-worker.js), and the crop/levels pointer math must not be
// 'cleaned up' — see docs/rp850-field-notes.md for why the curve looks
// the way it does. The markup it drives is components/photo-tool.tsx;
// element ids and class names are the contract between the two.
//
// Mounted once per page visit by photo-tool.tsx; dispose stops the
// camera, terminates the worker, and clears timers/listeners.

export function initPhotoTool() {
  var TPL = null;
  var previewData = null;   // uncompensated — what the paper will LOOK like
                            // (the compensated print version is built once,
                            // when Print is pressed)
  var photoHeight = 0;
  var debounceTimer = null;

  // Editing state. The uploaded photo is kept as `base` (rotation 0) and
  // every edit re-derives the print image from it, so the tone curve always
  // runs last, on the exact pixels that print.
  var base = null;          // canvas: original, downscaled to EDIT_MAX
  var rot = 0;              // clockwise 90° steps, 0..3
  var oriented = null;      // canvas: base with rotation applied
  var crop = null;          // {x,y,w,h} in oriented-canvas pixels
  var EDIT_MAX = 1600;      // working resolution — plenty above the 576-dot output
  var MIN_CROP = 32;        // oriented px
  // Very tall crops make very long slips and would outgrow the renderer's
  // canvas; cap crop height at 2.4× its width (≈1382 print rows).
  var MAX_ASPECT = 2.4;

  var captionSize = 36;
  var captionWeight = 400;

  // Tone controls. These reshape the photo's tones BEFORE the calibration
  // curve (which always runs last): levels stretch, midtone gamma, shadow
  // lift, brightness shift, contrast curve, composed into one lookup
  // table; sharpening runs after as a spatial pass. The edit canvas keeps
  // showing the untouched photo; adjustments appear in the live render.
  var blackPt = 0;
  var whitePt = 255;
  var midV = 0;
  var shadowV = 0;
  var brightV = 0;
  var contrastV = 0;
  var sharpV = 0;
  var autoOn = true;        // recompute black/white points per crop
  var hist = new Uint32Array(256);
  var toneTimer = null;

  var input = document.getElementById('photoInput');
  var cameraInput = document.getElementById('cameraInput');
  var dropzone = document.getElementById('dropzone');
  var caption = document.getElementById('captionInput');
  var printBtn = document.getElementById('printBtn');
  var statusEl = document.getElementById('photoStatus');
  var roll = document.getElementById('photoRoll');
  var empty = document.getElementById('photoEmpty');
  var editor = document.getElementById('photoEditor');
  var editCanvas = document.getElementById('editCanvas');
  var presetsEl = document.getElementById('cropPresets');
  var histCanvas = document.getElementById('histCanvas');
  var levelTrack = document.getElementById('levelTrack');
  var handleBlack = document.getElementById('handleBlack');
  var handleWhite = document.getElementById('handleWhite');
  var levelsVal = document.getElementById('levelsVal');
  var autoBtn = document.getElementById('autoBtn');
  var toneBody = document.getElementById('toneBody');
  var toneChev = document.getElementById('toneChev');
  var toneSummary = document.getElementById('toneSummary');

  // fetch the Photo Print template from the store (it's seeded on first tick)
  fetch('/templates').then(function (r) { return r.json(); }).then(function (list) {
    var t = list.find(function (x) { return x.name === 'Photo Print'; });
    if (t) TPL = t.template;
    else statusEl.textContent = 'Photo Print template missing — run a tick to seed it';
  });

  // Thermal dot gain compensation: printed dots bleed larger than their
  // pixels, darkening paper vs the dither — mildly in highlights, fatally
  // in shadows (dark grays fuse to black). Tone-dependent transfer curve,
  // calibrated on printed wedges: anchors are [brightness, gamma], blended
  // linearly; output = b^gamma(b).
  // Keep in sync with scripts/print-calibration.js.
  var CURVE = [
    [0.0, 0.50], [0.1, 0.53], [0.2, 0.53], [0.3, 0.58], [0.4, 0.63],
    [0.5, 0.70], [0.6, 0.78], [0.7, 0.88], [0.8, 0.96], [1.0, 1.00]
  ];
  var LUT = new Uint8Array(256);
  for (var v = 0; v < 256; v++) {
    var b = v / 255;
    var g = CURVE[CURVE.length - 1][1];
    for (var ci = 1; ci < CURVE.length; ci++) {
      if (b <= CURVE[ci][0]) {
        var f = (b - CURVE[ci - 1][0]) / (CURVE[ci][0] - CURVE[ci - 1][0]);
        g = CURVE[ci - 1][1] + f * (CURVE[ci][1] - CURVE[ci - 1][1]);
        break;
      }
    }
    LUT[v] = Math.round(255 * Math.pow(b, g));
  }

  // The editor can wear the photo dithered while editing the real pixels
  // underneath: viewfinder captures keep the color original as the edit
  // source, and the crop canvas shows a worker-dithered skin of it.
  var editorDithered = false;
  var editorSkin = null;

  function buildEditorSkin() {
    if (!editorDithered || !camWorker || !oriented) { editorSkin = null; return; }
    var w = 576;
    var h = Math.round(oriented.height * w / oriented.width);
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var cx = c.getContext('2d');
    cx.drawImage(oriented, 0, 0, w, h);
    var img = cx.getImageData(0, 0, w, h);
    camWorker.postMessage({ cmd: 'still', buf: img.data.buffer, w: w, h: h }, [img.data.buffer]);
  }

  // Shared entry for uploads AND webcam frames: anything drawImage accepts.
  function loadFromSource(src, w, h, label, dithered) {
    closeCamera();
    editorDithered = !!dithered;
    editorSkin = null;
    var scale = Math.min(EDIT_MAX / w, EDIT_MAX / h, 1);
    base = document.createElement('canvas');
    base.width = Math.round(w * scale);
    base.height = Math.round(h * scale);
    base.getContext('2d').drawImage(src, 0, 0, base.width, base.height);
    rot = 0;
    buildOriented();
    crop = { x: 0, y: 0, w: oriented.width, h: oriented.height };
    clampAspect();
    setPresetActive('');
    // the big dropzone earns its size only before a photo exists
    document.getElementById('photoTool').classList.add('has-photo');
    setPanel('crop');
    // fresh photo, fresh tone (auto keeps recomputing levels if it's on)
    Object.keys(toneCtl).forEach(function (k) { toneCtl[k].reset(); });
    if (!autoOn) { blackPt = 0; whitePt = 255; }
    positionHandles();
    editor.hidden = false;
    document.getElementById('dropHint').innerHTML =
      label + '<br><span class="sub">choose another to replace</span>';
    drawEditor();
    buildEditorSkin();
    refreshHistogram();
    derive();
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    var img = new Image();
    img.onload = function () {
      loadFromSource(img, img.width, img.height, file.name.replace(/</g, '&lt;'));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  // ---- in-page camera: live dithered viewfinder via getUserMedia ----
  // Runs on desktops AND phones (needs a secure page: https or localhost —
  // a phone hitting http://<laptop-ip> gets no camera API at all). Phones
  // prefer the rear camera; the native camera app stays reachable through
  // the Choose-a-photo picker. iPads masquerade as Macs — the touch-point
  // check catches them.

  var IS_MOBILE = navigator.userAgentData ? navigator.userAgentData.mobile :
    (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  var cameraFeed = document.getElementById('cameraFeed');
  var cameraStream = null;

  // ---- live dithered viewfinder ----
  // The hidden <video> is only a frame source; what you see is #camDither,
  // fed by a Web Worker running the print pipeline's dither off the main
  // thread. One frame in flight at a time: the worker's reply schedules
  // the next capture, so a slow device drops to a lower framerate instead
  // of queueing stale frames.

  var camDither = document.getElementById('camDither');
  var camFacingUser = true;   // selfie cams mirror; rear cams must not
  var camWorker = null;
  var camRunning = false;
  var camBusy = false;
  var camFrames = 0;
  var camFpsTimer = null;
  var camCap = null;         // capture canvas (video frame -> pixels)
  // dither width ladder: start at the print's 576 so the texture matches
  // the render; slow devices step down until they hold a usable framerate
  var CAM_WIDTHS = [576, 448, 352];
  var camWidthIdx = 0;

  // pace to real camera frames where supported — dithering the same frame
  // twice is free heat (a 120Hz screen pumps rAF 4x faster than the camera)
  function scheduleCamFrame() {
    if (cameraFeed.requestVideoFrameCallback) cameraFeed.requestVideoFrameCallback(pumpCamFrame);
    else requestAnimationFrame(pumpCamFrame);
  }

  function pumpCamFrame() {
    if (!camRunning || camBusy) return;
    if (!cameraFeed.videoWidth) { scheduleCamFrame(); return; }
    // dither at the print's 576-dot width and let the display scale it
    // down smoothly, exactly like the rendered preview is displayed —
    // same dot count over the same scene, so the texture and tone match
    // (slow devices step down the ladder; see the fps timer)
    var w = CAM_WIDTHS[camWidthIdx];
    var h = Math.round(w * cameraFeed.videoHeight / cameraFeed.videoWidth);
    if (!camCap) camCap = document.createElement('canvas');
    if (camCap.width !== w || camCap.height !== h) { camCap.width = w; camCap.height = h; }
    var ctx = camCap.getContext('2d', { willReadFrequently: true });
    // selfie cams mirror for natural framing; rear cams must not, or
    // any text in frame would print backwards
    if (camFacingUser) ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(cameraFeed, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var img = ctx.getImageData(0, 0, w, h);
    camBusy = true;
    camWorker.postMessage({ buf: img.data.buffer, w: w, h: h }, [img.data.buffer]);
  }

  function startDitherCam() {
    if (!window.Worker) {              // ancient browser: show the raw feed
      cameraFeed.style.display = 'block';
      camDither.style.display = 'none';
      return;
    }
    if (!camWorker) {
      camWorker = new Worker('/dither-worker.js');
      camWorker.onmessage = function (ev) {
        var m = ev.data;
        if (m.still) {
          // the editor's dithered display skin (see buildEditorSkin)
          editorSkin = document.createElement('canvas');
          editorSkin.width = m.w;
          editorSkin.height = m.h;
          editorSkin.getContext('2d')
            .putImageData(new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h), 0, 0);
          drawEditor();
          return;
        }
        camBusy = false;
        if (!camRunning) return;
        if (camDither.width !== m.w || camDither.height !== m.h) {
          camDither.width = m.w;
          camDither.height = m.h;
        }
        camDither.getContext('2d')
          .putImageData(new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h), 0, 0);
        camFrames++;
        scheduleCamFrame();
      };
    }
    camRunning = true;
    camFrames = 0;
    camWidthIdx = 0;
    var camSeconds = 0;
    camFpsTimer = setInterval(function () {
      statusEl.textContent = camFrames + ' fps \u00b7 dithered viewfinder';
      console.log('[viewfinder] ' + camFrames + ' fps @ ' + CAM_WIDTHS[camWidthIdx] + 'px');
      camSeconds++;
      // give the pipeline a settling second, then step down if struggling
      if (camSeconds > 1 && camFrames < 18 && camWidthIdx < CAM_WIDTHS.length - 1) {
        camWidthIdx++;
        console.log('[viewfinder] slow — dropping dither width to ' + CAM_WIDTHS[camWidthIdx] + 'px');
      }
      camFrames = 0;
    }, 1000);
    scheduleCamFrame();
  }

  function stopDitherCam() {
    camRunning = false;
    clearInterval(camFpsTimer);
    statusEl.textContent = '';
  }

  // The viewfinder shares the editor's stage: camera mode swaps the canvas
  // for the video in place, and capturing swaps back.
  function closeCamera() {
    stopDitherCam();
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) { t.stop(); });
      cameraStream = null;
    }
    cameraFeed.srcObject = null;
    editor.classList.remove('camera');
    if (!base) editor.hidden = true;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    document.getElementById('takeBtn').addEventListener('click', function (e) {
      e.preventDefault();
      if (cameraStream) return;
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: IS_MOBILE ? { ideal: 'environment' } : 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      }).then(function (stream) {
        cameraStream = stream;
        var st = stream.getVideoTracks()[0].getSettings();
        camFacingUser = !st.facingMode || st.facingMode === 'user';
        cameraFeed.srcObject = stream;
        editor.hidden = false;
        editor.classList.add('camera');
        startDitherCam();
      }).catch(function () {
        statusEl.textContent = 'camera unavailable — check permissions';
      });
    });
    document.getElementById('captureBtn').addEventListener('click', function () {
      if (!cameraStream || !cameraFeed.videoWidth) return;
      // full-resolution raw frame, oriented to match the viewfinder. The
      // color original stays the hidden edit source (sharp crops, real
      // grays for tone + calibration); the editor DISPLAYS it dithered.
      var w = cameraFeed.videoWidth, h = cameraFeed.videoHeight;
      var flip = document.createElement('canvas');
      flip.width = w;
      flip.height = h;
      var fctx = flip.getContext('2d');
      if (camFacingUser) {
        fctx.translate(w, 0);
        fctx.scale(-1, 1);
      }
      fctx.drawImage(cameraFeed, 0, 0);
      loadFromSource(flip, w, h, 'camera capture', true);
    });
    document.getElementById('cameraCancelBtn').addEventListener('click', closeCamera);
  }

  function buildOriented() {
    oriented = document.createElement('canvas');
    if (rot % 2) { oriented.width = base.height; oriented.height = base.width; }
    else { oriented.width = base.width; oriented.height = base.height; }
    var ctx = oriented.getContext('2d');
    ctx.translate(oriented.width / 2, oriented.height / 2);
    ctx.rotate(rot * Math.PI / 2);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
  }

  function clampAspect() {
    var maxH = Math.round(crop.w * MAX_ASPECT);
    if (crop.h > maxH) {
      crop.y += Math.round((crop.h - maxH) / 2);
      crop.h = maxH;
    }
  }

  // Rotate the image AND carry the crop rect along with it (90° clockwise:
  // a rect at (x,y) lands at (oldH - y - h, x) with width/height swapped).
  document.getElementById('rotateBtn').addEventListener('click', function () {
    if (!oriented) return;
    var oldH = oriented.height;
    crop = { x: oldH - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w };
    rot = (rot + 1) % 4;
    buildOriented();
    clampAspect();
    setPresetActive(null);
    drawEditor();
    buildEditorSkin();
    refreshHistogram();
    derive();
  });

  presetsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || !oriented) return;
    var W = oriented.width, H = oriented.height;
    var a = btn.dataset.a;
    if (!a) {
      crop = { x: 0, y: 0, w: W, h: H };
    } else {
      // ratio follows the image's orientation: 4:3 on a portrait shot
      // means 3:4, like every phone cropper
      var ratio = parseFloat(a);
      if (H > W && ratio > 1) ratio = 1 / ratio;
      var w = W, h = Math.round(w / ratio);
      if (h > H) { h = H; w = Math.round(h * ratio); }
      crop = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: w, h: h };
    }
    clampAspect();
    setPresetActive(a);
    drawEditor();
    refreshHistogram();
    derive();
  });

  function setPresetActive(a) {
    presetsEl.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('on', a !== null && btn.dataset.a === a);
    });
  }

  // ---- editor canvas: draw + drag ----

  var editScale = 1;   // oriented px -> canvas css px

  function drawEditor() {
    if (!oriented) return;
    var colW = editor.clientWidth || 320;
    editScale = Math.min(colW / oriented.width, 380 / oriented.height);
    var cssW = Math.round(oriented.width * editScale);
    var cssH = Math.round(oriented.height * editScale);
    var dpr = window.devicePixelRatio || 1;
    editCanvas.style.width = cssW + 'px';
    editCanvas.style.height = cssH + 'px';
    editCanvas.width = Math.round(cssW * dpr);
    editCanvas.height = Math.round(cssH * dpr);
    var ctx = editCanvas.getContext('2d');
    var k = editCanvas.width / oriented.width;  // oriented px -> device px
    ctx.drawImage(editorSkin || oriented, 0, 0, editCanvas.width, editCanvas.height);
    // dim everything outside the crop
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, editCanvas.width, crop.y * k);
    ctx.fillRect(0, (crop.y + crop.h) * k, editCanvas.width, editCanvas.height - (crop.y + crop.h) * k);
    ctx.fillRect(0, crop.y * k, crop.x * k, crop.h * k);
    ctx.fillRect((crop.x + crop.w) * k, crop.y * k, editCanvas.width - (crop.x + crop.w) * k, crop.h * k);
    // crop border: white line with a dark shadow line so it reads on any photo
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(crop.x * k, crop.y * k, crop.w * k, crop.h * k);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(crop.x * k, crop.y * k, crop.w * k, crop.h * k);
    // corner handles
    var hs = 8 * (editCanvas.width / cssW);
    ctx.fillStyle = '#fff';
    [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]]
      .forEach(function (c) {
        ctx.fillRect(c[0] * k - hs / 2, c[1] * k - hs / 2, hs, hs);
      });
  }

  var drag = null;

  function toOriented(e) {
    var r = editCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * oriented.width,
      y: (e.clientY - r.top) / r.height * oriented.height,
    };
  }

  editCanvas.addEventListener('pointerdown', function (e) {
    if (!oriented) return;
    e.preventDefault();
    editCanvas.setPointerCapture(e.pointerId);
    var p = toOriented(e);
    var grab = 14 / editScale;  // 14 css px grab radius, in oriented units
    var nearL = Math.abs(p.x - crop.x) < grab;
    var nearR = Math.abs(p.x - (crop.x + crop.w)) < grab;
    var nearT = Math.abs(p.y - crop.y) < grab;
    var nearB = Math.abs(p.y - (crop.y + crop.h)) < grab;
    var inX = p.x > crop.x - grab && p.x < crop.x + crop.w + grab;
    var inY = p.y > crop.y - grab && p.y < crop.y + crop.h + grab;
    var mode = '';
    if (nearT && inX) mode += 'n';
    if (nearB && inX) mode += 's';
    if (nearL && inY) mode += 'w';
    if (nearR && inY) mode += 'e';
    if (!mode) {
      if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) {
        mode = 'move';
      } else {
        // start a fresh rect from here
        crop = { x: Math.round(p.x), y: Math.round(p.y), w: MIN_CROP, h: MIN_CROP };
        mode = 'se';
      }
    }
    drag = { mode: mode, start: p, orig: { x: crop.x, y: crop.y, w: crop.w, h: crop.h } };
    setPresetActive(null);
  });

  editCanvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    e.preventDefault();
    var p = toOriented(e);
    var dx = p.x - drag.start.x;
    var dy = p.y - drag.start.y;
    var o = drag.orig;
    var W = oriented.width, H = oriented.height;
    if (drag.mode === 'move') {
      crop.x = Math.round(Math.max(0, Math.min(W - o.w, o.x + dx)));
      crop.y = Math.round(Math.max(0, Math.min(H - o.h, o.y + dy)));
    } else {
      var x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (drag.mode.indexOf('w') >= 0) x1 = Math.max(0, Math.min(x2 - MIN_CROP, o.x + dx));
      if (drag.mode.indexOf('e') >= 0) x2 = Math.min(W, Math.max(x1 + MIN_CROP, o.x + o.w + dx));
      if (drag.mode.indexOf('n') >= 0) y1 = Math.max(0, Math.min(y2 - MIN_CROP, o.y + dy));
      if (drag.mode.indexOf('s') >= 0) y2 = Math.min(H, Math.max(y1 + MIN_CROP, o.y + o.h + dy));
      crop = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
    }
    drawEditor();
  });

  function endDrag(e) {
    if (!drag) return;
    drag = null;
    clampAspect();
    drawEditor();
    refreshHistogram();
    derive();
  }
  editCanvas.addEventListener('pointerup', endDrag);
  editCanvas.addEventListener('pointercancel', endDrag);

  var onWinResize = function () {
    if (oriented) { drawEditor(); drawHist(); }
  };
  window.addEventListener('resize', onWinResize);

  // ---- rotate/crop -> the two data URIs the rest of the flow uses ----

  // crop + tone + sharpen, shared by the live preview and the print path
  function renderAdjusted() {
    var outW = 576;
    var outH = Math.round(crop.h * outW / crop.w);
    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(oriented, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
    var pix = ctx.getImageData(0, 0, outW, outH);
    var d = pix.data;
    var tone = toneLUT();
    for (var p = 0; p < d.length; p += 4) {
      d[p] = tone[d[p]];
      d[p + 1] = tone[d[p + 1]];
      d[p + 2] = tone[d[p + 2]];
    }
    if (sharpV > 0) sharpen(d, outW, outH, sharpV / 100);
    ctx.putImageData(pix, 0, 0);
    return { canvas: canvas, ctx: ctx, pix: pix };
  }

  // Only the preview JPEG is produced per adjustment — the compensated
  // print version costs a second full encode, so Print builds it instead.
  function derive() {
    if (!oriented) return;
    updateSummary();
    var r = renderAdjusted();
    // The live preview dithers the adjusted but UNCOMPENSATED tones: on
    // screen (no dot gain) that approximates what the compensated print
    // looks like on paper — the curve and the paper's darkening cancel out.
    previewData = r.canvas.toDataURL('image/jpeg', 0.85);
    photoHeight = r.canvas.height;
    schedule();
  }

  // Histogram of the cropped photo (pre-adjustment). Only crop, rotation,
  // or a new photo change it — sliders don't — so it's computed here at
  // half resolution (plenty for 256 bins), not per slider move in derive.
  function refreshHistogram() {
    if (!oriented) return;
    var outW = 288;
    var outH = Math.max(1, Math.round(crop.h * outW / crop.w));
    var c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    var cx = c.getContext('2d');
    cx.drawImage(oriented, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
    var d = cx.getImageData(0, 0, outW, outH).data;
    hist.fill(0);
    for (var p = 0; p < d.length; p += 4) {
      hist[(d[p] * 2126 + d[p + 1] * 7152 + d[p + 2] * 722) / 10000 | 0]++;
    }
    if (autoOn) autoLevels();
    drawHist();
  }

  // ---- tone: levels + brightness + contrast, one lookup table ----

  function toneLUT() {
    var t = new Uint8Array(256);
    var f = (259 * (contrastV + 255)) / (255 * (259 - contrastV));
    var g = Math.pow(2, -midV / 100);   // +100 lightens mids (gamma 0.5), -100 darkens (gamma 2)
    for (var v = 0; v < 256; v++) {
      var x = (v - blackPt) * 255 / Math.max(1, whitePt - blackPt);
      x = x < 0 ? 0 : x > 255 ? 255 : x;
      x = 255 * Math.pow(x / 255, g);
      // shadow lift/deepen fades out quadratically toward the highlights
      x += (shadowV / 100) * 80 * Math.pow(1 - x / 255, 2);
      x += brightV;
      x = f * (x - 128) + 128;
      t[v] = x < 0 ? 0 : x > 255 ? 255 : Math.round(x);
    }
    return t;
  }

  // Unsharp mask: exaggerate the difference between each pixel and a small
  // blur of its neighborhood. Works on brightness only, applied equally to
  // the channels, so it can't introduce color fringes.
  function sharpen(d, w, h, amount) {
    var luma = new Float32Array(w * h);
    for (var i = 0, p = 0; p < d.length; p += 4, i++) {
      luma[i] = (d[p] * 2126 + d[p + 1] * 7152 + d[p + 2] * 722) / 10000;
    }
    var k = amount * 1.2;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var c = y * w + x;
        var blur = (
          luma[c - w - 1] + 2 * luma[c - w] + luma[c - w + 1] +
          2 * luma[c - 1] + 4 * luma[c] + 2 * luma[c + 1] +
          luma[c + w - 1] + 2 * luma[c + w] + luma[c + w + 1]) / 16;
        var delta = (luma[c] - blur) * k;
        if (delta) {
          var p2 = c * 4;
          var r = d[p2] + delta, g2 = d[p2 + 1] + delta, b = d[p2 + 2] + delta;
          d[p2] = r < 0 ? 0 : r > 255 ? 255 : r;
          d[p2 + 1] = g2 < 0 ? 0 : g2 > 255 ? 255 : g2;
          d[p2 + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        }
      }
    }
  }

  function updateSummary() {
    var adjusted = midV || shadowV || brightV || contrastV || sharpV ||
      (!autoOn && (blackPt > 0 || whitePt < 255));
    toneSummary.textContent = adjusted ? 'adjusted' : '';
  }

  function toneChanged() {
    clearTimeout(toneTimer);
    toneTimer = setTimeout(derive, 100);
  }

  // black/white points from the histogram, clipping 0.5% at each end
  function autoLevels() {
    var total = 0;
    for (var i = 0; i < 256; i++) total += hist[i];
    if (!total) return;
    var clip = total * 0.005;
    var sum = 0, lo = 0, hi = 255;
    for (var a = 0; a < 256; a++) { sum += hist[a]; if (sum > clip) { lo = a; break; } }
    sum = 0;
    for (var b = 255; b >= 0; b--) { sum += hist[b]; if (sum > clip) { hi = b; break; } }
    if (hi - lo < 16) { lo = 0; hi = 255; }
    blackPt = lo;
    whitePt = hi;
    positionHandles();
  }

  function positionHandles() {
    handleBlack.style.left = 'calc(' + (blackPt / 255 * 100) + '% - 5px)';
    handleWhite.style.left = 'calc(' + (whitePt / 255 * 100) + '% - 5px)';
    levelsVal.textContent = blackPt + ' · ' + whitePt;
  }

  function drawHist() {
    var cssW = histCanvas.clientWidth || 288;
    var dpr = window.devicePixelRatio || 1;
    histCanvas.width = Math.round(cssW * dpr);
    histCanvas.height = Math.round(40 * dpr);
    var hx = histCanvas.getContext('2d');
    var max = 0;
    for (var i = 0; i < 256; i++) if (hist[i] > max) max = hist[i];
    if (!max) return;
    hx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--ink-muted').trim() || '#888';
    var bw = histCanvas.width / 256;
    for (var v = 0; v < 256; v++) {
      var h = Math.round((hist[v] / max) * histCanvas.height);
      if (h) hx.fillRect(v * bw, histCanvas.height - h, Math.ceil(bw), h);
    }
    // dim the tones the current black/white points clip away
    hx.fillStyle = 'rgba(128,128,128,0.25)';
    hx.fillRect(0, 0, blackPt * bw, histCanvas.height);
    hx.fillRect((whitePt + 1) * bw, 0, histCanvas.width - (whitePt + 1) * bw, histCanvas.height);
  }

  function setAuto(on) {
    autoOn = on;
    autoBtn.classList.toggle('on', on);
  }

  autoBtn.addEventListener('click', function () {
    setAuto(!autoOn);
    if (autoOn && oriented) {
      autoLevels();      // from the stored histogram — no pixel pass
      drawHist();
      toneChanged();
    }
  });

  var levelDrag = null;

  function trackValue(e) {
    var r = levelTrack.getBoundingClientRect();
    var t = (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(255, Math.round(t * 255)));
  }

  levelTrack.addEventListener('pointerdown', function (e) {
    if (!oriented) return;
    e.preventDefault();
    levelTrack.setPointerCapture(e.pointerId);
    var v = trackValue(e);
    levelDrag = Math.abs(v - blackPt) <= Math.abs(v - whitePt) ? 'black' : 'white';
    setAuto(false);
    moveLevel(v);
  });
  levelTrack.addEventListener('pointermove', function (e) {
    if (levelDrag) moveLevel(trackValue(e));
  });
  levelTrack.addEventListener('pointerup', function () { levelDrag = null; });
  levelTrack.addEventListener('pointercancel', function () { levelDrag = null; });

  function moveLevel(v) {
    if (levelDrag === 'black') blackPt = Math.min(v, whitePt - 8);
    else whitePt = Math.max(v, blackPt + 8);
    positionHandles();
    drawHist();
    toneChanged();
  }

  // one binder per slider: input updates, double-click the label resets
  function toneSlider(name, setter) {
    var s = document.getElementById(name + 'Slider');
    var val = document.getElementById(name + 'Val');
    function show(v) { val.textContent = (v > 0 ? '+' : '') + v; }
    s.addEventListener('input', function () { setter(+this.value); show(+this.value); toneChanged(); });
    document.getElementById(name + 'Label').addEventListener('dblclick', function () {
      s.value = 0; setter(0); show(0); toneChanged();
    });
    return { reset: function () { s.value = 0; setter(0); val.textContent = '0'; } };
  }

  var toneCtl = {
    mid: toneSlider('mid', function (v) { midV = v; }),
    shadow: toneSlider('shadow', function (v) { shadowV = v; }),
    bright: toneSlider('bright', function (v) { brightV = v; }),
    contrast: toneSlider('contrast', function (v) { contrastV = v; }),
    sharp: toneSlider('sharp', function (v) { sharpV = v; }),
  };

  document.getElementById('levelsLabel').addEventListener('dblclick', function () {
    setAuto(false);
    blackPt = 0; whitePt = 255;
    positionHandles();
    drawHist();
    toneChanged();
  });

  document.getElementById('toneToggle').addEventListener('click', function () {
    toneBody.hidden = !toneBody.hidden;
    toneChev.innerHTML = toneBody.hidden ? '&#9656;' : '&#9662;';
    // the histogram canvas had no width while hidden — draw it now
    if (!toneBody.hidden && oriented) { drawHist(); }
  });

  // ---- phone tool dock: one panel at a time, iPhone-editor style ----
  // The chips only display under 720px; the classes are inert on desktop.

  function setPanel(name) {
    document.querySelectorAll('#toolDock button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.panel === name);
    });
    document.querySelectorAll('#photoTool .pnl').forEach(function (el) {
      el.classList.toggle('pnl-on', el.dataset.panel === name);
    });
    // crop takes over the stage: the roll hides so the canvas can go big
    document.getElementById('photoTool').classList.toggle('crop-mode', name === 'crop');
    if (!oriented) return;
    if (name === 'crop') drawEditor();     // canvases had no width while
    if (name === 'levels') drawHist();     // their panel was hidden
  }

  document.getElementById('toolDock').addEventListener('click', function (e) {
    var chip = e.target.closest('button');
    if (chip) setPanel(chip.dataset.panel);
  });

  function schedule(delay) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(preview, delay || 150);
  }

  function payload() {
    return {
      photoHeight: photoHeight,
      caption: caption.value.trim(),
      captionSize: captionSize,
      captionWeight: captionWeight,
    };
  }

  function preview() {
    if (!previewData || !TPL) return;
    statusEl.textContent = 'rendering…';
    var data = payload();
    data.photo = previewData;
    fetch('/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: TPL, data: data }),
    }).then(function (r) {
      if (!r.ok) throw new Error('render failed');
      return r.blob();
    }).then(function (blob) {
      var im = document.createElement('img');
      im.src = URL.createObjectURL(blob);
      // decode off-screen BEFORE swapping — removing the old image first
      // leaves a blank frame while the new one decodes (visible flicker)
      var ready = im.decode ? im.decode().catch(function () {}) : Promise.resolve();
      return ready.then(function () {
        empty.style.display = 'none';
        var old = roll.querySelector('img');
        if (old) { URL.revokeObjectURL(old.src); old.remove(); }
        roll.appendChild(im);
        printBtn.disabled = false;
        statusEl.textContent = '';
      });
    }).catch(function (e) {
      statusEl.textContent = e.message;
    });
  }

  input.addEventListener('change', function () { loadFile(input.files[0]); });
  cameraInput.addEventListener('change', function () { loadFile(cameraInput.files[0]); });
  dropzone.addEventListener('dragover', function (e) { e.preventDefault(); });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });
  caption.addEventListener('input', function () { if (previewData) schedule(350); });

  document.getElementById('capSize').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    captionSize = parseInt(btn.dataset.v, 10);
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); });
    if (previewData) schedule();
  });
  document.getElementById('capWeight').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    captionWeight = parseInt(btn.dataset.v, 10);
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); });
    if (previewData) schedule();
  });

  printBtn.addEventListener('click', function () {
    if (!oriented) return;
    printBtn.disabled = true;
    printBtn.textContent = 'Queuing…';
    // build the print version now: same crop/tone/sharpen as the preview,
    // plus the calibration curve — deferred here so slider moves don't pay
    // for a second JPEG encode
    var r = renderAdjusted();
    var d = r.pix.data;
    for (var p = 0; p < d.length; p += 4) {
      d[p] = LUT[d[p]];
      d[p + 1] = LUT[d[p + 1]];
      d[p + 2] = LUT[d[p + 2]];
    }
    r.ctx.putImageData(r.pix, 0, 0);
    var data = payload();
    data.photo = r.canvas.toDataURL('image/jpeg', 0.85);
    fetch('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: TPL,
        data: data,
        name: 'Photo Print',
        source: 'photo',
      }),
    }).then(function (r) { return r.json(); }).then(function (body) {
      statusEl.textContent = body.id ? 'queued ' + body.id : (body.error || 'failed');
    }).catch(function (e) {
      statusEl.textContent = e.message;
    }).finally(function () {
      printBtn.disabled = false;
      printBtn.textContent = 'Print';
    });
  });
  // ---- dispose (React unmount) ----
  return function dispose() {
    closeCamera();
    if (camWorker) { camWorker.terminate(); camWorker = null; }
    clearTimeout(debounceTimer);
    clearTimeout(toneTimer);
    window.removeEventListener('resize', onWinResize);
  };
}
