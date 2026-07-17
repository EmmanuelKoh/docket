// components/tape/tape-view.js — the imperative canvas island: the only
// code that touches the tape and trace canvases, the scroll container,
// and the playhead position. Everything else (controls, transport,
// status) is ordinary React over the store. The view knows nothing about
// audio or decoding; it paints whatever renderer it is attached to and
// reports pointer seeks upward through its hooks.
//
// hooks: {
//   getPlayback(): { t (sec), playing } — polled every frame
//   onTick(t)          — every animation frame (time display upstream)
//   isSeekable()       — gates scrubbing
//   onScrubStart() / onSeek(sec) / onScrubEnd()
//   onTruncated(bool)  — the preview hit its width cap
// }

const SCALE = 0.75; // preview px per printer dot
const MAX_VIS_W = 30000; // canvas width guard (~14 min of sounding tape)
const TRACE_H = 110;
const LIVE_TRACE_H = 320; // recording mode: the trace IS the screen

// Renderer rows → PNG bytes (printer orientation, like every History
// thumbnail). Standalone so the controller can thumbnail per-phrase
// renders that were never attached to the view.
export function rowsToPngBytes(rows) {
  return new Promise((resolve, reject) => {
    if (!rows.length) {
      reject(new Error('nothing to export'));
      return;
    }
    const crop = document.createElement('canvas');
    crop.width = 576;
    crop.height = rows.length;
    const cctx = crop.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, 576, rows.length);
    cctx.fillStyle = '#000';
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let xb = 0; xb < 72; xb++) {
        const byte = row[xb];
        if (!byte) continue;
        for (let b = 0; b < 8; b++) {
          if (byte & (0x80 >> b)) cctx.fillRect(xb * 8 + b, y, 1, 1);
        }
      }
    }
    crop.toBlob((blob) => {
      if (!blob) {
        reject(new Error('png export failed'));
        return;
      }
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, 'image/png');
  });
}

