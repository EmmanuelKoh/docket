// components/tape/store.ts — the Tape tool's shared state. One zustand
// store bridges the two worlds the tool is made of: the React controls
// read it with the useTape hook, and the imperative controller
// (controller.js) writes it with plain setState. Data flows one way —
// React handlers call controller methods, the controller updates the
// store, React re-renders — so neither side ever reaches into the
// other's internals.
//
// The store is a module singleton: settings survive navigating away and
// back (the controller resets the transient flags on init).

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface TapeSettings {
  melodyFloor: number; // Hz — detector register floor (see controller)
  keySig: number; // sharps count, -7..+7
  msPerRow: number;
  staffGap: number;
  noteDots: number;
  glyphScale: number;
  breathGapMs: number;
  traceZoom: number; // linear-trace columns per second
}

// A saved take's meta record, as the takes list renders it.
export interface TakeMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  seconds: number;
  sampleRate: number;
  noteCount: number;
  hasAudio: boolean;
}

// One phrase of the song, as the phrase strip renders it.
export interface PhraseMeta {
  t0: number; // clip seconds
  t1: number;
  noteCount: number;
  editCount: number; // nonzero = this phrase's detection is frozen
  floor: number; // the phrase's own melody floor (Hz)
}

// The selected note, as the inspector renders it — a snapshot the
// controller rebuilds from the take document after every change.
export interface TapeSelection {
  id: string;
  label: string; // "F♯4" in the current key
  midi: number;
  t0: number; // seconds
  t1: number;
  grace: boolean;
  ornament: boolean; // arc at the attack
  slide: boolean; // slide connector from the previous main note
  canJoin: boolean; // a later main note exists to join with
}

export interface TapeState {
  // ---- transient session state (reset by the controller on mount) ----
  micOn: boolean;
  decoding: boolean; // neural decode in flight; most controls sit out
  status: string; // the human status line under the tape
  playState: 'stopped' | 'playing' | 'paused';
  playTime: number; // seconds into the clip (playhead / time display)
  clipDur: number; // seconds of recorded audio
  hasAudio: boolean; // a recording exists (transport + save enabled)
  canPrint: boolean; // the tape has rows
  printState: 'idle' | 'queuing';
  truncated: boolean; // preview hit its width cap (the print is whole)
  hasTake: boolean; // a decoded take document exists (editing possible)
  selection: TapeSelection | null;
  // the selection band over the preview, in css px on the tape roll
  selectionRect: { left: number; width: number; height: number } | null;
  editCount: number; // ops applied to the take (nonzero = frozen)
  redoCount: number;
  takes: TakeMeta[] | null; // saved takes; null until the first fetch
  persistBusy: boolean; // a save/load/delete is in flight
  // the saved take this session came from (saved or loaded): Save then
  // updates it in place. Cleared when the audio genuinely changes.
  currentTake: { id: string; name: string } | null;
  // the most recent soft delete, undoable from the takes list
  lastDeleted: { id: string; name: string } | null;
  phrases: PhraseMeta[]; // the song's phrases, in time order
  activePhrase: number; // which one the slider/undo/focus act on
  cuts: number[]; // phrase boundaries (clip seconds, note attacks)

  // ---- user settings (persist across mounts) ----
  viewMode: 'full' | 'skeleton';
  traceMode: 'hidden' | 'aligned' | 'linear'; // the raw-pitch pane
  phraseView: 'song' | 'focus'; // whole roll, or just the active phrase
  speed: number; // playback rate (varispeed: slower also lowers pitch)
  settings: TapeSettings;
}

export const tapeStore = createStore<TapeState>(() => ({
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
  takes: null,
  persistBusy: false,
  currentTake: null,
  lastDeleted: null,
  phrases: [],
  activePhrase: 0,
  cuts: [],

  viewMode: 'full',
  traceMode: 'aligned',
  phraseView: 'song',
  speed: 1,
  settings: {
    melodyFloor: 230,
    keySig: 0,
    msPerRow: 20,
    staffGap: 28,
    noteDots: 26,
    glyphScale: 2,
    breathGapMs: 350,
    traceZoom: 90,
  },
}));

// React-side accessor: useTape(s => s.playState)
export function useTape<T>(selector: (s: TapeState) => T): T {
  return useStore(tapeStore, selector);
}
