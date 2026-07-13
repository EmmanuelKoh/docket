'use client';

// components/tape/tape-tool.tsx — the Tape studio's React layer. The
// page commits to the session's state (data-mode on the root): EMPTY
// keeps the session buttons in their fixed column spot over the takes
// list, and the short paper strip carries the note (with the demo
// action); RECORDING reduces to the REC banner,
// the full-height live trace, Stop, and discard; LOADED is the full
// bench — stage (roll, transport, inspector, print) and the project
// column (takes, key, collapsible settings). Controls read the shared
// store (store.ts) and call controller methods (controller.js); the
// only imperative DOM is the canvas island inside .tape-roll, which the
// controller's view module owns — the canvases stay mounted across all
// modes, CSS hides them.

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FastForward,
  Pause,
  Play,
  Printer,
  Redo2,
  Rewind,
  Scissors,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { createTapeController } from '@/components/tape/controller.js';
import { floorToMidi } from '@/components/tape/doc.mjs';
import {
  type TapeSliderKey,
  tapeStore,
  useTape,
} from '@/components/tape/store';
import {
  KEY_SIGS,
  MUGHAM_MODES,
  mughamKey,
  noteLabel,
  TONIC_NAMES,
} from '@/components/tape-renderer.js';
import { useSidebar } from '@/components/ui/sidebar';

type Controller = ReturnType<typeof createTapeController>;

// which face the page wears; recording wins, then loaded, then empty
type TapeMode = 'empty' | 'loaded' | 'recording';

const fmtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

function Slider(props: {
  ctl: Controller | null;
  k: TapeSliderKey;
  label: string;
  min: number;
  max: number;
  fmt?: (v: number) => string;
  disabled?: boolean;
}) {
  const value = useTape((s) => s.settings[props.k]);
  return (
    <div className="tape-row">
      <span className="label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={value}
        disabled={props.disabled}
        onChange={(e) =>
          props.ctl?.setSetting(props.k, parseFloat(e.target.value))
        }
      />
      <span className="tape-val">{props.fmt ? props.fmt(value) : value}</span>
    </div>
  );
}

// a collapsible settings group — settings earn space only when open
function Group(props: { title: string; children: React.ReactNode }) {
  return (
    <details className="tape-acc">
      <summary className="label">{props.title}</summary>
      <div className="tape-acc-body">{props.children}</div>
    </details>
  );
}

