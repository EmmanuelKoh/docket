// components/tape/controller.js — the Tape tool's orchestrator. Owns the
// session objects (recorder, analyzer, player, view, renderer, tracker,
// take document) and the flow between them; writes every UI-visible fact
// into the store (store.js) for React to render. React handlers call the
// methods returned here — nothing in this file touches control DOM.
//
// Pipeline (all in the browser). LIVE: mic → audio-io.js (decimated,
// high-passed PCM) → analyzer.js (pitch worker windows) → the raw pitch
// trace, drawn full-height in linear time (the recording screen). The
// paper stays blank while recording: the tape is only ever written by
// the real transcription, never sketched. FINAL: on Stop / Load clip,
// the recording is transcribed by
// Basic Pitch (decode.js) and interpreted into a take document
// (doc.mjs — the same pass-1/2/3 modules the eval corpus scores), then
// fed to the tape renderer (components/tape-renderer.js) → exact printer
// rows, painted by tape-view.js and sent verbatim to /api/tape/print.
// The preview IS the print bytes; there is no parallel rendering.

import { createNoteTracker } from '@/components/tape-events.js';
import {
  createTapeRenderer,
  mughamKey,
  noteLabel,
} from '@/components/tape-renderer.js';

import { createAnalyzer } from './analyzer.js';
import { createRecorder, synthDemoPcm } from './audio-io.js';
import { transcribe } from './decode.js';
import {
  applyEdit,
  isFrozen,
  reDerive,
  redo,
  skeletonOf,
  undo,
} from './doc.mjs';
import {
  deleteTake as apiDeleteTake,
  loadTake as apiLoadTake,
  restoreTake as apiRestoreTake,
  saveTake as apiSaveTake,
  updateTake as apiUpdateTake,
  fetchTakes,
} from './persist.js';
import { createPlayer } from './playback.js';
import {
  addCut,
  assembled,
  createSong,
  mainCount,
  phraseOfId,
  phraseWindow,
  removeCut,
  sliceFrames,
  songFromDoc,
  withPhrase,
} from './song.mjs';
import { tapeStore } from './store';
import { createTapeView, rowsToPngBytes } from './tape-view.js';

const WINDOW = 1024; // analysis window (samples at ~22 kHz ≈ 46 ms)
const HOP = 256; // analysis hop (≈ 12 ms → ~86 frames/s)

// fixed live-tracker settings: the tracker only steadies the live
// analysis now (holdF0, the sounding dot on the trace) — it never
// writes tape; the neural transcription estimates tuning on its own
function trackerValues() {
  return {
    clarityMin: 0.5,
    tuningCents: 0,
    onsetHoldMs: 50,
    retrigCents: 60,
    changeHoldMs: 80,
    changeFastMs: 30,
    ornamentCents: 45,
    restFrac: 0.18,
    offMs: 110,
  };
}

