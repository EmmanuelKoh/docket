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

export interface TapeState {
  // ---- transient session state (reset by the controller on mount) ----
  micOn: boolean;
  decoding: boolean; // neural decode in flight; most controls sit out
  status: string; // the human status line under the tape
  noteNow: string; // the currently sounding note label (live sketch)
  log: { id: number; text: string }[]; // newest first, capped
  playState: 'stopped' | 'playing' | 'paused';
  playTime: number; // seconds into the clip (playhead / time display)
  clipDur: number; // seconds of recorded audio
  hasAudio: boolean; // a recording exists (transport + save enabled)
  canPrint: boolean; // the tape has rows
  printState: 'idle' | 'queuing';
  truncated: boolean; // preview hit its width cap (the print is whole)

  // ---- user settings (persist across mounts) ----
  viewMode: 'full' | 'skeleton';
  traceMode: 'aligned' | 'linear';
  speed: number; // playback rate (varispeed: slower also lowers pitch)
  settings: TapeSettings;
}

export const tapeStore = createStore<TapeState>(() => ({
  micOn: false,
  decoding: false,
  status: '',
  noteNow: '—',
  log: [],
  playState: 'stopped',
  playTime: 0,
  clipDur: 0,
  hasAudio: false,
  canPrint: false,
  printState: 'idle',
  truncated: false,

  viewMode: 'full',
  traceMode: 'aligned',
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