// a file input dressed as a button — a loaded file opens as a new take
function LoadAudio({
  ctl,
  label = 'Load audio',
}: {
  ctl: Controller | null;
  label?: string;
}) {
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  return (
    <label className={micOn || decoding ? 'btn disabled' : 'btn'}>
      {label}
      <input
        type="file"
        accept="audio/*"
        hidden
        disabled={micOn || decoding}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ctl?.loadClip(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// the open project's phrases, as a sub-list under its takes-list row:
// "Song" is the whole-take overview, each phrase opens its own tape
function PhraseList({ ctl }: { ctl: Controller | null }) {
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const view = useTape((s) => s.phraseView);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const busy = micOn || decoding;
  const many = phrases.length > 1;

  return (
    <div className="tape-phraselist">
      {many && (
        <button
          type="button"
          className={
            view === 'song' ? 'tape-phrase-item selected' : 'tape-phrase-item'
          }
          disabled={busy}
          onClick={() => ctl?.selectTab(-1)}
        >
          Song — all phrases
        </button>
      )}
      {many &&
        phrases.map((p, k) => (
          <div key={`${p.t0}-${p.t1}`} className="tape-phrase-row">
            <button
              type="button"
              className={
                view === 'focus' && k === active
                  ? 'tape-phrase-item selected'
                  : 'tape-phrase-item'
              }
              disabled={busy}
              onClick={() => ctl?.selectTab(k)}
            >
              Phrase {k + 1} · {fmtTime(p.t0)}–{fmtTime(p.t1)}
              {p.editCount ? ' · edited' : ''}
            </button>
            {k > 0 && (
              <button
                type="button"
                className="tape-chip-x"
                disabled={busy}
                aria-label={`Merge phrase ${k + 1} into phrase ${k}`}
                onClick={() => ctl?.removeCutAt(k - 1)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      <button
        type="button"
        className="tape-phrase-action"
        disabled={busy}
        onClick={() => ctl?.cutAtBreaths()}
      >
        cut into phrases at breaths
      </button>
    </div>
  );
}

// the takes list: every saved take is a project — click a row to open
// it; the open one (or the unsaved session) expands to its phrases.
function Projects({ ctl }: { ctl: Controller | null }) {
  const takes = useTape((s) => s.takes);
  const busy = useTape((s) => s.persistBusy);
  const hasTake = useTape((s) => s.hasTake);
  const hasAudio = useTape((s) => s.hasAudio);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const current = useTape((s) => s.currentTake);
  const lastDeleted = useTape((s) => s.lastDeleted);
  const [name, setName] = useState('');
  const canSave = hasTake && hasAudio && !micOn && !decoding && !busy;

  // the name field follows the open take (load, save, untie)
  const currentId = current?.id ?? null;
  const currentName = current?.name ?? '';
  useEffect(() => {
    setName(currentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  return (
    <div className="tape-group">
      <span className="label">Takes</span>
      {hasTake && (
        <div className="tape-btnrow">
          <input
            className="tape-name"
            type="text"
            placeholder="name this take"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="btn small primary"
            disabled={!canSave}
            onClick={() => ctl?.saveTake(name.trim() || 'Take')}
          >
            {current ? 'Save' : 'Save take'}
          </button>
          {current && (
            <button
              type="button"
              className="btn small"
              disabled={!canSave}
              onClick={() => ctl?.saveTakeAsNew(name.trim() || 'Take')}
            >
              Save as new
            </button>
          )}
        </div>
      )}
      {hasTake && hasAudio && (
        <button
          type="button"
          className="tape-quiet"
          disabled={micOn || decoding}
          onClick={() => ctl?.downloadTake()}
        >
          download take (wav)
        </button>
      )}
      <div className="tape-takes">
        {hasTake && !current && (
          <>
            <div className="tape-take-row current">
              <span className="tape-take-open">
                <span className="tape-take-name">unsaved take</span>
              </span>
            </div>
            <PhraseList ctl={ctl} />
          </>
        )}
        {takes?.map((t) => (
          <Fragment key={t.id}>
            <div
              className={
                t.id === currentId ? 'tape-take-row current' : 'tape-take-row'
              }
            >
              <button
                type="button"
                className="tape-take-open"
                disabled={busy || micOn || decoding || t.id === currentId}
                onClick={() => ctl?.loadTakeById(t.id)}
              >
                <span className="tape-take-name" title={t.name}>
                  {t.name}
                </span>
                <span className="tape-take-sub">{fmtTime(t.seconds)}</span>
              </button>
              <button
                type="button"
                className="tape-chip-x"
                disabled={busy}
                aria-label={`Delete ${t.name}`}
                onClick={() => {
                  if (window.confirm(`Delete "${t.name}"?`))
                    ctl?.deleteTakeById(t.id);
                }}
              >
                ✕
              </button>
            </div>
            {t.id === currentId && <PhraseList ctl={ctl} />}
          </Fragment>
        ))}
        {takes && takes.length === 0 && !hasTake && (
          <p className="tape-hint">no saved takes yet</p>
        )}
      </div>
      {lastDeleted && (
        <p className="tape-hint">
          deleted “{lastDeleted.name}” —{' '}
          <button
            type="button"
            className="tape-undo"
            disabled={busy}
            onClick={() => ctl?.undeleteTake()}
          >
            undo
          </button>
        </p>
      )}
    </div>
  );
}

// the key: Western major/minor signatures, or the mugham modes (Rast,
// Shur, Segah, …) on a chosen tonic — a mugham pick derives the
// best-fit printed signature, shown in the hint underneath
function KeyPicker({
  ctl,
  keySig,
}: {
  ctl: Controller | null;
  keySig: number;
}) {
  const system = useTape((s) => s.settings.scaleSystem);
  const mode = useTape((s) => s.settings.mughamMode);
  const tonic = useTape((s) => s.settings.mughamTonic);
  const sigName =
    KEY_SIGS.find((k: { sharps: number }) => k.sharps === keySig)?.name ?? '';

  return (
    <div className="tape-field">
      <span className="label">Key</span>
      <select
        className="tape-select"
        value={system}
        onChange={(e) => ctl?.setSetting('scaleSystem', e.target.value)}
      >
        <option value="western">Western — major / minor</option>
        <option value="mugham">Mugham — Rast, Shur, Segah…</option>
      </select>
      {system === 'western' ? (
        <select
          className="tape-select"
          value={keySig}
          onChange={(e) =>
            ctl?.setSetting('keySig', parseInt(e.target.value, 10))
          }
        >
          {KEY_SIGS.map((k: { sharps: number; name: string }) => (
            <option key={k.sharps} value={k.sharps}>
              {k.name}
            </option>
          ))}
        </select>
      ) : (
        <>
          <select
            className="tape-select"
            value={mode}
            onChange={(e) => ctl?.setSetting('mughamMode', e.target.value)}
          >
            {MUGHAM_MODES.map((m: { id: string; name: string }) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            className="tape-select"
            value={tonic}
            onChange={(e) =>
              ctl?.setSetting('mughamTonic', parseInt(e.target.value, 10))
            }
          >
            {TONIC_NAMES.map((t: string, pc: number) => (
              <option key={t} value={pc}>
                on {t}
              </option>
            ))}
          </select>
          <p className="tape-hint">
            {mughamKey(mode, tonic).name} — prints as {sigName}
          </p>
        </>
      )}
    </div>
  );
}

function Controls({ ctl, mode }: { ctl: Controller | null; mode: TapeMode }) {
  const decoding = useTape((s) => s.decoding);
  const keySig = useTape((s) => s.settings.keySig);
  const viewMode = useTape((s) => s.viewMode);
  const traceMode = useTape((s) => s.traceMode);
  const editCount = useTape((s) => s.editCount);
  const activePhrase = useTape((s) => s.activePhrase);
  const phraseCount = useTape((s) => s.phrases.length);

  // the session buttons sit in the SAME place in every mode — the top
  // of the column — so Record never moves; the empty page just stops
  // after the takes list (key and settings appear once there is
  // something to act on)
  if (mode === 'empty') {
    return (
      <div className="tape-controls">
        <div className="tape-btnrow">
          <button
            type="button"
            className="btn icon primary"
            disabled={decoding}
            onClick={() => ctl?.toggleMic()}
          >
            <span className="tape-lamp" />
            Record
          </button>
          <LoadAudio ctl={ctl} />
        </div>
        <Projects ctl={ctl} />
      </div>
    );
  }

  return (
    <div className="tape-controls">
      <div className="tape-btnrow">
        <button
          type="button"
          className="btn icon primary"
          disabled={decoding}
          onClick={() => ctl?.toggleMic()}
        >
          <span className="tape-lamp" />
          Record
        </button>
        <LoadAudio ctl={ctl} />
      </div>

      <Projects ctl={ctl} />

      <KeyPicker ctl={ctl} keySig={keySig} />

      <Group
        title={
          phraseCount > 1
            ? `Detection · phrase ${activePhrase + 1}`
            : 'Detection'
        }
      >
        <Slider
          ctl={ctl}
          k="melodyFloor"
          label="Melody floor"
          min={120}
          max={500}
          fmt={(v) => `${v} Hz / ${noteLabel(floorToMidi(v), keySig)}`}
          disabled={editCount > 0}
        />
        {editCount > 0 && (
          <>
            <p className="tape-hint">
              {phraseCount > 1
                ? `Detection locks while phrase ${activePhrase + 1} has edits. Start over re-reads it; the edited phrase is kept as a snapshot.`
                : 'Detection locks while the take has edits. Start over re-reads the recording; the edited tape is kept as a snapshot.'}
            </p>
            <button
              type="button"
              className="btn small"
              onClick={() => ctl?.reread()}
            >
              Start over
            </button>
          </>
        )}
      </Group>

      <Group title="View">
        <div className="tape-field">
          <span className="label">Notation</span>
          <select
            className="tape-select"
            value={viewMode}
            onChange={(e) => ctl?.setViewMode(e.target.value)}
          >
            <option value="full">Full notation</option>
            <option value="skeleton">Main notes only</option>
          </select>
        </div>
        <div className="tape-field">
          <span className="label">Pitch trace</span>
          <select
            className="tape-select"
            value={traceMode}
            onChange={(e) => ctl?.setTraceMode(e.target.value)}
          >
            <option value="hidden">Hidden</option>
            <option value="aligned">Aligned under the tape</option>
            <option value="linear">Linear time — continuous</option>
          </select>
        </div>
        {traceMode === 'linear' && (
          <Slider
            ctl={ctl}
            k="traceZoom"
            label="Trace stretch"
            min={20}
            max={400}
            fmt={(v) => `${v} px/s`}
          />
        )}
      </Group>

      <Group title="Layout">
        <Slider
          ctl={ctl}
          k="msPerRow"
          label="Ms per row"
          min={5}
          max={60}
          fmt={(v) => `${v} ms`}
        />
        <Slider
          ctl={ctl}
          k="staffGap"
          label="Staff gap"
          min={12}
          max={48}
          fmt={(v) => `${v} dots`}
        />
        <Slider
          ctl={ctl}
          k="noteDots"
          label="Note width"
          min={4}
          max={32}
          fmt={(v) => `${v} dots`}
        />
        <Slider
          ctl={ctl}
          k="glyphScale"
          label="Glyph size"
          min={1}
          max={4}
          fmt={(v) => `${v}×`}
        />
        <Slider
          ctl={ctl}
          k="breathGapMs"
          label="Breath gap"
          min={150}
          max={1000}
          fmt={(v) => `${v} ms`}
        />
        <p className="tape-hint">
          Changes re-render the finished take instantly; while recording they
          apply to new tape only.
        </p>
      </Group>
    </div>
  );
}

// the selected note's band — DOM over the preview, never in the canvas
// (the canvas holds exact print bytes)
function SelectionBand() {
  const rect = useTape((s) => s.selectionRect);
  if (!rect) return null;
  return (
    <div
      className="tape-selection"
      style={{ left: rect.left, width: rect.width, height: rect.height }}
    />
  );
}

// the editing strip: what the selected note is, and what can be done to
// it. Shown once a take is decoded; before a selection it teaches the
// click affordance. Undo/redo live here and work without a selection.
function Inspector({ ctl }: { ctl: Controller | null }) {
  const hasTake = useTape((s) => s.hasTake);
  const selection = useTape((s) => s.selection);
  const editCount = useTape((s) => s.editCount);
  const redoCount = useTape((s) => s.redoCount);
  const playTime = useTape((s) => s.playTime);
  const viewMode = useTape((s) => s.viewMode);
  const cuts = useTape((s) => s.cuts);
  if (!hasTake) return null;
  const canSplit =
    !!selection &&
    playTime > selection.t0 + 0.02 &&
    playTime < selection.t1 - 0.02;
  return (
    <div className="tape-inspector">
      <button
        type="button"
        className="btn small icon"
        aria-label="Previous note"
        title="Previous note (←)"
        onClick={() => ctl?.selectAdjacent(-1)}
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        className="btn small icon"
        aria-label="Next note"
        title="Next note (→)"
        onClick={() => ctl?.selectAdjacent(1)}
      >
        <ChevronRight size={16} />
      </button>
      {selection ? (
        <>
          <span className="tape-val">
            {selection.label} · {fmtTime(selection.t0)}–{fmtTime(selection.t1)}
          </span>
          <button
            type="button"
            className="btn small icon"
            aria-label="Pitch down a semitone"
            title="Pitch down a semitone (↓)"
            onClick={() => ctl?.nudgePitch(-1)}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="btn small icon"
            aria-label="Pitch up a semitone"
            title="Pitch up a semitone (↑)"
            onClick={() => ctl?.nudgePitch(1)}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className={selection.ornament ? 'btn small pressed' : 'btn small'}
            title="Toggle the ornament arc (O)"
            onClick={() => ctl?.toggleOrnament()}
          >
            Ornament
          </button>
          <button
            type="button"
            className={selection.slide ? 'btn small pressed' : 'btn small'}
            onClick={() => ctl?.toggleSlide()}
          >
            Slide from prev
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!canSplit}
            title={
              canSplit
                ? 'Split at the playhead (S)'
                : 'seek inside the note first'
            }
            onClick={() => ctl?.splitAtPlayhead()}
          >
            Split at playhead
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selection.canJoin}
            title="Join with the next note (J)"
            onClick={() => ctl?.joinNext()}
          >
            Join next
          </button>
          <button
            type="button"
            className={
              cuts.includes(selection.t0)
                ? 'btn small icon pressed'
                : 'btn small icon'
            }
            title="Start a new phrase at this note (C)"
            onClick={() => ctl?.cutBefore()}
          >
            <Scissors size={14} /> Cut before
          </button>
          <button
            type="button"
            className="btn small icon"
            aria-label="Remove note"
            title="Remove note (⌫)"
            onClick={() => ctl?.removeNote()}
          >
            <Trash2 size={15} />
          </button>
        </>
      ) : (
        <span className="tape-hint">
          {viewMode === 'full'
            ? 'pick a note on the tape to edit it'
            : 'switch to Full notation to edit'}
        </span>
      )}
      <span className="tape-inspector-spacer" />
      <button
        type="button"
        className="btn small icon"
        disabled={!editCount}
        aria-label="Undo"
        title="Undo (⌘Z)"
        onClick={() => ctl?.undoEdit()}
      >
        <Undo2 size={15} />
        {editCount ? ` ${editCount}` : ''}
      </button>
      <button
        type="button"
        className="btn small icon"
        disabled={!redoCount}
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
        onClick={() => ctl?.redoEdit()}
      >
        <Redo2 size={15} />
      </button>
    </div>
  );
}

function Playhead({
  elRef,
}: {
  elRef: React.RefObject<HTMLDivElement | null>;
}) {
  const playState = useTape((s) => s.playState);
  const playTime = useTape((s) => s.playTime);
  return (
    <div
      ref={elRef}
      className={
        playState === 'playing' ? 'tape-playhead live' : 'tape-playhead'
      }
      hidden={playState === 'stopped' && playTime === 0}
    />
  );
}

function TraceCanvas({
  elRef,
}: {
  elRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const hidden = useTape((s) => s.traceMode === 'hidden');
  return (
    <canvas
      ref={elRef}
      className={hidden ? 'tape-trace tape-trace-hidden' : 'tape-trace'}
      height={110}
    />
  );
}

// the take banner: an inverted ink bar over the roll, like the bold
// knockout headers on the plugin receipts (see the World Cup FULL TIME
// template) — the open take's name, or a red REC counter while live
function TakeBanner() {
  const micOn = useTape((s) => s.micOn);
  const hasTake = useTape((s) => s.hasTake);
  const current = useTape((s) => s.currentTake);
  const clipDur = useTape((s) => s.clipDur);
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const focus = useTape((s) => s.phraseView === 'focus');

  if (micOn) {
    return (
      <div className="tape-banner rec">
        <span className="tape-lamp live" />
        REC {fmtTime(clipDur)}
      </div>
    );
  }
  if (!hasTake) return null;
  const name = current?.name ?? 'unsaved take';
  const suffix =
    phrases.length > 1
      ? focus
        ? ` · phrase ${active + 1} of ${phrases.length}`
        : ` · ${phrases.length} phrases`
      : '';
  return (
    <div className="tape-banner">
      {name}
      {suffix}
    </div>
  );
}

// a friendly note on the bare paper before anything is on tape — the
// real entry buttons keep their fixed place in the controls column;
// only the demo phrase lives here, out of the way
function EmptyNote({ ctl }: { ctl: Controller | null }) {
  return (
    <div className="tape-empty">
      <span>
        nothing on tape yet — press Record, open a saved take, or{' '}
        <button type="button" className="tape-demo" onClick={() => ctl?.demo()}>
          try the demo phrase
        </button>
      </span>
    </div>
  );
}

// the recording screen's only controls: Stop transcribes the take;
// discard is the false-start escape (no transcription, back to empty)
function RecordingControls({ ctl }: { ctl: Controller | null }) {
  return (
    <div className="tape-recording-controls">
      <button
        type="button"
        className="btn icon primary on big"
        onClick={() => ctl?.toggleMic()}
      >
        <span className="tape-lamp live" />
        Stop
      </button>
      <button
        type="button"
        className="tape-quiet"
        onClick={() => ctl?.discard()}
      >
        discard
      </button>
    </div>
  );
}

function TruncatedNote() {
  const truncated = useTape((s) => s.truncated);
  if (!truncated) return null;
  return (
    <p className="tape-hint">
      preview cut off here — the print still includes the whole take
    </p>
  );
}

function Transport({ ctl }: { ctl: Controller | null }) {
  const playState = useTape((s) => s.playState);
  const playTime = useTape((s) => s.playTime);
  const clipDur = useTape((s) => s.clipDur);
  const hasAudio = useTape((s) => s.hasAudio);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const speed = useTape((s) => s.speed);
  const idle = !hasAudio || micOn || decoding;

  return (
    <div className="tape-transport">
      <button
        type="button"
        className="btn small icon"
        disabled={idle}
        aria-label="Back 5 seconds"
        title="Back 5 seconds (⇧<)"
        onClick={() => ctl?.seekBy(-5)}
      >
        <Rewind size={15} />
      </button>
      <button
        type="button"
        className={
          playState === 'playing' ? 'btn small icon on' : 'btn small icon'
        }
        disabled={idle}
        aria-label={playState === 'playing' ? 'Pause' : 'Play'}
        title={playState === 'playing' ? 'Pause (space)' : 'Play (space)'}
        onClick={() => ctl?.playPause()}
      >
        {playState === 'playing' ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button
        type="button"
        className="btn small icon"
        disabled={idle}
        aria-label="Forward 5 seconds"
        title="Forward 5 seconds (⇧>)"
        onClick={() => ctl?.seekBy(5)}
      >
        <FastForward size={15} />
      </button>
      <button
        type="button"
        className="btn small icon"
        disabled={idle || (playState === 'stopped' && playTime === 0)}
        aria-label="Stop"
        title="Stop"
        onClick={() => ctl?.stopPlay()}
      >
        <Square size={13} />
      </button>
      <select
        className="tape-select tape-speed"
        value={String(speed)}
        onChange={(e) => ctl?.setSpeed(parseFloat(e.target.value))}
      >
        <option value="0.25">0.25×</option>
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1">1×</option>
      </select>
      <span className="tape-val tape-time">
        {fmtTime(playTime)}
        <span className="tape-dur"> / {fmtTime(clipDur)}</span>
      </span>
      <span className="tape-hint tape-hint-kbd">
        drag tape to seek · space ▶ · ⇧&lt;&gt; ±5s · ←→ notes · ↑↓ pitch · 0–9
        phrases
      </span>
      <span className="tape-hint tape-hint-touch">
        tap the tape to seek · tap a note to edit
      </span>
    </div>
  );
}

function Bottom({ ctl }: { ctl: Controller | null }) {
  const status = useTape((s) => s.status);
  const canPrint = useTape((s) => s.canPrint);
  const printState = useTape((s) => s.printState);
  const phraseCount = useTape((s) => s.phrases.length);
  const focused = useTape(
    (s) => s.phraseView === 'focus' && s.phrases.length > 1,
  );

  return (
    <div className="tape-bottom">
      <span className="status">{status}</span>
      <span className="tape-bottom-actions">
        {phraseCount > 1 && (
          <button
            type="button"
            className="btn small icon"
            disabled={!canPrint || printState === 'queuing'}
            onClick={() => ctl?.printPhrases()}
          >
            <Printer size={14} /> Print phrases ({phraseCount})
          </button>
        )}
        <button
          type="button"
          className="btn icon primary"
          disabled={!canPrint || printState === 'queuing'}
          onClick={() => ctl?.print()}
        >
          <Printer size={15} />{' '}
          {printState === 'queuing'
            ? 'Queuing…'
            : focused
              ? 'Print phrase'
              : 'Print take'}
        </button>
      </span>
    </div>
  );
}

export function TapeTool() {
  // A workbench needs width (the tape scrolls sideways): collapse the
  // sidebar to its rail on entry, restore on exit — same as the Studio.
  const { open, setOpen, isMobile } = useSidebar();
  const sidebarWasOpen = useRef(open);
  useEffect(() => {
    if (isMobile) return;
    const wasOpen = sidebarWasOpen.current;
    setOpen(false);
    return () => setOpen(wasOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const traceRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<Controller | null>(null);

  useEffect(() => {
    const c = createTapeController({
      canvas: canvasRef.current,
      traceCanvas: traceRef.current,
      wrap: wrapRef.current,
      playhead: playheadRef.current,
    });
    setCtl(c);
    return () => c.dispose();
  }, []);

  // keyboard, YouTube-spirited — skipped while a form control has focus:
  //   space play/pause · ⇧< ⇧> ±5s · ←/→ walk notes · ↑/↓ pitch
  //   1–9 phrase, 0 Song · o ornament · j join · s split · c cut
  //   esc deselect · ⌘Z/⇧⌘Z undo/redo · ⌫ remove
  useEffect(() => {
    if (!ctl) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const sel = tapeStore.getState().selection;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (e.key === ' ') {
        e.preventDefault();
        ctl.playPause();
      } else if (e.key === '>' || (e.key === '.' && e.shiftKey)) {
        e.preventDefault();
        ctl.seekBy(5);
      } else if (e.key === '<' || (e.key === ',' && e.shiftKey)) {
        e.preventDefault();
        ctl.seekBy(-5);
      } else if (e.key === 'ArrowRight' && plain) {
        e.preventDefault();
        ctl.selectAdjacent(1);
      } else if (e.key === 'ArrowLeft' && plain) {
        e.preventDefault();
        ctl.selectAdjacent(-1);
      } else if (e.key === 'ArrowUp' && plain && sel) {
        e.preventDefault();
        ctl.nudgePitch(1);
      } else if (e.key === 'ArrowDown' && plain && sel) {
        e.preventDefault();
        ctl.nudgePitch(-1);
      } else if (e.key >= '1' && e.key <= '9' && plain) {
        ctl.selectTab(Number(e.key) - 1);
      } else if (e.key === '0' && plain) {
        ctl.selectTab(-1);
      } else if (e.key === 'Escape') {
        ctl.select(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ctl.redoEdit();
        else ctl.undoEdit();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) {
        e.preventDefault();
        ctl.removeNote();
      } else if (e.key.toLowerCase() === 'o' && plain && sel) {
        ctl.toggleOrnament();
      } else if (e.key.toLowerCase() === 'j' && plain && sel) {
        ctl.joinNext();
      } else if (e.key.toLowerCase() === 's' && plain && sel) {
        ctl.splitAtPlayhead();
      } else if (e.key.toLowerCase() === 'c' && plain && sel) {
        ctl.cutBefore();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  // the page's mode: recording wins, then anything-on-deck, then empty.
  // The canvases never unmount across modes (the controller holds their
  // refs); CSS shows and hides them via data-mode.
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const hasTake = useTape((s) => s.hasTake);
  const hasAudio = useTape((s) => s.hasAudio);
  const mode: TapeMode = micOn
    ? 'recording'
    : hasTake || hasAudio || decoding
      ? 'loaded'
      : 'empty';

  return (
    <div className="tape-tool" data-mode={mode}>
      {mode !== 'recording' && <Controls ctl={ctl} mode={mode} />}
      <div className="tape-stage">
        <TakeBanner />
        <TruncatedNote />
        <div className="tape-frame">
          <div className="tape-roll" ref={wrapRef}>
            <canvas ref={canvasRef} className="tape-paper" />
            <TraceCanvas elRef={traceRef} />
            <SelectionBand />
            <Playhead elRef={playheadRef} />
            {mode === 'empty' && <EmptyNote ctl={ctl} />}
          </div>
        </div>
        {mode === 'recording' && <RecordingControls ctl={ctl} />}
        {mode === 'loaded' && (
          <>
            <Transport ctl={ctl} />
            <Inspector ctl={ctl} />
            <Bottom ctl={ctl} />
          </>
        )}
      </div>
    </div>
  );
}
