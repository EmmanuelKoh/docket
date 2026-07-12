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
  }

  let follow = true;
  wrap.addEventListener(
    'scroll',
    () => {
      follow = wrap.scrollLeft + wrap.clientWidth >= canvas.width - 8;
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
  let traceOff = document.createElement('canvas');
  traceOff.width = 4096;
  traceOff.height = TRACE_H;
  let traceOffCtx = traceOff.getContext('2d');
  let traceDirty = false;
  let traceCols = 1; // rightmost drawn column (linear mode extent)

  function traceY(midiFloat) {
    // G3 (55) at the bottom .. D6 (86) at the top
    return TRACE_H - ((midiFloat - 55) / (86 - 55)) * TRACE_H;
  }

  function growTraceOff(need) {
    if (need <= traceOff.width) return;
    const bigger = document.createElement('canvas');
    bigger.width = Math.max(need, traceOff.width * 2);
    bigger.height = TRACE_H;
    const c = bigger.getContext('2d');
    c.drawImage(traceOff, 0, 0);
    traceOff = bigger;
    traceOffCtx = c;
  }

  // aligned mode: one column per tape row (raw pitch sits directly
  // under the note bar it produced, but glyph/gap rows cut the audio);
  // linear mode: one continuous ribbon of time, traceZoom columns/sec
  function traceCol(tMs, liveCol) {
    if (traceMode === 'linear') return Math.round((tMs / 1000) * traceZoom);
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
    traceOffCtx.clearRect(0, 0, traceOff.width, TRACE_H);
    traceCols = 1;
    for (const f of frames) paintTraceFrame(f);
    paintTrace();
  }

  function paintTrace() {
    traceDirty = false;
    const cols =
      traceMode === 'linear' ? Math.max(1, traceCols) : Math.max(1, drawnRows);
    // linear mode may outgrow the tape; the roll scrolls to the widest
    const w = Math.max(canvas.width, Math.ceil(cols * SCALE));
    if (traceCanvas.width !== w) traceCanvas.width = w;
    if (traceCanvas.height !== TRACE_H) traceCanvas.height = TRACE_H;
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
      TRACE_H,
      0,
      0,
      cols * SCALE,
      TRACE_H,
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
    if (grew) {
      paintVisible();
      if (follow) wrap.scrollLeft = canvas.width;
    }
    if (grew || traceDirty) paintTrace();
    syncPlayhead();
  }

  // ---- scrubbing: the pointer position on the tape maps back to clip
  // time. Both canvases scrub (they share the x-axis); the wrap itself
  // is only hit via its scrollbar, which must keep scrolling. ----
  let scrubbing = false;

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

  wrap.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target === wrap) return;
      if (!hooks.isSeekable?.()) return;
      // clicking the tape also selects the note under the pointer
      // (hit-test by row range only — notes are monophonic, so time is
      // unambiguous; the trace pane below only seeks)
      if (e.target === canvas && renderer) {
        const rect = canvas.getBoundingClientRect();
        const row = (e.clientX - rect.left) / SCALE;
        const hit = renderer.notes.find((g) => row >= g.r0 && row <= g.r1);
        hooks.onSelect?.(hit ? hit.id : null);
      }
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
      if (scrubbing) seekToEvent(e);
    },
    opts,
  );
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    hooks.onScrubEnd?.();
  };
  wrap.addEventListener('pointerup', endScrub, opts);
  wrap.addEventListener('pointercancel', endScrub, opts);

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
    drawnRows = 0;
    offCtx.fillStyle = '#fff';
    offCtx.fillRect(0, 0, off.width, off.height);
    traceOffCtx.clearRect(0, 0, traceOff.width, TRACE_H);
    traceCols = 1;
    paintVisible();
    paintTrace();
  }

  // css-px band over a note's rows — the React selection overlay
  // (drawn as DOM over the preview; the canvas holds exact print bytes
  // and is never marked)
  function rectForNote(id) {
    if (!renderer || id === null || id === undefined) return null;
    const g = renderer.notes.find((n) => n.id === id);
    if (!g) return null;
    return {
      left: Math.round(g.r0 * SCALE),
      width: Math.max(2, Math.round((g.r1 - g.r0) * SCALE)),
      height: Math.round(576 * SCALE),
    };
  }

  raf = requestAnimationFrame(frame);

  return {
    attachRenderer(r) {
      renderer = r;
    },
    rectForNote,
    reset,
    paintTraceFrame,
    rebuildTrace,
    setTraceMode(m) {
      traceMode = m;
    },
    setTraceZoom(z) {
      traceZoom = z;
    },
    exportPng,
    dispose() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      aborter.abort();
    },
  };
}