export function createTapeController({ canvas, traceCanvas, wrap, playhead }) {
  const set = tapeStore.setState;
  const get = tapeStore.getState;
  const settings = () => get().settings;

  // fresh session: clear the transient half of the (persistent) store
  set({
    micOn: false,
    decoding: false,
    status: '',
    playState: 'stopped',
    playTime: 0,
    clipDur: 0,
    hasAudio: false,
    canPrint: false,
    printState: 'idle',
    truncated: false,
    hasTake: false,
    selection: null,
    selectionRect: null,
    editCount: 0,
    redoCount: 0,
    frozen: false,
    persistBusy: false,
    currentTake: null,
    lastDeleted: null,
    phrases: [],
    activePhrase: 0,
    cuts: [],
    phraseView: 'song', // a fresh session opens on the Song tab
  });

  const recorder = createRecorder();
  const analyzer = createAnalyzer();

  let renderer = null;
  let tracker = null;
  let song = null; // the song document (song.mjs) of the newest decode
  let disposed = false;

  let traceFrames = []; // every analyzed frame, for redraw + ornament marks
  let cursor = 0; // next analysis window start (samples)
  let inFlight = false; // one live window in the pitch worker at a time
  let analysisGen = 0; // bumped per take: stale analyses and backfills quit
  let decoding = false;
  let deriveStale = false; // derivation inputs changed (floor / fine frames)
  let pendingFloor = null; // { k, hz } — active phrase's floor moved
  let pendingRerender = false; // re-render deferred while audio plays

  // the phrase the Detection slider, inspector undo/redo, and focus
  // view act on — follows chip clicks and note selection
  const activeIdx = () =>
    song ? Math.min(get().activePhrase, song.phrases.length - 1) : 0;
  const activePhraseDoc = () => (song ? song.phrases[activeIdx()] : null);

  // a phrase's playback window in clip seconds
  function windowSecs(k) {
    const [a, b] = phraseWindow(song, k);
    return [
      Number.isFinite(a) ? a : 0,
      Number.isFinite(b) ? b : recorder.seconds,
    ];
  }

  // ---- player ----
  const player = createPlayer({
    getSamples: () => recorder.samples(),
    getRate: () => recorder.sampleRate,
    onChange(state) {
      set({ playState: state, playTime: player.pos() });
      if (state !== 'playing') applyPendingRerender();
    },
  });

  // ---- view (the canvas island) ----
  let scrubWasPlaying = false;
  let lastTick = -1;
  const view = createTapeView({
    canvas,
    traceCanvas,
    wrap,
    playhead,
    hooks: {
      getPlayback: () => ({
        t: player.pos(),
        playing: player.state === 'playing',
      }),
      onTick(t) {
        if (Math.abs(t - lastTick) >= 0.01) {
          lastTick = t;
          set({ playTime: t });
        }
        if (recorder.micOn) {
          // the time display counts the growing recording
          const d = recorder.seconds;
          if (Math.abs(d - get().clipDur) >= 0.1) set({ clipDur: d });
        }
      },
      isSeekable: () => recorder.length > 0 && !recorder.micOn && !decoding,
      onScrubStart() {
        scrubWasPlaying = player.state === 'playing';
        if (scrubWasPlaying) player.pause(); // drag pauses, release resumes
      },
      onSeek: (sec) => player.seek(sec),
      onScrubEnd() {
        if (scrubWasPlaying) player.play();
        scrubWasPlaying = false;
      },
      onSelect: (id) => selectNote(id),
      onTruncated: (v) => set({ truncated: v }),
    },
  });

  function syncAudioState() {
    set({ hasAudio: recorder.length > 0, clipDur: recorder.seconds });
  }

  function layoutValues() {
    const s = settings();
    return {
      msPerRow: s.msPerRow,
      staffGap: s.staffGap,
      noteDots: s.noteDots,
      glyphScale: s.glyphScale,
      breathGapMs: s.breathGapMs,
      keySig: s.keySig,
    };
  }

  // ---- fresh take ----
  let evQueue = []; // note events awaiting the renderer (renderTimeline)

  function resetTake(clearRecording) {
    renderer = createTapeRenderer(layoutValues());
    tracker = createNoteTracker(trackerValues());
    view.attachRenderer(renderer);
    cursor = 0;
    traceFrames = [];
    analysisGen++; // stale backfills and live windows quit
    pendingRerender = false; // any queued re-render is now stale
    evQueue = [];
    view.reset();
    if (clearRecording) recorder.reset();
    set({
      canPrint: false,
      hasTake: false,
      selection: null,
      selectionRect: null,
    });
    // the audio only changes when the recording is cleared/replaced —
    // re-renders of the same take keep the player's position and cached
    // buffer (the playhead mapping recomputes against the new rows), so
    // an edit doesn't yank the playhead back to zero. A cleared
    // recording also unties the session from its saved take.
    if (clearRecording) {
      player.invalidate();
      set({ currentTake: null });
    } else {
      player.stop(true);
    }
    syncAudioState();
  }

  // ---- selection: the note the inspector edits. The store carries a
  // snapshot (label, times, flags) plus the preview band rect; both are
  // rebuilt here after every render, because renders replace the
  // renderer and its geometry. An id that no longer exists (removed,
  // re-derived, skeleton view) simply clears the selection. ----
  function selectNote(id) {
    if (!song || !id) {
      view.setSelected(null);
      set({ selection: null, selectionRect: null });
      return;
    }
    // `<noteId>@arc` selects a note's ornament-FLAG arc (minted by the
    // renderer so both arc kinds click the same); resolve to the owner
    const arcOwner = id.endsWith('@arc') ? id.slice(0, -4) : null;
    const lookupId = arcOwner ?? id;
    const k = phraseOfId(song, lookupId);
    const timeline = k >= 0 ? song.phrases[k].timeline : [];
    const entry = timeline.find((e) => e.id === lookupId);
    const rect = view.rectForNote(id);
    if (!entry || !rect) {
      view.setSelected(null);
      set({ selection: null, selectionRect: null });
      return;
    }
    view.setSelected(id); // the red contour on the tape
    if (k !== get().activePhrase) setActivePhraseState(k); // selection
    // activates its phrase — the slider/undo/freeze follow the click
    if (entry.mark || arcOwner) {
      // an ornament arc — standalone mark or a note's flag arc: both
      // select the same way and offer only Remove (the flag arc's
      // removal is a toggleOrnament on its owner, see removeNote)
      set({
        selection: {
          id,
          mark: true,
          flagArc: arcOwner ?? undefined,
          label: 'ornament',
          midi: 0,
          t0: entry.t0,
          t1: entry.mark ? entry.t0 : entry.t1,
          grace: false,
          ornament: false,
          slide: false,
          canJoin: false,
        },
        selectionRect: rect,
      });
      return;
    }
    const after = timeline.slice(timeline.indexOf(entry) + 1);
    set({
      selection: {
        id,
        label: noteLabel(entry.midi, renderer.config.keySig),
        midi: entry.midi,
        t0: entry.t0,
        t1: entry.t1,
        grace: !!entry.grace,
        ornament: !!entry.ornament,
        slide: !!entry.slide,
        canJoin: after.some((e) => !e.mark), // joins stay in the phrase
      },
      selectionRect: rect,
    });
  }

  // mirror the active phrase's floor and edit history into the store
  // (the Detection slider and undo/redo are phrase-scoped)
  function setActivePhraseState(k) {
    const p = song.phrases[k];
    set((s) => ({
      activePhrase: k,
      editCount: p.edits.length,
      redoCount: p.redoStack.length,
      frozen: isFrozen(p),
      settings: { ...s.settings, melodyFloor: p.decode.melodyFloorHz },
    }));
  }

  // chip metadata for the phrase strip, plus the active mirror above
  function syncPhraseState() {
    if (!song) {
      set({ phrases: [], activePhrase: 0, cuts: [] });
      return;
    }
    const metas = song.phrases.map((p, k) => {
      const [a, b] = windowSecs(k);
      return {
        t0: a,
        t1: b,
        noteCount: p.timeline.filter((e) => !e.mark).length,
        editCount: p.edits.length,
        frozen: isFrozen(p),
        floor: p.decode.melodyFloorHz,
      };
    });
    set({ phrases: metas, cuts: song.cuts });
    setActivePhraseState(activeIdx());
  }

  // ---- rendering: drain queued note events into the renderer. Only
  // renderTimeline fills the queue now (from the decoded document) —
  // nothing is sketched onto the paper while recording. ----
  function feedRenderer(horizonMs) {
    while (evQueue.length && evQueue[0].tMs <= horizonMs) {
      const e = evQueue.shift();
      renderer.advance(e.tMs);
      if (e.type === 'mark') {
        renderer.markNow(e.id); // time-anchored ornament arc
      } else if (e.type === 'caesura') {
        renderer.caesura(); // phrase cut — printed railroad tracks
      } else if (e.type === 'on') {
        renderer.noteOn(e.midi, e.tMs, e.grace, {
          slide: e.slide,
          ornament: e.ornament,
          id: e.id,
        });
      } else {
        renderer.noteOff(e.tMs);
      }
    }
    renderer.advance(horizonMs);
    if (renderer.rows.length && !get().canPrint) set({ canPrint: true });
  }

  // one analyzed frame while recording: feed the tracker (it steadies
  // the analysis via holdF0 and marks the held note on the trace) and
  // draw the frame onto the live trace. Its note events are discarded —
  // the tape waits for the real transcription.
  function applyFrame(m) {
    tracker.push({
      tMs: m.t,
      freq: m.freq,
      clarity: m.clarity,
      energy: m.energy,
    });
    const frame = {
      t: m.t,
      freq: m.freq,
      clarity: m.clarity,
      energy: m.energy,
      sounding: tracker.sounding,
    };
    traceFrames.push(frame);
    view.paintTraceFrame(frame);
  }

  // holdF0 tells the harmonic detector which comb is the melody being
  // tracked right now, so its background never learns (eats) a long
  // held note.
  function holdFreq(trk) {
    if (!trk || trk.sounding === null) return 0;
    return 440 * 2 ** ((trk.sounding - 69) / 12);
  }

  // ---- live analysis pump: recorded blocks → pitch worker → tracker ----
  function pumpAnalysis() {
    if (inFlight || decoding) return;
    if (recorder.length - cursor < WINDOW) return;
    const win = new Float32Array(WINDOW);
    win.set(recorder.samples().subarray(cursor, cursor + WINDOW));
    const t = ((cursor + WINDOW) / recorder.sampleRate) * 1000;
    cursor += HOP;
    inFlight = true;
    const gen = analysisGen;
    analyzer
      .analyze(win, {
        sr: recorder.sampleRate,
        t,
        mode: 'harm', // harmonic-salience: drone-robust
        fMin: settings().melodyFloor,
        gen,
        holdF0: holdFreq(tracker),
      })
      .then((m) => {
        inFlight = false;
        // null = analyzer disposed; stale gen = a new take started
        if (!m || disposed || gen !== analysisGen) return;
        applyFrame(m);
        pumpAnalysis();
      });
  }

  // ---- mic session. The screen wake lock keeps a phone from killing
  // the mic stream mid-take when its display sleeps; best-effort only
  // (unsupported browsers just record with the usual screen timeout). ----
  let wakeLock = null;
  async function acquireWakeLock() {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLock = null;
    }
  }
  function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
  // the lock is auto-released when the tab hides; re-acquire on return
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && recorder.micOn) {
      acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  async function startMic() {
    resetTake(true);
    set({ status: 'starting mic…' });
    try {
      await recorder.startMic({
        onBlock: pumpAnalysis,
        // a capped take still decodes — same as pressing Stop
        onCap: () => {
          stopMic('recording stopped — 10 minute limit');
          if (recorder.length > recorder.sampleRate) neuralDecode();
        },
      });
      view.setLiveTrace(true);
      acquireWakeLock();
      set({ micOn: true, status: 'recording…' });
    } catch (e) {
      set({ status: `mic failed: ${e.message}` });
    }
  }

  function stopMic(reason) {
    recorder.stopMic();
    releaseWakeLock();
    // back to the strip-height trace; the decode's backfill redraws it
    view.setLiveTrace(false);
    view.rebuildTrace([]);
    set({
      micOn: false,
      status:
        reason ||
        (recorder.length
          ? `stopped — ${recorder.seconds.toFixed(1)}s recorded`
          : 'stopped'),
    });
    syncAudioState();
  }

  // ---- neural decode (transcription v2, see docs/
  // tape-transcription-v2.md): runs on Stop and Load clip. The live
  // tracker above is only the real-time sketch; this is the tape. ----
  async function neuralDecode() {
    if (recorder.micOn || decoding || recorder.length < recorder.sampleRate / 2)
      return;
    decoding = true;
    set({ decoding: true });
    resetTake(false);
    try {
      const notes = await transcribe({
        samples: recorder.samples(),
        sampleRate: recorder.sampleRate,
        onStatus: (msg) => set({ status: msg }),
      });
      song = createSong({
        notes,
        melodyFloorHz: settings().melodyFloor,
        fineFrames: [],
        createdAt: Date.now(),
      });
      deriveStale = false;
      pendingFloor = null;
      set({ activePhrase: 0, phraseView: 'song' });
      const mains = renderTimeline();
      // the tape itself is the answer — except when it's empty, which
      // deserves an explanation (quiet take, or the floor is set high)
      set({
        status: mains
          ? ''
          : `no notes found — the melody floor is at ${settings().melodyFloor} Hz; try lowering it, or record closer to the mic`,
        hasTake: true,
      });
      syncPhraseState();
    } catch (e) {
      set({ status: `transcription failed: ${e.message}` });
    }
    decoding = false;
    set({ decoding: false });
    syncAudioState();
    traceBackfill(); // fill the raw-pitch trace under the finished tape
  }

  // render the song into the tape. Scope: the whole song (phrases
  // stitched in time order, caesura marks at cuts) or, in focus view,
  // just the active phrase. 'skeleton' = pass 1 only per phrase.
  // At equal times a caesura must land after the closing note and
  // before the opening one.
  const EV_RANK = { off: 0, caesura: 1, mark: 2, on: 3 };

  function renderTimeline() {
    const focus = get().phraseView === 'focus';
    const k = activeIdx();
    const scope = focus ? [song.phrases[k]] : song.phrases;
    const timeline =
      get().viewMode === 'skeleton'
        ? scope.flatMap((p) => skeletonOf(p))
        : scope.flatMap((p) => p.timeline);
    for (const n of timeline) {
      if (n.mark) {
        // a time-anchored ornament arc, not a note; the id makes it
        // selectable (and deletable) on the tape
        evQueue.push({ type: 'mark', tMs: n.t0 * 1000, id: n.id });
        continue;
      }
      evQueue.push({
        type: 'on',
        midi: n.midi,
        tMs: n.t0 * 1000,
        grace: n.grace,
        slide: n.slide,
        ornament: n.ornament,
        id: n.id,
      });
      evQueue.push({ type: 'off', tMs: n.t1 * 1000 });
    }
    if (!focus) {
      for (const c of song.cuts) {
        evQueue.push({ type: 'caesura', tMs: c * 1000 });
      }
    }
    evQueue.sort(
      (a, b) =>
        a.tMs - b.tMs || (EV_RANK[a.type] ?? 3) - (EV_RANK[b.type] ?? 3),
    );
    const mains = timeline.filter((e) => !e.mark).length;
    if (!mains) renderer.begin(); // empty take: staff + key sig, not void
    feedRenderer(Number.MAX_SAFE_INTEGER);
    return mains;
  }

  // the trace frames the visible scope should draw (a focused phrase
  // shows only its own window)
  function visibleFrames() {
    return song && get().phraseView === 'focus'
      ? sliceFrames(traceFrames, phraseWindow(song, activeIdx()))
      : traceFrames;
  }

  // re-render the finished take from the document — no re-transcription.
  // Layout/key changes replay the existing timeline; when the derivation
  // inputs moved (melody floor, fresh fine frames) the doc re-derives,
  // snapshotting first if it carries edits (freeze-on-edit recovery).
  function rerenderView() {
    if (!song || recorder.micOn || decoding) return;
    const selId = get().selection ? get().selection.id : null;
    const frames = traceFrames; // survive the reset
    // an edit or layout change must not move the user's viewport — the
    // reset re-arms the view's follow mode, which would yank the roll
    // to its far end (restored below, after the re-feed)
    const scroll = view.getScroll();
    resetTake(false);
    traceFrames = frames;
    // the reset (analysisGen bump) just aborted any running backfill —
    // queue a rerun, or the trace stays half-drawn and the fine-frame
    // ornament evidence never reaches the tape
    if (tracing) traceAgain = true;
    // the active phrase's floor moved (slider): re-derive that phrase
    // (freeze-on-edit: the slider is disabled while it has edits)
    if (pendingFloor) {
      const { k, hz } = pendingFloor;
      pendingFloor = null;
      const p = song.phrases[k];
      if (p && !isFrozen(p)) {
        song = withPhrase(
          song,
          k,
          reDerive(p, {
            melodyFloorHz: hz,
            fineFrames: sliceFrames(traceFrames, phraseWindow(song, k)),
            savedAt: Date.now(),
          }),
        );
      }
    }
    if (deriveStale) {
      deriveStale = false;
      // fresh fine frames: re-derive every phrase, EXCEPT frozen ones —
      // an edited (or edit-baked) timeline is never replaced behind the
      // user's back (the explicit "Start over" path re-derives and
      // snapshots first)
      song = {
        ...song,
        phrases: song.phrases.map((p, k) =>
          isFrozen(p)
            ? p
            : reDerive(p, {
                melodyFloorHz: p.decode.melodyFloorHz,
                fineFrames: sliceFrames(traceFrames, phraseWindow(song, k)),
                savedAt: Date.now(),
              }),
        ),
      };
    }
    const mains = renderTimeline();
    // re-renders stay silent — unless the result is an empty staff
    if (mains) set({ hasTake: true });
    else {
      set({
        hasTake: true,
        status: `no notes at a ${settings().melodyFloor} Hz melody floor — try lowering it`,
      });
    }
    view.rebuildTrace(visibleFrames()); // trace follows the visible scope
    view.restoreScroll(scroll);
    player.setWindow(
      get().phraseView === 'focus' ? windowSecs(activeIdx()) : null,
    );
    syncPhraseState();
    selectNote(selId); // geometry moved; recompute (or clear) the band
  }

  // ---- editing: every op goes through the owning phrase's document
  // (doc.mjs) and re-renders the tape from the edited timelines — the
  // preview and the print bytes stay the same rows by construction. ----
  function applyDocOp(op, keepId) {
    if (!song || recorder.micOn || decoding) return;
    const k = phraseOfId(song, op.id);
    if (k < 0) return;
    const next = applyEdit(song.phrases[k], op);
    if (next === song.phrases[k]) return; // op didn't apply (see doc.mjs)
    song = withPhrase(song, k, next);
    rerenderView();
    selectNote(keepId ?? null);
  }

  // a re-render deferred because audio was playing when it was wanted —
  // apply as soon as playback rests
  function applyPendingRerender() {
    if (!pendingRerender || recorder.micOn || decoding) return;
    pendingRerender = false;
    rerenderView();
  }

  // finished takes re-render automatically as settings change (cheap,
  // from the document); live recording keeps applying values to new
  // tape only. Debounced: sliders fire per pixel of drag.
  let rerenderTimer = 0;
  let rerenderReanalyze = false;
  function scheduleRerender(reanalyze = false) {
    if (!song || recorder.micOn || decoding) return;
    rerenderReanalyze = rerenderReanalyze || reanalyze;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      if (player.state !== 'stopped') {
        pendingRerender = true;
        return;
      }
      const reanalyzeNow = rerenderReanalyze;
      rerenderReanalyze = false;
      rerenderView();
      if (reanalyzeNow) traceBackfill();
    }, 150);
  }

  // ---- trace backfill: after a neural decode, run the recording
  // through the v1 detector purely to draw the raw-pitch trace under
  // the tape (continuous cents — finer than the model's 1/3-semitone
  // grid). The fine frames also feed the pass-3 ornament marks, so a
  // finished backfill re-renders the tape once more. One backfill at a
  // time; the latest request wins. ----
  let tracing = false;
  let traceAgain = false;
  async function traceBackfill() {
    if (recorder.micOn || recorder.length < WINDOW || !renderer) return;
    if (tracing) {
      traceAgain = true; // rerun with fresh settings once this one exits
      return;
    }
    tracing = true;
    traceFrames = [];
    view.rebuildTrace([]); // a full re-analysis replaces the pane
    const gen = analysisGen;
    const trk = createNoteTracker(trackerValues());
    const total = Math.floor((recorder.length - WINDOW) / HOP) + 1;
    // per-phrase floors: each phrase's window analyzes in its own band
    const segs = song
      ? song.phrases.map((p, k) => {
          const [, b] = phraseWindow(song, k);
          return { end: b, fMin: p.decode.melodyFloorHz };
        })
      : [{ end: Infinity, fMin: settings().melodyFloor }];
    const floorAt = (tSec) =>
      (segs.find((s) => tSec < s.end) ?? segs[segs.length - 1]).fMin;
    for (let f = 0; f < total; f++) {
      const start = f * HOP;
      const win = new Float32Array(WINDOW);
      win.set(recorder.samples().subarray(start, start + WINDOW));
      const tMs = ((start + WINDOW) / recorder.sampleRate) * 1000;
      const m = await analyzer.analyze(win, {
        sr: recorder.sampleRate,
        t: tMs,
        mode: 'harm',
        fMin: floorAt(tMs / 1000),
        gen,
        holdF0: holdFreq(trk),
      });
      // null = analyzer disposed; a new take, replay, or live mic
      // invalidates this backfill too
      if (!m || disposed || recorder.micOn || analysisGen !== gen) break;
      trk.push({
        tMs: m.t,
        freq: m.freq,
        clarity: m.clarity,
        energy: m.energy,
      });
      const frame = {
        t: m.t,
        freq: m.freq,
        clarity: m.clarity,
        energy: m.energy,
        sounding: trk.sounding,
      };
      traceFrames.push(frame);
      view.paintTraceFrame(frame);
    }
    tracing = false;
    if (disposed) return;
    if (traceAgain) {
      traceAgain = false; // settings changed while this backfill ran
      traceBackfill();
      return;
    }
    // the fine frames may reveal ornaments (and revived notes) the
    // neural decode missed — re-render the tape with them. If audio is
    // mid-play, defer: a reset now would yank the playhead
    if (song && !recorder.micOn && analysisGen === gen) {
      deriveStale = true;
      if (player.state === 'stopped') rerenderView();
      else pendingRerender = true;
    }
  }

  // ---- print the take: the renderer's exact bytes, plus a PNG of the
  // same rows (printer orientation, like every History thumbnail) ----
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function takeName() {
    return get().currentTake?.name || 'Tape take';
  }

  async function postPrintJob({ rows, bytes, name }) {
    const png = await rowsToPngBytes(rows);
    const r = await fetch('/api/tape/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bytes: b64(bytes),
        png: b64(png),
        width: 576,
        height: rows.length,
        name,
      }),
    });
    const body = await r.json();
    if (!body.id) throw new Error(body.error || 'print failed');
  }

  // the visible tape prints as shown: the whole song (with caesura
  // marks) in song view, just the active phrase in focus view
  async function print() {
    if (!renderer?.rows.length || get().printState === 'queuing') return;
    if (recorder.micOn) stopMic();
    set({ printState: 'queuing' });
    try {
      const focus = song && get().phraseView === 'focus';
      const name = focus
        ? `${takeName()} · phrase ${activeIdx() + 1} of ${song.phrases.length}`
        : takeName();
      await postPrintJob({
        rows: renderer.rows,
        bytes: renderer.toEscpos(),
        name,
      });
      set({ status: 'sent to the print queue' });
    } catch (e) {
      set({ status: e.message });
    }
    set({ printState: 'idle' });
  }

  // render a phrase timeline into a fresh renderer — same layout, its
  // own clef and key signature, boundary-free (a standalone receipt)
  function renderStandalone(timeline) {
    const r = createTapeRenderer(layoutValues());
    const q = [];
    for (const n of timeline) {
      if (n.mark) {
        q.push({ type: 'mark', tMs: n.t0 * 1000 });
        continue;
      }
      q.push({
        type: 'on',
        tMs: n.t0 * 1000,
        midi: n.midi,
        grace: n.grace,
        slide: n.slide,
        ornament: n.ornament,
      });
      q.push({ type: 'off', tMs: n.t1 * 1000 });
    }
    q.sort(
      (a, b) =>
        a.tMs - b.tMs || (EV_RANK[a.type] ?? 3) - (EV_RANK[b.type] ?? 3),
    );
    for (const e of q) {
      r.advance(e.tMs);
      if (e.type === 'mark') r.markNow();
      else if (e.type === 'on') {
        r.noteOn(e.midi, e.tMs, e.grace, {
          slide: e.slide,
          ornament: e.ornament,
        });
      } else r.noteOff(e.tMs);
    }
    return r;
  }

  // one receipt per phrase, queued in order
  async function printPhrases() {
    if (!song || song.phrases.length < 2) return;
    if (get().printState === 'queuing') return;
    if (recorder.micOn) stopMic();
    set({ printState: 'queuing' });
    const total = song.phrases.length;
    try {
      for (let k = 0; k < total; k++) {
        set({ status: `queuing phrase ${k + 1} of ${total}…` });
        const r = renderStandalone(song.phrases[k].timeline);
        await postPrintJob({
          rows: r.rows,
          bytes: r.toEscpos(),
          name: `${takeName()} · phrase ${k + 1} of ${total}`,
        });
      }
      set({ status: `${total} phrases sent to the print queue` });
    } catch (e) {
      set({ status: e.message });
    }
    set({ printState: 'idle' });
  }

  // ---- saved takes (persistence, see persist.js / lib/tape-store.js).
  // The list is fetched once on mount and after each mutation — never
  // polled (metered stores; see docs/store-costs.md). ----
  async function refreshTakes() {
    try {
      const takes = await fetchTakes();
      if (!disposed) set({ takes });
    } catch {
      if (!disposed) set({ takes: [] });
    }
  }

  // Save: when the session is tied to a saved take (currentTake), update
  // it in place — document/settings/name only, no audio re-upload; when
  // untied (or asNew), create a fresh record and tie to it.
  async function persistTake(name, asNew) {
    if (!song || !recorder.length || recorder.micOn || decoding) return false;
    if (get().persistBusy) return false;
    set({ persistBusy: true });
    let ok = false;
    try {
      const cur = get().currentTake;
      const noteCount = mainCount(song);
      const onStatus = (msg) => set({ status: msg });
      // the payload keeps the 'doc' key: a song IS the document now, and
      // load detects the shape (legacy single-doc takes still open)
      const take =
        cur && !asNew
          ? await apiUpdateTake(cur.id, {
              name,
              noteCount,
              settings: settings(),
              doc: song,
              onStatus,
            })
          : await apiSaveTake({
              name,
              seconds: recorder.seconds,
              sampleRate: recorder.sampleRate,
              noteCount,
              settings: settings(),
              doc: song,
              wav: recorder.toWavBlob(),
              onStatus,
            });
      set({
        status: `saved "${take.name}"`,
        currentTake: { id: take.id, name: take.name },
      });
      ok = true;
      refreshTakes();
    } catch (e) {
      set({ status: `save failed: ${e.message}` });
    }
    set({ persistBusy: false });
    return ok;
  }

  async function loadTakeById(id) {
    if (recorder.micOn || decoding || get().persistBusy) return;
    set({ persistBusy: true, status: 'loading take…' });
    try {
      const loaded = await apiLoadTake(id);
      // the saved controls first — the renderer reads them on reset
      if (loaded.settings) {
        set((s) => ({ settings: { ...s.settings, ...loaded.settings } }));
        view.setTraceZoom(get().settings.traceZoom);
      }
      if (loaded.audio) await recorder.loadFile(loaded.audio);
      else recorder.reset();
      player.invalidate();
      // takes saved before phrases existed are single-doc: adopt them
      song = loaded.doc.phrases ? loaded.doc : songFromDoc(loaded.doc);
      deriveStale = false;
      pendingFloor = null;
      set({ activePhrase: 0, phraseView: 'song' }); // land on the Song tab
      resetTake(false);
      renderTimeline();
      set({
        status: `loaded "${loaded.take.name}"`,
        hasTake: true,
        currentTake: { id: loaded.take.id, name: loaded.take.name },
      });
      syncPhraseState();
      syncAudioState();
      if (get().phraseView === 'focus') {
        player.setWindow(windowSecs(activeIdx()));
      }
      traceBackfill(); // no-op without audio; refills the trace with it
    } catch (e) {
      set({ status: `load failed: ${e.message}` });
    }
    set({ persistBusy: false });
  }

  async function deleteTakeById(id) {
    if (get().persistBusy) return;
    set({ persistBusy: true });
    try {
      const name = (get().takes || []).find((t) => t.id === id)?.name || 'take';
      await apiDeleteTake(id);
      set((s) => ({
        takes: (s.takes || []).filter((t) => t.id !== id),
        // deleting the take this session came from unties it — the next
        // Save creates a fresh record instead of updating a ghost
        currentTake: s.currentTake?.id === id ? null : s.currentTake,
        // soft delete: undoable from the list for the session, and the
        // record survives server-side for 30 days regardless
        lastDeleted: { id, name },
        status: `deleted "${name}" — kept for 30 days`,
      }));
    } catch (e) {
      set({ status: `delete failed: ${e.message}` });
    }
    set({ persistBusy: false });
  }

  async function undeleteTake() {
    const gone = get().lastDeleted;
    if (!gone || get().persistBusy) return;
    set({ persistBusy: true });
    try {
      const take = await apiRestoreTake(gone.id);
      set({ lastDeleted: null, status: `restored "${take.name}"` });
      await refreshTakes();
    } catch (e) {
      set({ status: `restore failed: ${e.message}` });
    }
    set({ persistBusy: false });
  }

  // ---- boot ----
  resetTake(true);
  refreshTakes();

  // ---- public API (what the React handlers call) ----
  return {
    toggleMic() {
      if (recorder.micOn) {
        stopMic();
        // the live tracker is a sketch; the real transcription is the
        // neural decode of the recording, run when the take ends
        if (recorder.length > recorder.sampleRate) neuralDecode();
      } else if (!decoding) {
        startMic();
      }
    },
    // the false-start escape: stop the mic WITHOUT transcribing and
    // clear the deck (also clears a loaded take, though the UI only
    // offers it while recording)
    discard() {
      if (decoding) return; // don't yank the tape from under a decode
      if (recorder.micOn) stopMic();
      resetTake(true);
      set({ status: '' });
    },
    demo() {
      if (recorder.micOn || decoding) return;
      recorder.loadRaw(synthDemoPcm(recorder.sampleRate));
      player.invalidate(); // new audio behind the same take flow
      set({ currentTake: null }); // genuinely a new take
      syncAudioState();
      neuralDecode();
    },
    // download the take's audio as a WAV to this device (nothing is
    // saved server-side here — Save take does that)
    downloadTake() {
      if (!recorder.length) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(recorder.toWavBlob());
      a.download = `${takeName().replace(/[/\\:*?"<>|]/g, '-')}.wav`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    async loadClip(file) {
      if (!file || recorder.micOn || decoding) return;
      set({ status: 'decoding clip…' });
      try {
        await recorder.loadFile(file);
        player.invalidate(); // new audio behind the same take flow
        set({ currentTake: null }); // genuinely a new take
        syncAudioState();
        await neuralDecode();
      } catch (e) {
        set({ status: `clip load failed: ${e.message}` });
      }
    },
    playPause() {
      if (recorder.micOn || decoding) return;
      if (player.state === 'playing') player.pause();
      else player.play();
    },
    stopPlay() {
      player.stop(false);
    },
    // deck skip: ±seconds from the current position (window-clamped)
    seekBy(delta) {
      if (recorder.micOn || decoding || !recorder.length) return;
      player.seek(player.pos() + delta);
    },
    // keyboard note-walking: next/previous main note in the visible
    // scope; nothing selected starts from the near end
    selectAdjacent(dir) {
      if (!song || recorder.micOn || decoding) return;
      if (get().viewMode !== 'full') return; // skeleton view doesn't edit
      const scope =
        get().phraseView === 'focus'
          ? song.phrases[activeIdx()].timeline
          : assembled(song);
      const mains = scope.filter((e) => !e.mark);
      if (!mains.length) return;
      const cur = get().selection?.id;
      let i = mains.findIndex((e) => e.id === cur);
      if (i < 0) i = dir > 0 ? -1 : mains.length;
      i = Math.max(0, Math.min(mains.length - 1, i + dir));
      selectNote(mains[i].id);
      const rect = get().selectionRect;
      if (rect) view.reveal(rect.left, rect.width);
    },
    setSetting(key, value) {
      // scale system: mugham selections derive the EFFECTIVE printed
      // signature (best-fit, see mughamKey); keySig stays the single
      // truth the renderer and note labels read
      if (
        key === 'scaleSystem' ||
        key === 'mughamMode' ||
        key === 'mughamTonic'
      ) {
        set((s) => ({ settings: { ...s.settings, [key]: value } }));
        const s = settings();
        if (s.scaleSystem === 'mugham') {
          const { sharps } = mughamKey(s.mughamMode, s.mughamTonic);
          if (sharps !== s.keySig) {
            set((st) => ({ settings: { ...st.settings, keySig: sharps } }));
            renderer?.setConfig({ keySig: sharps });
            scheduleRerender();
          }
        }
        return;
      }
      // the floor is per phrase: it re-derives only the ACTIVE phrase.
      // Freeze-on-edit: a phrase with edits keeps its floor (the slider
      // is disabled in the UI; this is the belt to that suspender)
      if (key === 'melodyFloor') {
        const p = activePhraseDoc();
        if (p && isFrozen(p)) return;
        set((s) => ({ settings: { ...s.settings, [key]: value } }));
        pendingFloor = { k: activeIdx(), hz: value };
        // the register split changes the decode AND the trace analysis
        scheduleRerender(true);
        return;
      }
      set((s) => ({ settings: { ...s.settings, [key]: value } }));
      if (key === 'traceZoom') {
        view.setTraceZoom(value);
        if (get().traceMode === 'linear') view.rebuildTrace(visibleFrames());
      } else {
        // layout keys: live to the current renderer (mid-recording they
        // shape new tape only), full re-render for a finished take
        renderer?.setConfig({ [key]: value });
        scheduleRerender();
      }
    },
    setViewMode(v) {
      set({ viewMode: v });
      rerenderView();
    },
    setTraceMode(v) {
      set({ traceMode: v });
      if (v === 'hidden') return; // React hides the pane; nothing to draw
      view.setTraceMode(v);
      view.rebuildTrace(visibleFrames());
    },
    setSpeed(v) {
      set({ speed: v });
      player.setRate(v);
    },

    // ---- editing (Phase 2) ----
    select: (id) => selectNote(id),
    nudgePitch(delta) {
      const sel = get().selection;
      if (!sel || sel.mark) return;
      const midi = Math.max(48, Math.min(91, sel.midi + delta));
      if (midi === sel.midi) return;
      applyDocOp({ op: 'setPitch', id: sel.id, midi }, sel.id);
    },
    toggleOrnament() {
      const sel = get().selection;
      if (sel && !sel.mark) {
        applyDocOp({ op: 'toggleOrnament', id: sel.id }, sel.id);
      }
    },
    toggleSlide() {
      const sel = get().selection;
      if (sel && !sel.mark) {
        applyDocOp({ op: 'toggleSlide', id: sel.id }, sel.id);
      }
    },
    splitAtPlayhead() {
      const sel = get().selection;
      if (!sel || sel.mark) return;
      const t = player.pos();
      if (!(t > sel.t0 + 0.02 && t < sel.t1 - 0.02)) return;
      applyDocOp({ op: 'split', id: sel.id, t }, `${sel.id}a`);
    },
    joinNext() {
      const sel = get().selection;
      if (sel && !sel.mark) applyDocOp({ op: 'join', id: sel.id }, sel.id);
    },
    removeNote() {
      const sel = get().selection;
      if (!sel) return;
      // removing a flag arc means clearing the owner note's ornament;
      // everything else (notes, standalone marks) is a timeline remove
      if (sel.flagArc) {
        applyDocOp({ op: 'toggleOrnament', id: sel.flagArc }, null);
      } else {
        applyDocOp({ op: 'remove', id: sel.id }, null);
      }
    },
    // undo/redo act on the ACTIVE phrase's history
    undoEdit() {
      const p = activePhraseDoc();
      if (!p || recorder.micOn || decoding) return;
      const next = undo(p);
      if (next === p) return;
      song = withPhrase(song, activeIdx(), next);
      rerenderView();
    },
    redoEdit() {
      const p = activePhraseDoc();
      if (!p || recorder.micOn || decoding) return;
      const next = redo(p);
      if (next === p) return;
      song = withPhrase(song, activeIdx(), next);
      rerenderView();
    },
    // the explicit unfreeze for the ACTIVE phrase: re-derive it from the
    // recording at the current floor. reDerive snapshots the edited
    // phrase into its versions first, so nothing is lost.
    reread() {
      const p = activePhraseDoc();
      if (!p || recorder.micOn || decoding) return;
      selectNote(null); // ids change wholesale; keep nothing selected
      const k = activeIdx();
      song = withPhrase(
        song,
        k,
        reDerive(p, {
          melodyFloorHz: settings().melodyFloor,
          fineFrames: sliceFrames(traceFrames, phraseWindow(song, k)),
          savedAt: Date.now(),
        }),
      );
      rerenderView();
    },

    // ---- phrases (Phase 4): the song is the project, phrases are its
    // pages. selectTab(-1) opens the Song overview; selectTab(k) opens
    // phrase k's own tape (edit, settings, confined playback). ----
    selectTab(k) {
      if (!song || recorder.micOn || decoding) return;
      if (k < 0) {
        // the Song overview
        if (get().phraseView !== 'song') {
          set({ phraseView: 'song' });
          rerenderView();
        }
        return;
      }
      if (k >= song.phrases.length) return;
      const changed = k !== get().activePhrase || get().phraseView !== 'focus';
      setActivePhraseState(k);
      set({ phraseView: 'focus' });
      if (changed) {
        selectNote(null);
        rerenderView(); // renders the phrase's own tape
      }
    },
    // toggle a cut at the selected note's attack
    cutBefore() {
      const sel = get().selection;
      if (!sel || sel.mark || !song || recorder.micOn || decoding) return;
      const t = sel.t0;
      const opts = { savedAt: Date.now() };
      const i = song.cuts.indexOf(t);
      let next;
      if (i >= 0) {
        next = removeCut(song, i, opts);
      } else {
        // a cut before the song's first note would make an empty phrase
        const first = assembled(song).find((e) => !e.mark);
        if (!first || t <= first.t0) return;
        next = addCut(song, t, opts);
      }
      if (next === song) return;
      song = next;
      rerenderView();
      // the phrases re-derived; reselect the same note by its time
      const again = assembled(song).find(
        (e) => !e.mark && Math.abs(e.t0 - t) < 1e-6,
      );
      selectNote(again ? again.id : null);
    },
    // seed cuts at every rest long enough to be a phrase breath
    cutAtBreaths() {
      if (!song || recorder.micOn || decoding) return;
      const thr = (2 * settings().breathGapMs) / 1000;
      const mains = assembled(song).filter((e) => !e.mark);
      let next = song;
      let added = 0;
      const opts = { savedAt: Date.now() };
      for (let i = 1; i < mains.length; i++) {
        const t = mains[i].t0;
        if (t - mains[i - 1].t1 >= thr && !next.cuts.includes(t)) {
          const grown = addCut(next, t, opts);
          if (grown !== next) {
            next = grown;
            added++;
          }
        }
      }
      if (!added) {
        set({
          status:
            'no rests long enough to cut at — select a note and use Cut before',
        });
        return;
      }
      song = next;
      rerenderView();
      set({
        status: `${added} ${added === 1 ? 'cut' : 'cuts'} added — ${song.phrases.length} phrases`,
      });
    },
    // merge phrase i+1 back into phrase i (a chip's ✕)
    removeCutAt(i) {
      if (!song || recorder.micOn || decoding) return;
      const next = removeCut(song, i, { savedAt: Date.now() });
      if (next === song) return;
      selectNote(null);
      song = next;
      set((s) => ({ activePhrase: Math.min(s.activePhrase, i) }));
      rerenderView();
    },
    printPhrases,
    // ---- saved takes (Phase 3) ----
    saveTake: (name) => persistTake(name, false),
    saveTakeAsNew: (name) => persistTake(name, true),
    loadTakeById,
    deleteTakeById,
    undeleteTake,
    print,
    dispose() {
      disposed = true;
      clearTimeout(rerenderTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      releaseWakeLock();
      if (recorder.micOn) recorder.stopMic();
      player.dispose();
      analyzer.dispose();
      view.dispose();
    },
  };
}