export function createTapeView({ canvas, traceCanvas, wrap, playhead, hooks }) {
  const aborter = new AbortController();
  const opts = { signal: aborter.signal };

  const ink =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--ink')
      .trim() || '#1a1a1a';
  const inkFaint =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--ink-faint')
      .trim() || '#999';
  const red =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--red')
      .trim() || '#b3261e';

  let renderer = null;
  let traceMode = 'aligned'; // 'aligned' (tape rows) | 'linear' (time)
  let traceZoom = 90; // linear-trace columns per second of audio
  let raf = 0;

  // ---- tape preview: offscreen canvas in PRINTER orientation (x = dot,
  // y = row), visible canvas draws it rotated into reading orientation
  // (time left→right, dot 0 at the bottom) via one transform. Dots are
  // ink on white paper in both themes, like every receipt preview. ----
  let off = document.createElement('canvas');
  off.width = 576;
  off.height = 4096;
  let offCtx = off.getContext('2d');
  offCtx.fillStyle = '#fff';
  offCtx.fillRect(0, 0, off.width, off.height);
  let drawnRows = 0;
  let truncated = false;

  function growOff(need) {
    if (need <= off.height) return;
    const bigger = document.createElement('canvas');
    bigger.width = 576;
    bigger.height = Math.max(need, off.height * 2);
    const c = bigger.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, bigger.width, bigger.height);
    c.drawImage(off, 0, 0);
    off = bigger;
    offCtx = c;
  }

  function drawNewRows() {
    if (!renderer || drawnRows >= renderer.rows.length) return false;
    growOff(renderer.rows.length);
    offCtx.fillStyle = '#000';
    for (let y = drawnRows; y < renderer.rows.length; y++) {
      const row = renderer.rows[y];
      for (let xb = 0; xb < 72; xb++) {
        const byte = row[xb];
        if (!byte) continue;
        for (let b = 0; b < 8; b++) {
          if (byte & (0x80 >> b)) offCtx.fillRect(xb * 8 + b, y, 1, 1);
        }
      }
    }
    drawnRows = renderer.rows.length;
    return true;
  }

  function paintVisible() {
    const fullW = Math.ceil(drawnRows * SCALE);
    const clipped = fullW > MAX_VIS_W;
    if (clipped !== truncated) {
      truncated = clipped;
      hooks.onTruncated?.(truncated);
    }
    const wantW = Math.min(MAX_VIS_W, Math.max(wrap.clientWidth, fullW));
    const wantH = Math.round(576 * SCALE);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // offscreen pixel (x, row) -> visible (row*SCALE, (576 - x)*SCALE)
    ctx.setTransform(0, -SCALE, SCALE, 0, 0, 576 * SCALE);
    ctx.drawImage(off, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSelectionHalo(ctx);
  }

  // ---- selection halo: a register-red contour TRACING the selected
  // glyph — the exact rectangle of a note's bar, the exact crescent of
  // an ornament arc — drawn over the repaint, never into the offscreen
  // (the print bytes and PNG exports stay pristine). The stroke sits
  // FLUSH against the ink: inner edge touching, no air, no rounding
  // the shape doesn't have. Printer (row, dot) maps to visible
  // (row*SCALE, (576-dot)*SCALE). ----
  let selectedId = null;
  const NOTE_HALO_W = 2.25; // note outline stroke, css px (a hair thicker)
  const HALO_W = 1.5; // arc outline width, css px
  let haloInk = null; // scratch: the arc's reconstructed ink
  let haloRing = null; // scratch: dilated ink minus ink = the outline

  function drawSelectionHalo(ctx) {
    if (!selectedId || !renderer) return;
    const note = renderer.notes.find((n) => n.id === selectedId);
    if (note) {
      // the bar is a sharp rectangle — outline it exactly, grown by
      // half the stroke so the stroke's inner edge kisses the ink
      ctx.strokeStyle = red;
      ctx.lineWidth = NOTE_HALO_W;
      ctx.strokeRect(
        note.r0 * SCALE - NOTE_HALO_W / 2,
        (576 - note.x1 - 1) * SCALE - NOTE_HALO_W / 2,
        (note.r1 - note.r0) * SCALE + NOTE_HALO_W,
        (note.x1 - note.x0 + 1) * SCALE + NOTE_HALO_W,
      );
      return;
    }
    const mark = (renderer.marks ?? []).find((m) => m.id === selectedId);
    if (!mark) return;
    // The arc's ink is NOT a uniform circular stroke (two half-curves
    // thickened along the dot axis, swelling 2→6 dots through the
    // belly), so no analytic ring hugs it. Reconstruct the exact ink
    // with the same math paintOrnamentArc prints with, then outline it
    // by dilation: the ink stamped at offsets around a small circle,
    // minus the ink itself — a flush contour of the true shape.
    const OPEN_COS = Math.cos((125 * Math.PI) / 180);
    const r = mark.rad;
    const pad = Math.ceil(HALO_W) + 2;
    const w = Math.ceil((2 * r + 1) * SCALE) + 2 * pad;
    const h = Math.ceil((2 * r + 7) * SCALE) + 2 * pad;
    if (!haloInk) {
      haloInk = document.createElement('canvas');
      haloRing = document.createElement('canvas');
    }
    if (haloInk.width < w || haloInk.height < h) {
      haloInk.width = haloRing.width = w;
      haloInk.height = haloRing.height = h;
    }
    const ink = haloInk.getContext('2d');
    ink.clearRect(0, 0, haloInk.width, haloInk.height);
    ink.fillStyle = red;
    // local frame: gx along rows, dots relative to the circle center
    // cx (top of frame = cx + r + 3, half the widest stroke past the
    // circle); y flips like the tape does
    const topDot = r + 3;
    for (let gx = 0; gx <= 2 * r; gx++) {
      const dx = gx - r;
      if (dx / r < OPEN_COS) continue;
      const span = Math.sqrt(Math.max(0, r * r - dx * dx));
      const t = Math.round(2 + 4 * Math.max(0, dx / r));
      for (const dy of [span, -span]) {
        const d0 = Math.round(dy) - (t >> 1); // ink dots d0..d0+t-1
        // a dot D's pixel spans y [(top-D-1)·S, (top-D)·S) after the flip
        ink.fillRect(
          gx * SCALE + pad,
          (topDot - d0 - t) * SCALE + pad,
          SCALE,
          t * SCALE,
        );
      }
    }
    const ring = haloRing.getContext('2d');
    ring.clearRect(0, 0, haloRing.width, haloRing.height);
    ring.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      ring.drawImage(haloInk, HALO_W * Math.cos(a), HALO_W * Math.sin(a));
    }
    ring.globalCompositeOperation = 'destination-out';
    ring.drawImage(haloInk, 0, 0);
    ctx.drawImage(
      haloRing,
      (mark.cr - r) * SCALE - pad,
      (576 - (mark.cx + topDot)) * SCALE - pad,
    );
  }

  let follow = true;
  // a re-render of a finished take must not feel like fresh paper: the
  // controller captures the scroll before resetting and restores it here.
  // Applied on the frame the new rows paint (the reset shrinks the canvas
  // and re-arms `follow` via the clamped scroll event, so an immediate
  // scrollLeft write would lose the race).
  let pendingScroll = null;
  wrap.addEventListener(
    'scroll',
    () => {
      // scrollWidth covers whichever pane is widest (tape, or the live
      // trace while recording, when the tape canvas is hidden)
      follow = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 8;
    },
    opts,
  );

  // the roll's width changes after mount (the app sidebar collapses on
  // entry) and on window resizes — repaint so the canvases keep filling
  // it instead of leaving a stale-width notch of roll background
  const resizeObserver = new ResizeObserver(() => {
    paintVisible();
    paintTrace();
  });
  resizeObserver.observe(wrap);

  // ---- pitch trace: the raw-pitch pane riding under the tape in the
  // same scroll container, sharing its x-axis — each detector frame
  // draws at the tape row the renderer had just emitted, so the pitch
  // that produced a note bar sits directly below that bar at any scroll
  // position (and the playhead crosses both panes). Dots accumulate in
  // an offscreen at 1px per tape row; the visible canvas repaints
  // scaled to match the tape, with the reference rows drawn full-width.
  // Like the tape, the x-axis is SOUNDING time: silence doesn't advance,
  // so low-clarity dots during a rest pile into one column. ----
  const traceCtx = traceCanvas.getContext('2d');
  let liveTrace = false; // recording: full-height trace, linear time
  let traceH = TRACE_H;
  let traceOff = document.createElement('canvas');
  traceOff.width = 4096;
  traceOff.height = traceH;
  let traceOffCtx = traceOff.getContext('2d');
  let traceDirty = false;
  let traceCols = 1; // rightmost drawn column (linear mode extent)

  function traceY(midiFloat) {
    // G3 (55) at the bottom .. D6 (86) at the top
    return traceH - ((midiFloat - 55) / (86 - 55)) * traceH;
  }

  function growTraceOff(need) {
    if (need <= traceOff.width) return;
    const bigger = document.createElement('canvas');
    bigger.width = Math.max(need, traceOff.width * 2);
    bigger.height = traceH;
    const c = bigger.getContext('2d');
    c.drawImage(traceOff, 0, 0);
    traceOff = bigger;
    traceOffCtx = c;
  }

  // aligned mode: one column per tape row (raw pitch sits directly
  // under the note bar it produced, but glyph/gap rows cut the audio);
  // linear mode: one continuous ribbon of time, traceZoom columns/sec.
  // Recording is always linear — there is no tape to align to.
  function traceCol(tMs, liveCol) {
    if (traceMode === 'linear' || liveTrace) {
      return Math.round((tMs / 1000) * traceZoom);
    }
    if (liveCol !== null && liveCol !== undefined) return liveCol;
    return renderer ? renderer.rowForTime(tMs) : 0;
  }

  // paint one detector frame { t, freq, clarity, sounding } — the
  // controller owns the frame list; the view only draws
  function paintTraceFrame(f, liveCol = null) {
    const x = Math.max(0, traceCol(f.t, liveCol));
    traceCols = Math.max(traceCols, x + 1);
    growTraceOff(x + 1);
    if (f.freq) {
      const mf = 69 + 12 * Math.log2(f.freq / 440);
      traceOffCtx.globalAlpha = Math.max(0.15, f.clarity * f.clarity);
      traceOffCtx.fillStyle = ink;
      traceOffCtx.fillRect(x, traceY(mf) - 1, 1, 3);
      traceOffCtx.globalAlpha = 1;
    }
    if (f.sounding !== null && f.sounding !== undefined) {
      traceOffCtx.fillStyle = inkFaint;
      traceOffCtx.fillRect(x, traceY(f.sounding), 1, 1);
    }
    traceDirty = true;
  }

  // redraw the whole trace from stored frames — used when the mode or
  // zoom changes, or when the tape is re-rendered (aligned columns move)
  function rebuildTrace(frames) {
    traceOffCtx.clearRect(0, 0, traceOff.width, traceH);
    traceCols = 1;
    for (const f of frames) paintTraceFrame(f);
    paintTrace();
  }

  function paintTrace() {
    traceDirty = false;
    const cols =
      traceMode === 'linear' || liveTrace
        ? Math.max(1, traceCols)
        : Math.max(1, drawnRows);
    // linear mode may outgrow the tape; the roll scrolls to the widest.
    // While recording the tape canvas is hidden — fill the viewport.
    const base = liveTrace ? wrap.clientWidth : canvas.width;
    const w = Math.max(base, Math.ceil(cols * SCALE));
    if (traceCanvas.width !== w) traceCanvas.width = w;
    if (traceCanvas.height !== traceH) traceCanvas.height = traceH;
    traceCtx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
    // faint reference rows at A3 / A4 / A5, the duduk-in-A anchors
    traceCtx.globalAlpha = 0.3;
    traceCtx.fillStyle = inkFaint;
    for (const m of [57, 69, 81]) {
      traceCtx.fillRect(0, traceY(m), traceCanvas.width, 1);
    }
    traceCtx.globalAlpha = 1;
    traceCtx.drawImage(
      traceOff,
      0,
      0,
      cols,
      traceH,
      0,
      0,
      cols * SCALE,
      traceH,
    );
  }

  // ---- playhead: a DOM overlay the view positions each frame; React
  // owns its visibility and live/paused styling from the store ----
  function syncPlayhead() {
    if (!renderer || !hooks.getPlayback) return;
    const { t, playing } = hooks.getPlayback();
    hooks.onTick?.(t);
    const x = Math.round(renderer.rowForTime(t * 1000) * SCALE);
    playhead.style.left = `${x}px`;
    if (playing) {
      // keep the bar in view; center it when it walks off either edge
      const view = wrap.clientWidth;
      if (x < wrap.scrollLeft + 16 || x > wrap.scrollLeft + view - 48) {
        wrap.scrollLeft = Math.max(0, x - view / 2);
      }
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const grew = drawNewRows();
    if (grew) paintVisible();
    const traceGrew = traceDirty;
    if (grew || traceDirty) paintTrace();
    if (pendingScroll !== null) {
      if (grew) {
        wrap.scrollLeft = pendingScroll;
        pendingScroll = null;
      }
    } else if (follow) {
      if (grew) wrap.scrollLeft = canvas.width;
      else if (liveTrace && traceGrew) wrap.scrollLeft = traceCanvas.width;
    }
    syncPlayhead();
  }

  // ---- scrubbing: the pointer position on the tape maps back to clip
  // time. Both canvases scrub (they share the x-axis); the wrap itself
  // is only hit via its scrollbar, which must keep scrolling. Touch is
  // different: a drag pans the roll natively (touch-action: pan-x) and
  // only a TAP seeks/selects — a phone has no scrollbar to grab, so the
  // drag gesture belongs to navigation, not the scrub. ----
  let scrubbing = false;
  let touchTap = null; // { id, x, y } — tap candidate; a real drag pans

  function seekToEvent(e) {
    if (!renderer) return;
    // a linear-mode trace has its own time axis; the tape keeps the
    // row-mapped one
    if (traceMode === 'linear' && e.target === traceCanvas) {
      const rect = traceCanvas.getBoundingClientRect();
      hooks.onSeek?.((e.clientX - rect.left) / SCALE / traceZoom);
    } else {
      const rect = canvas.getBoundingClientRect();
      const row = (e.clientX - rect.left) / SCALE;
      hooks.onSeek?.(renderer.timeForRow(row) / 1000);
    }
  }

  // the note or ornament mark under the pointer, on the tape canvas only
  // (the trace pane just seeks). Notes are monophonic so a row range is
  // unambiguous; marks float above the note band, so they hit-test on
  // both axes and win when the pointer is inside their little box.
  // slackPx forgives a near-miss (fat fingers, 2px-wide grace notes).
  // undefined = not a selection surface; null = paper (clear selection)
  function noteIdAt(e, slackPx) {
    if (e.target !== canvas || !renderer) return undefined;
    const rect = canvas.getBoundingClientRect();
    const row = (e.clientX - rect.left) / SCALE;
    // visible y maps back to the printer dot axis (see paintVisible)
    const dot = 576 - (e.clientY - rect.top) / SCALE;
    const slack = (slackPx || 0) / SCALE;
    const mark = (renderer.marks ?? []).find(
      (m) =>
        row >= m.r0 - slack &&
        row <= m.r1 + slack &&
        dot >= m.x0 - slack &&
        dot <= m.x1 + slack,
    );
    if (mark) return mark.id;
    const hit = renderer.notes.find((g) => row >= g.r0 && row <= g.r1);
    if (hit) return hit.id;
    if (slackPx) {
      let best = null;
      let bestD = slackPx / SCALE;
      for (const g of renderer.notes) {
        const d = row < g.r0 ? g.r0 - row : row - g.r1;
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
      if (best) return best.id;
    }
    return null;
  }

  wrap.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target === wrap) return;
      if (!hooks.isSeekable?.()) return;
      if (e.pointerType === 'touch') {
        touchTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return; // no capture: the browser may claim the drag as a pan
      }
      const id = noteIdAt(e, 0);
      if (id !== undefined) hooks.onSelect?.(id);
      scrubbing = true;
      hooks.onScrubStart?.();
      wrap.setPointerCapture(e.pointerId);
      seekToEvent(e);
    },
    opts,
  );
  wrap.addEventListener(
    'pointermove',
    (e) => {
      if (touchTap && e.pointerId === touchTap.id) {
        const dx = e.clientX - touchTap.x;
        const dy = e.clientY - touchTap.y;
        if (dx * dx + dy * dy > 100) touchTap = null; // it's a drag
      }
      if (scrubbing) seekToEvent(e);
    },
    opts,
  );
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    hooks.onScrubEnd?.();
  };
  wrap.addEventListener(
    'pointerup',
    (e) => {
      if (touchTap && e.pointerId === touchTap.id) {
        touchTap = null;
        const id = noteIdAt(e, 24);
        if (id !== undefined) hooks.onSelect?.(id);
        seekToEvent(e); // a plain seek: playback keeps its state
      }
      endScrub();
    },
    opts,
  );
  wrap.addEventListener(
    'pointercancel',
    () => {
      touchTap = null; // the browser took the gesture (pan/zoom)
      endScrub();
    },
    opts,
  );

  // ---- print/thumbnail export: the exact offscreen rows as a PNG
  // (printer orientation, like every History thumbnail) ----
  function exportPng() {
    const height = renderer ? renderer.rows.length : 0;
    return new Promise((resolve, reject) => {
      if (!height) {
        reject(new Error('nothing to export'));
        return;
      }
      const crop = document.createElement('canvas');
      crop.width = 576;
      crop.height = height;
      const cctx = crop.getContext('2d');
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, 576, height);
      cctx.drawImage(off, 0, 0);
      crop.toBlob((blob) => {
        if (!blob) {
          reject(new Error('png export failed'));
          return;
        }
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      }, 'image/png');
    });
  }

  function reset() {
    pendingScroll = null; // re-armed by restoreScroll after the re-feed
    selectedId = null; // re-armed by setSelected after the re-feed
    drawnRows = 0;
    offCtx.fillStyle = '#fff';
    offCtx.fillRect(0, 0, off.width, off.height);
    traceOffCtx.clearRect(0, 0, traceOff.width, traceH);
    traceCols = 1;
    paintVisible();
    paintTrace();
  }

  // css-px box hugging a note's bar (or an ornament arc) — the React
  // selection overlay (drawn as DOM over the preview; the canvas holds
  // exact print bytes and is never marked). Rows map to x, dots map to
  // y flipped (see paintVisible); a few dots of breathing room all
  // around, clamped to the paper.
  function rectForNote(id) {
    if (!renderer || id === null || id === undefined) return null;
    const g =
      renderer.notes.find((n) => n.id === id) ??
      (renderer.marks ?? []).find((m) => m.id === id);
    if (!g) return null;
    const PAD = 6; // dots/rows of air between the glyph and the border
    const r0 = Math.max(0, g.r0 - PAD);
    const r1 = g.r1 + PAD;
    const dotTop = Math.min(576, g.x1 + PAD);
    const dotBot = Math.max(0, g.x0 - PAD);
    return {
      left: Math.round(r0 * SCALE),
      width: Math.max(2, Math.round((r1 - r0) * SCALE)),
      top: Math.round((576 - dotTop) * SCALE),
      height: Math.max(2, Math.round((dotTop - dotBot) * SCALE)),
    };
  }

  // bring a css-px span (e.g. the selection band) into the viewport —
  // keyboard note-walking must not leave the selection off-screen
  function reveal(left, width) {
    const view = wrap.clientWidth;
    if (
      left < wrap.scrollLeft + 16 ||
      left + width > wrap.scrollLeft + view - 16
    ) {
      wrap.scrollLeft = Math.max(0, left + width / 2 - view / 2);
    }
  }

  raf = requestAnimationFrame(frame);

  return {
    attachRenderer(r) {
      renderer = r;
    },
    rectForNote,
    reveal,
    reset,
    // the halo tracks the selection; null clears it
    setSelected(id) {
      if (selectedId === (id ?? null)) return;
      selectedId = id ?? null;
      paintVisible();
    },
    getScroll: () => wrap.scrollLeft,
    restoreScroll(x) {
      pendingScroll = x;
      follow = false;
    },
    paintTraceFrame,
    rebuildTrace,
    setTraceMode(m) {
      traceMode = m;
    },
    setTraceZoom(z) {
      traceZoom = z;
    },
    // recording mode: the trace becomes the whole screen — full height,
    // linear time. The offscreen accumulates at a fixed height, so
    // toggling swaps it; the caller rebuilds from its frame list.
    setLiveTrace(on) {
      if (liveTrace === on) return;
      liveTrace = on;
      traceH = on ? LIVE_TRACE_H : TRACE_H;
      traceOff = document.createElement('canvas');
      traceOff.width = 4096;
      traceOff.height = traceH;
      traceOffCtx = traceOff.getContext('2d');
      traceCols = 1;
      follow = true;
      pendingScroll = null;
      traceDirty = true;
    },
    exportPng,
    dispose() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      aborter.abort();
    },
  };
}
