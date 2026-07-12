'use client';

// components/tape/tape-tool.tsx — the Tape tool's React layer. Unlike
// the Photo tool's render-once id-contract, these controls are ordinary
// React: they read the shared store (store.js) and call controller
// methods (controller.js). The only imperative DOM left is the canvas
// island inside .tape-roll, which the controller's view module owns —
// React renders those elements once and never touches their contents.

import { useEffect, useRef, useState } from 'react';
import { createTapeController } from '@/components/tape/controller.js';
import { type TapeSettings, tapeStore, useTape } from '@/components/tape/store';
import { KEY_SIGS } from '@/components/tape-renderer.js';
import { useSidebar } from '@/components/ui/sidebar';

type Controller = ReturnType<typeof createTapeController>;

const fmtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

function Slider(props: {
  ctl: Controller | null;
  k: keyof TapeSettings;
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

function Controls({ ctl }: { ctl: Controller | null }) {
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const hasAudio = useTape((s) => s.hasAudio);
  const keySig = useTape((s) => s.settings.keySig);
  const viewMode = useTape((s) => s.viewMode);
  const traceMode = useTape((s) => s.traceMode);
  const editCount = useTape((s) => s.editCount);
  const activePhrase = useTape((s) => s.activePhrase);
  const phraseCount = useTape((s) => s.phrases.length);

  return (
    <div className="tape-controls">
      <div className="tape-btnrow">
        <button
          type="button"
          className={micOn ? 'btn on' : 'btn'}
          disabled={decoding}
          onClick={() => ctl?.toggleMic()}
        >
          {micOn ? 'Stop' : 'Start mic'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={micOn || decoding}
          onClick={() => ctl?.demo()}
        >
          Demo phrase
        </button>
        <button
          type="button"
          className="btn"
          disabled={decoding}
          onClick={() => ctl?.newTake()}
        >
          New take
        </button>
      </div>

      <div className="tape-field">
        <span className="label">Key signature</span>
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
      </div>

      <div className="tape-group">
        <span className="label">
          {phraseCount > 1
            ? `Detection · phrase ${activePhrase + 1}`
            : 'Detection'}
        </span>
        <Slider
          ctl={ctl}
          k="melodyFloor"
          label="Melody floor"
          min={120}
          max={500}
          fmt={(v) => `${v} Hz`}
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
      </div>

      <div className="tape-group">
        <span className="label">View</span>
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
            <option value="aligned">Aligned under the tape</option>
            <option value="linear">Linear time — continuous</option>
          </select>
        </div>
        <Slider
          ctl={ctl}
          k="traceZoom"
          label="Trace stretch"
          min={20}
          max={400}
          fmt={(v) => `${v} px/s`}
        />
      </div>

      <div className="tape-group">
        <span className="label">Layout</span>
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
      </div>

      <Takes ctl={ctl} />

      <div className="tape-group">
        <span className="label">Clip</span>
        <div className="tape-btnrow">
          <button
            type="button"
            className="btn small"
            disabled={!hasAudio || micOn}
            onClick={() => ctl?.saveClip()}
          >
            Save clip
          </button>
          <label
            className={micOn || decoding ? 'btn small disabled' : 'btn small'}
          >
            Load clip
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
        </div>
      </div>
    </div>
  );
}

// saved takes: name + save the current take, and the list to load or
// delete from. The document round-trips whole (edits, versions, layout),
// audio rides along as a lossless WAV. A session that was saved or
// loaded stays tied to its record: Save updates it in place (no audio
// re-upload; renaming the field renames the take), Save as new forks it.
function Takes({ ctl }: { ctl: Controller | null }) {
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

  // the name field follows the tied take (load, save, untie)
  const currentId = current?.id ?? null;
  const currentName = current?.name ?? '';
  useEffect(() => {
    setName(currentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  return (
    <div className="tape-group">
      <span className="label">Takes</span>
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
          className="btn small"
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
      {takes && takes.length > 0 && (
        <div className="tape-takes">
          {takes.map((t) => (
            <div
              key={t.id}
              className={
                t.id === currentId ? 'tape-take-row current' : 'tape-take-row'
              }
            >
              <span className="tape-take-name" title={t.name}>
                {t.name}
              </span>
              <span className="tape-take-sub">
                {fmtTime(t.seconds)} · {t.noteCount} notes
              </span>
              <button
                type="button"
                className="btn small"
                disabled={busy || micOn || decoding}
                onClick={() => ctl?.loadTakeById(t.id)}
              >
                Load
              </button>
              <button
                type="button"
                className="btn small"
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
          ))}
        </div>
      )}
      {takes && takes.length === 0 && (
        <p className="tape-hint">no saved takes yet</p>
      )}
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

// the song is the project; phrases are its pages. Tabs: "Song" opens
// the overview roll (cut management, whole-take print), each numbered
// tab opens that phrase's own tape (edit, settings, confined playback).
// A chip's ✕ merges the phrase into its predecessor.
function PhraseStrip({ ctl }: { ctl: Controller | null }) {
  const hasTake = useTape((s) => s.hasTake);
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const view = useTape((s) => s.phraseView);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const printState = useTape((s) => s.printState);
  if (!hasTake) return null;
  const busy = micOn || decoding;
  const many = phrases.length > 1;

  return (
    <div className="tape-phrases">
      <span className="label">Phrases</span>
      {many && (
        <span className={view === 'song' ? 'tape-chip active' : 'tape-chip'}>
          <button
            type="button"
            className="tape-chip-btn"
            disabled={busy}
            onClick={() => ctl?.selectTab(-1)}
          >
            Song
          </button>
        </span>
      )}
      {many &&
        phrases.map((p, k) => (
          <span
            key={`${p.t0}-${p.t1}`}
            className={
              view === 'focus' && k === active
                ? 'tape-chip active'
                : 'tape-chip'
            }
          >
            <button
              type="button"
              className="tape-chip-btn"
              disabled={busy}
              onClick={() => ctl?.selectTab(k)}
            >
              {k + 1} · {fmtTime(p.t0)}–{fmtTime(p.t1)}
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
          </span>
        ))}
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={() => ctl?.cutAtBreaths()}
      >
        Cut at breaths
      </button>
      {many && (
        <button
          type="button"
          className="btn small"
          disabled={busy || printState === 'queuing'}
          onClick={() => ctl?.printPhrases()}
        >
          Print phrases ({phrases.length})
        </button>
      )}
      {!many && (
        <span className="tape-hint">
          cut at breaths, or select a note and use Cut before
        </span>
      )}
    </div>
  );
}

function StageHead() {
  const noteNow = useTape((s) => s.noteNow);
  const truncated = useTape((s) => s.truncated);
  return (
    <div className="tape-stagehead">
      <span className="label">Tape — prints exactly as shown</span>
      {truncated && (
        <span className="tape-hint">
          preview cut off here — the print still includes the whole take
        </span>
      )}
      <span className="tape-now">
        <span className="label">Sounding</span>
        <span className="tape-val">{noteNow}</span>
      </span>
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
      {selection ? (
        <>
          <span className="tape-val">
            {selection.label} · {fmtTime(selection.t0)}–{fmtTime(selection.t1)}
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() => ctl?.nudgePitch(-1)}
          >
            Pitch −
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => ctl?.nudgePitch(1)}
          >
            Pitch +
          </button>
          <button
            type="button"
            className={selection.ornament ? 'btn small pressed' : 'btn small'}
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
            title={canSplit ? undefined : 'seek inside the note first'}
            onClick={() => ctl?.splitAtPlayhead()}
          >
            Split at playhead
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selection.canJoin}
            onClick={() => ctl?.joinNext()}
          >
            Join next
          </button>
          <button
            type="button"
            className={
              cuts.includes(selection.t0) ? 'btn small pressed' : 'btn small'
            }
            onClick={() => ctl?.cutBefore()}
          >
            Cut before
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => ctl?.removeNote()}
          >
            Remove
          </button>
        </>
      ) : (
        <span className="tape-hint">
          {viewMode === 'full'
            ? 'click a note on the tape to edit it'
            : 'switch to Full notation to edit'}
        </span>
      )}
      <span className="tape-inspector-spacer" />
      <button
        type="button"
        className="btn small"
        disabled={!editCount}
        onClick={() => ctl?.undoEdit()}
      >
        Undo{editCount ? ` (${editCount})` : ''}
      </button>
      <button
        type="button"
        className="btn small"
        disabled={!redoCount}
        onClick={() => ctl?.redoEdit()}
      >
        Redo
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
        className={playState === 'playing' ? 'btn small on' : 'btn small'}
        disabled={idle}
        onClick={() => ctl?.playPause()}
      >
        {playState === 'playing' ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        className="btn small"
        disabled={idle || (playState === 'stopped' && playTime === 0)}
        onClick={() => ctl?.stopPlay()}
      >
        Stop
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
      <span className="tape-val">
        {fmtTime(playTime)} / {fmtTime(clipDur)}
      </span>
      <span className="tape-hint">
        click or drag on the tape to seek · raw pitch below the staff
      </span>
    </div>
  );
}

function Bottom({ ctl }: { ctl: Controller | null }) {
  const log = useTape((s) => s.log);
  const status = useTape((s) => s.status);
  const canPrint = useTape((s) => s.canPrint);
  const printState = useTape((s) => s.printState);
  const focused = useTape(
    (s) => s.phraseView === 'focus' && s.phrases.length > 1,
  );

  return (
    <div className="tape-bottom">
      <div className="tape-log-wrap">
        <span className="label">Notes</span>
        <div className="tape-log">
          {log.map((l) => (
            <div key={l.id}>{l.text}</div>
          ))}
        </div>
      </div>
      <div className="tape-actions">
        <span className="status">{status}</span>
        <button
          type="button"
          className="btn"
          disabled={!canPrint || printState === 'queuing'}
          onClick={() => ctl?.print()}
        >
          {printState === 'queuing'
            ? 'Queuing…'
            : focused
              ? 'Print phrase'
              : 'Print take'}
        </button>
      </div>
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

  // editing shortcuts — skipped while a form control has focus
  useEffect(() => {
    if (!ctl) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.key === 'Escape') {
        ctl.select(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ctl.redoEdit();
        else ctl.undoEdit();
      } else if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        tapeStore.getState().selection
      ) {
        e.preventDefault();
        ctl.removeNote();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  return (
    <div className="tape-tool">
      <Controls ctl={ctl} />
      <div className="tape-stage">
        <StageHead />
        <div className="tape-roll" ref={wrapRef}>
          <canvas ref={canvasRef} />
          <canvas ref={traceRef} className="tape-trace" height={110} />
          <SelectionBand />
          <Playhead elRef={playheadRef} />
        </div>
        <PhraseStrip ctl={ctl} />
        <Transport ctl={ctl} />
        <Inspector ctl={ctl} />
        <Bottom ctl={ctl} />
      </div>
    </div>
  );
}
