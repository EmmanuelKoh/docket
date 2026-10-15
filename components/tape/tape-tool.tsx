'use client';

// components/tape/tape-tool.tsx — the Tape studio's React layer, built
// from the E hardware kit (components/hardware/). The page commits to the
// session's state (data-mode on the root): EMPTY shows a short paper
// strip with the note (and the demo action) beside the session keys and
// the takes list; RECORDING reduces to the REC line, the full-height live
// trace, Stop and Discard; LOADED is the full bench: the stage (paper
// strip, transport, note inspector, print keys) and the project column
// (takes, key, settings). Controls read the shared store (store.ts) and
// call controller methods (controller.js); the only imperative DOM is the
// canvas island inside .tape-roll, which the controller's view module
// owns. The canvases stay mounted in every mode and CSS hides them; the
// roll holds exactly the two canvases and the playhead.

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FastForward,
  Pause,
  Play,
  Redo2,
  Rewind,
  Scissors,
  Square,
  Undo2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Fader } from '@/components/hardware/fader';
import { Field } from '@/components/hardware/field';
import { Led } from '@/components/hardware/led';
import { Module } from '@/components/hardware/module';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Note } from '@/components/hardware/text';
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

type Controller = ReturnType<typeof createTapeController>;

// which face the page wears; recording wins, then loaded, then empty
type TapeMode = 'empty' | 'loaded' | 'recording';

const fmtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

// a fader: the label and its readout over a slot with a ribbed cap
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
  const id = useId();
  return (
    <div className="tape-slider">
      <label htmlFor={id} className="tape-slider-label">
        {props.label}
      </label>
      <output htmlFor={id} className="tape-slider-value hw-mono">
        {props.fmt ? props.fmt(value) : value}
      </output>
      <Fader
        id={id}
        min={props.min}
        max={props.max}
        value={value}
        disabled={props.disabled}
        onChange={(e) =>
          props.ctl?.setSetting(props.k, parseFloat(e.target.value))
        }
      />
    </div>
  );
}

// a collapsible settings section on the Settings module: settings earn
// space only when open
function Section(props: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="tape-section">
      <summary className="tape-section-head">
        <span className="hw-row-text">
          <span className="hw-row-title">{props.title}</span>
          {props.sub ? <span className="hw-row-sub">{props.sub}</span> : null}
        </span>
        <ChevronDown className="tape-section-chev" size={18} aria-hidden />
      </summary>
      <div className="tape-section-body">{props.children}</div>
    </details>
  );
}

// a hidden file input behind a key — a loaded file opens as a new take
function LoadAudio({ ctl }: { ctl: Controller | null }) {
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const input = useRef<HTMLInputElement>(null);
  const off = micOn || decoding;
  return (
    <>
      <PushKey disabled={off} onClick={() => input.current?.click()}>
        Load audio
      </PushKey>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        tabIndex={-1}
        disabled={off}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ctl?.loadClip(file);
          e.target.value = '';
        }}
      />
    </>
  );
}

// the session keys: both start a NEW take. They hold the top of the
// project column in every mode, so Record never moves.
function SessionKeys({ ctl }: { ctl: Controller | null }) {
  const decoding = useTape((s) => s.decoding);
  const micOn = useTape((s) => s.micOn);
  return (
    <KeyGroup className="tape-session">
      <PushKey
        disabled={decoding}
        onClick={() => ctl?.toggleMic()}
        // red only while the mic is live
        led={<Led state={micOn ? 'printing' : 'offline'} lens="red" />}
      >
        Record
      </PushKey>
      <LoadAudio ctl={ctl} />
    </KeyGroup>
  );
}

// the open project's phrases, under its takes-list row: "Song" is the
// whole-take overview, each phrase opens its own tape
function PhraseList({ ctl }: { ctl: Controller | null }) {
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const view = useTape((s) => s.phraseView);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const busy = micOn || decoding;
  const many = phrases.length > 1;

  return (
    <ul className="tape-phrases">
      {many && (
        <li className="tape-phrase">
          <button
            type="button"
            className="tape-phrase-open"
            aria-current={view === 'song' ? 'true' : undefined}
            disabled={busy}
            onClick={() => ctl?.selectTab(-1)}
          >
            <span className="tape-phrase-name">Song</span>
            <span className="tape-take-sub">All phrases</span>
          </button>
        </li>
      )}
      {many &&
        phrases.map((p, k) => (
          <li key={`${p.t0}-${p.t1}`} className="tape-phrase">
            <button
              type="button"
              className="tape-phrase-open"
              aria-current={
                view === 'focus' && k === active ? 'true' : undefined
              }
              disabled={busy}
              onClick={() => ctl?.selectTab(k)}
            >
              <span className="tape-phrase-name">Phrase {k + 1}</span>
              <span className="tape-take-sub">
                {fmtTime(p.t0)}–{fmtTime(p.t1)}
                {p.editCount || p.frozen ? ' · Edited' : ''}
              </span>
            </button>
            {k > 0 && (
              <KeyGroup>
                <PushKey
                  size="compact"
                  disabled={busy}
                  title={`Merge phrase ${k + 1} into phrase ${k}`}
                  onClick={() => ctl?.removeCutAt(k - 1)}
                >
                  Merge
                </PushKey>
              </KeyGroup>
            )}
          </li>
        ))}
      <li className="tape-phrase tape-phrase-cut">
        <KeyGroup>
          <PushKey
            size="compact"
            disabled={busy}
            title="Start a phrase after each breath"
            onClick={() => ctl?.cutAtBreaths()}
          >
            Cut at breaths
          </PushKey>
        </KeyGroup>
      </li>
    </ul>
  );
}

// the takes list: every saved take is a project. Open one with its row;
// the open one (or the unsaved session) expands to its phrases. Delete
// takes two presses and is soft (Undo restores it).
function Takes({ ctl }: { ctl: Controller | null }) {
  const takes = useTape((s) => s.takes);
  const busy = useTape((s) => s.persistBusy);
  const hasTake = useTape((s) => s.hasTake);
  const hasAudio = useTape((s) => s.hasAudio);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const current = useTape((s) => s.currentTake);
  const clipDur = useTape((s) => s.clipDur);
  const lastDeleted = useTape((s) => s.lastDeleted);
  const [name, setName] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const canSave = hasTake && hasAudio && !micOn && !decoding && !busy;

  // the name field follows the open take (load, save, untie)
  const currentId = current?.id ?? null;
  const currentName = current?.name ?? '';
  useEffect(() => {
    setName(currentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  return (
    <Module number="01" title="Takes" flush>
      {hasTake && (
        <div className="tape-save">
          <Field
            label="Take name"
            placeholder="Take"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="tape-save-keys">
            <KeyGroup>
              <PushKey
                disabled={!canSave}
                onClick={() => ctl?.saveTake(name.trim() || 'Take')}
              >
                {current ? 'Save' : 'Save take'}
              </PushKey>
              {current && (
                <PushKey
                  disabled={!canSave}
                  onClick={() => ctl?.saveTakeAsNew(name.trim() || 'Take')}
                >
                  Save as new
                </PushKey>
              )}
            </KeyGroup>
            {hasAudio && (
              <button
                type="button"
                className="hw-link tape-textbtn"
                disabled={micOn || decoding}
                onClick={() => ctl?.downloadTake()}
              >
                Download WAV
              </button>
            )}
          </div>
        </div>
      )}
      <ul className="tape-takes">
        {hasTake && !current && (
          <li className="tape-take">
            <div className="tape-take-row">
              <span className="tape-take-open" aria-current="true">
                <span className="tape-take-name">Unsaved take</span>
                <span className="tape-take-sub">Open · {fmtTime(clipDur)}</span>
              </span>
            </div>
            <PhraseList ctl={ctl} />
          </li>
        )}
        {takes?.map((t) => {
          const open = t.id === currentId;
          return (
            <li key={t.id} className="tape-take">
              <div className="tape-take-row">
                <button
                  type="button"
                  className="tape-take-open"
                  aria-current={open ? 'true' : undefined}
                  disabled={busy || micOn || decoding || open}
                  onClick={() => ctl?.loadTakeById(t.id)}
                >
                  <span className="tape-take-name" title={t.name}>
                    {t.name}
                  </span>
                  <span className="tape-take-sub">
                    {open ? 'Open · ' : ''}
                    {fmtTime(t.seconds)}
                  </span>
                </button>
                <KeyGroup>
                  {armed === t.id ? (
                    <>
                      <PushKey size="compact" onClick={() => setArmed(null)}>
                        Keep
                      </PushKey>
                      <PushKey
                        size="compact"
                        disabled={busy}
                        onClick={() => {
                          setArmed(null);
                          ctl?.deleteTakeById(t.id);
                        }}
                      >
                        Delete take
                      </PushKey>
                    </>
                  ) : (
                    <PushKey
                      size="compact"
                      disabled={busy}
                      title={`Delete ${t.name}`}
                      onClick={() => setArmed(t.id)}
                    >
                      Delete
                    </PushKey>
                  )}
                </KeyGroup>
              </div>
              {open && <PhraseList ctl={ctl} />}
            </li>
          );
        })}
        {takes && takes.length === 0 && !hasTake && (
          <li className="tape-take">
            <Note className="tape-empty-list">No saved takes yet.</Note>
          </li>
        )}
      </ul>
      {lastDeleted && (
        <p className="tape-deleted hw-note">
          Deleted “{lastDeleted.name}”.
          <button
            type="button"
            className="hw-link tape-textbtn"
            disabled={busy}
            onClick={() => ctl?.undeleteTake()}
          >
            Undo
          </button>
        </p>
      )}
    </Module>
  );
}

// the key: Western major/minor signatures, or the mugham modes (Rast,
// Shur, Segah, …) on a chosen tonic — a mugham pick derives the
// best-fit printed signature, shown in the note underneath
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
    <Module number="02" title="Key">
      <Field
        as="select"
        label="System"
        value={system}
        onChange={(e) => ctl?.setSetting('scaleSystem', e.target.value)}
      >
        <option value="western">Western major and minor</option>
        <option value="mugham">Mugham modes</option>
      </Field>
      {system === 'western' ? (
        <Field
          as="select"
          label="Key"
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
        </Field>
      ) : (
        <>
          <div className="tape-pair">
            <Field
              as="select"
              label="Mode"
              value={mode}
              onChange={(e) => ctl?.setSetting('mughamMode', e.target.value)}
            >
              {MUGHAM_MODES.map((m: { id: string; name: string }) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Field>
            <Field
              as="select"
              label="Tonic"
              value={tonic}
              onChange={(e) =>
                ctl?.setSetting('mughamTonic', parseInt(e.target.value, 10))
              }
            >
              {TONIC_NAMES.map((t: string, pc: number) => (
                <option key={t} value={pc}>
                  {t}
                </option>
              ))}
            </Field>
          </div>
          <Note>
            {mughamKey(mode, tonic).name} prints as {sigName}.
          </Note>
        </>
      )}
    </Module>
  );
}

function Settings({ ctl }: { ctl: Controller | null }) {
  const keySig = useTape((s) => s.settings.keySig);
  const viewMode = useTape((s) => s.viewMode);
  const traceMode = useTape((s) => s.traceMode);
  const frozen = useTape((s) => s.frozen);
  const activePhrase = useTape((s) => s.activePhrase);
  const phraseCount = useTape((s) => s.phrases.length);

  return (
    <Module number="03" title="Settings" flush>
      <Section
        title="Detection"
        sub={phraseCount > 1 ? `Phrase ${activePhrase + 1}` : undefined}
      >
        <Slider
          ctl={ctl}
          k="melodyFloor"
          label="Melody floor"
          min={120}
          max={500}
          fmt={(v) => `${v} Hz / ${noteLabel(floorToMidi(v), keySig)}`}
          disabled={frozen}
        />
        {frozen && (
          <>
            <Note>
              {phraseCount > 1
                ? `Editing pauses detection. Start over detects phrase ${activePhrase + 1} again.`
                : 'Editing pauses detection. Start over detects the recording again.'}
            </Note>
            <KeyGroup className="self-start">
              <PushKey size="compact" onClick={() => ctl?.reread()}>
                Start over
              </PushKey>
            </KeyGroup>
          </>
        )}
      </Section>

      <Section title="View">
        <Field
          as="select"
          label="Notation"
          value={viewMode}
          onChange={(e) => ctl?.setViewMode(e.target.value)}
        >
          <option value="full">Full notation</option>
          <option value="skeleton">Main notes only</option>
        </Field>
        <Field
          as="select"
          label="Pitch trace"
          value={traceMode}
          onChange={(e) => ctl?.setTraceMode(e.target.value)}
        >
          <option value="hidden">Hidden</option>
          <option value="aligned">Aligned under the tape</option>
          <option value="linear">Linear time</option>
        </Field>
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
      </Section>

      <Section title="Layout">
        <Slider
          ctl={ctl}
          k="msPerRow"
          label="Time per row"
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
      </Section>
    </Module>
  );
}

// the project column. The empty page stops after the takes list; the key
// and the settings appear once there is something to act on.
function Controls({ ctl, mode }: { ctl: Controller | null; mode: TapeMode }) {
  const keySig = useTape((s) => s.settings.keySig);
  return (
    <div className="tape-controls">
      <SessionKeys ctl={ctl} />
      <Takes ctl={ctl} />
      {mode === 'loaded' && (
        <>
          <KeyPicker ctl={ctl} keySig={keySig} />
          <Settings ctl={ctl} />
        </>
      )}
    </div>
  );
}

// the note inspector: what the selected note is, and what can be done to
// it. Shown once a take is decoded; before a selection it teaches the
// click. Undo and Redo work without a selection.
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
  const isCut = !!selection && cuts.includes(selection.t0);
  return (
    <div className="tape-inspector">
      <div className="tape-line">
        <KeyGroup>
          <PushKey
            size="compact"
            aria-label="Previous note"
            title="Previous note (←)"
            onClick={() => ctl?.selectAdjacent(-1)}
          >
            <ChevronLeft size={18} />
          </PushKey>
          <PushKey
            size="compact"
            aria-label="Next note"
            title="Next note (→)"
            onClick={() => ctl?.selectAdjacent(1)}
          >
            <ChevronRight size={18} />
          </PushKey>
        </KeyGroup>
        {selection?.mark ? (
          <span className="tape-readout hw-mono hw-ink">
            Ornament · {fmtTime(selection.t0)}
          </span>
        ) : selection ? (
          <span className="tape-readout hw-mono hw-ink">
            {selection.label} · {fmtTime(selection.t0)}–{fmtTime(selection.t1)}
          </span>
        ) : (
          <Note as="span" className="tape-readout-hint hw-ink">
            {viewMode === 'full'
              ? 'Pick a note on the tape to edit it.'
              : 'Switch to Full notation to edit.'}
          </Note>
        )}
        <KeyGroup className="tape-line-end">
          <PushKey
            size="compact"
            disabled={!editCount}
            aria-label={editCount ? `Undo, ${editCount} edits` : 'Undo'}
            title="Undo (⌘Z)"
            onClick={() => ctl?.undoEdit()}
          >
            <Undo2 size={16} />
            {editCount ? <span className="hw-mono">{editCount}</span> : null}
          </PushKey>
          <PushKey
            size="compact"
            disabled={!redoCount}
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            onClick={() => ctl?.redoEdit()}
          >
            <Redo2 size={16} />
          </PushKey>
        </KeyGroup>
      </div>
      {selection?.mark ? (
        // an ornament arc — a standalone mark or a note's flag arc: both
        // select the same way and can only be removed (removing a flag arc
        // turns the owner note's ornament off)
        <KeyGroup className="tape-edit-keys">
          <PushKey
            size="compact"
            title="Remove ornament (⌫)"
            onClick={() => ctl?.removeNote()}
          >
            Remove
          </PushKey>
        </KeyGroup>
      ) : selection ? (
        <KeyGroup className="tape-edit-keys">
          <PushKey
            size="compact"
            aria-label="Pitch down a semitone"
            title="Pitch down a semitone (↓)"
            onClick={() => ctl?.nudgePitch(-1)}
          >
            <ChevronDown size={18} />
          </PushKey>
          <PushKey
            size="compact"
            aria-label="Pitch up a semitone"
            title="Pitch up a semitone (↑)"
            onClick={() => ctl?.nudgePitch(1)}
          >
            <ChevronUp size={18} />
          </PushKey>
          <PushKey
            size="compact"
            down={!!selection.ornament}
            aria-pressed={!!selection.ornament}
            title="Ornament arc (O)"
            onClick={() => ctl?.toggleOrnament()}
          >
            Ornament
          </PushKey>
          <PushKey
            size="compact"
            down={!!selection.slide}
            aria-pressed={!!selection.slide}
            title="Slide from the previous note"
            onClick={() => ctl?.toggleSlide()}
          >
            Slide
          </PushKey>
          <PushKey
            size="compact"
            disabled={!canSplit}
            title={
              canSplit
                ? 'Split at the playhead (S)'
                : 'Move the playhead into the note first'
            }
            onClick={() => ctl?.splitAtPlayhead()}
          >
            Split
          </PushKey>
          <PushKey
            size="compact"
            disabled={!selection.canJoin}
            title="Join with the next note (J)"
            onClick={() => ctl?.joinNext()}
          >
            Join
          </PushKey>
          <PushKey
            size="compact"
            down={isCut}
            aria-pressed={isCut}
            title="Start a new phrase at this note (C)"
            onClick={() => ctl?.cutBefore()}
          >
            <Scissors size={15} />
            Cut before
          </PushKey>
          <PushKey
            size="compact"
            title="Remove note (⌫)"
            onClick={() => ctl?.removeNote()}
          >
            Remove
          </PushKey>
        </KeyGroup>
      ) : null}
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

// the line over the strip, printed on the ground: the open take's name
// (and its phrase), or the red REC counter while the mic is live
function StageCaption() {
  const micOn = useTape((s) => s.micOn);
  const hasTake = useTape((s) => s.hasTake);
  const current = useTape((s) => s.currentTake);
  const clipDur = useTape((s) => s.clipDur);
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const focus = useTape((s) => s.phraseView === 'focus');

  if (micOn) {
    return (
      <p className="tape-caption hw-ink">
        <span className="tape-rec">Rec</span>
        <span className="tape-caption-time hw-mono">{fmtTime(clipDur)}</span>
      </p>
    );
  }
  if (!hasTake) return null;
  const sub =
    phrases.length > 1
      ? focus
        ? `Phrase ${active + 1} of ${phrases.length}`
        : `${phrases.length} phrases`
      : '';
  return (
    <p className="tape-caption hw-ink">
      <span className="tape-caption-name">
        {current?.name ?? 'Unsaved take'}
      </span>
      {sub ? <span className="tape-caption-sub hw-mono">{sub}</span> : null}
    </p>
  );
}

// the note on the bare paper before anything is on tape. The entry keys
// keep their place in the project column; only the demo lives here.
function EmptyNote({ ctl }: { ctl: Controller | null }) {
  return (
    <div className="tape-empty">
      <p className="tape-empty-title">Nothing on tape yet.</p>
      <p className="tape-empty-text">
        Press Record, open a saved take, or{' '}
        <button type="button" className="tape-demo" onClick={() => ctl?.demo()}>
          load the demo phrase
        </button>
        .
      </p>
    </div>
  );
}

// the recording screen's only controls: Stop transcribes the take;
// Discard is the false-start escape (no transcription, back to empty)
function RecordingControls({ ctl }: { ctl: Controller | null }) {
  return (
    <div className="tape-line">
      <KeyGroup>
        <PushKey
          size="large"
          onClick={() => ctl?.toggleMic()}
          // live audio: the red LED
          led={<Led state="printing" />}
        >
          Stop
        </PushKey>
      </KeyGroup>
      <button
        type="button"
        className="hw-link tape-textbtn"
        onClick={() => ctl?.discard()}
      >
        Discard
      </button>
    </div>
  );
}

function TruncatedNote() {
  const truncated = useTape((s) => s.truncated);
  if (!truncated) return null;
  return (
    <Note className="hw-ink">
      The preview stops here. The print includes the whole take.
    </Note>
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
  const playing = playState === 'playing';

  return (
    <div className="tape-line">
      <KeyGroup>
        <PushKey
          size="compact"
          disabled={idle}
          aria-label="Back 5 seconds"
          title="Back 5 seconds (⇧<)"
          onClick={() => ctl?.seekBy(-5)}
        >
          <Rewind size={17} />
        </PushKey>
        <PushKey
          size="compact"
          down={playing}
          disabled={idle}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
          onClick={() => ctl?.playPause()}
          // live audio: held down with the red LED while it plays
          led={playing ? <Led state="printing" /> : null}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </PushKey>
        <PushKey
          size="compact"
          disabled={idle}
          aria-label="Forward 5 seconds"
          title="Forward 5 seconds (⇧>)"
          onClick={() => ctl?.seekBy(5)}
        >
          <FastForward size={17} />
        </PushKey>
        <PushKey
          size="compact"
          disabled={idle || (playState === 'stopped' && playTime === 0)}
          aria-label="Stop"
          title="Stop"
          onClick={() => ctl?.stopPlay()}
        >
          <Square size={15} />
        </PushKey>
      </KeyGroup>
      <label className="tape-speed">
        <span className="hw-label">Speed</span>
        <select
          className="hw-field hw-field--select"
          value={String(speed)}
          onChange={(e) => ctl?.setSpeed(parseFloat(e.target.value))}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1">1×</option>
        </select>
      </label>
      <span className="tape-time hw-mono hw-ink">
        {fmtTime(playTime)}
        <span className="tape-time-dur"> / {fmtTime(clipDur)}</span>
      </span>
      <Note as="span" className="tape-hint tape-hint-kbd hw-ink">
        Drag the tape to seek · Space play · ⇧&lt; ⇧&gt; 5 s · ← → note · ↑ ↓
        pitch · 0–9 phrase
      </Note>
      <Note as="span" className="tape-hint tape-hint-touch hw-ink">
        Tap the tape to seek. Tap a note to edit it.
      </Note>
    </div>
  );
}

// the controller's status line outside the loaded bench (a mic that
// failed to start, a take that failed to load), so no error goes unseen
function LooseStatus() {
  const status = useTape((s) => s.status);
  if (!status) return null;
  return <Note className="tape-status hw-ink">{status}</Note>;
}

function Bottom({ ctl }: { ctl: Controller | null }) {
  const status = useTape((s) => s.status);
  const canPrint = useTape((s) => s.canPrint);
  const printState = useTape((s) => s.printState);
  const phraseCount = useTape((s) => s.phrases.length);
  const focused = useTape(
    (s) => s.phraseView === 'focus' && s.phrases.length > 1,
  );
  const off = !canPrint || printState === 'queuing';

  return (
    <div className="tape-bottom">
      <Note className="tape-status hw-ink">{status}</Note>
      <div className="tape-print">
        {phraseCount > 1 && (
          <KeyGroup>
            <PushKey disabled={off} onClick={() => ctl?.printPhrases()}>
              Print phrases ({phraseCount})
            </PushKey>
          </KeyGroup>
        )}
        <KeyGroup>
          <PushKey variant="print" disabled={off} onClick={() => ctl?.print()}>
            {printState === 'queuing'
              ? 'Queuing…'
              : focused
                ? 'Print phrase'
                : 'Print take'}
          </PushKey>
        </KeyGroup>
      </div>
    </div>
  );
}

export function TapeTool() {
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
  const traceMode = useTape((s) => s.traceMode);
  const mode: TapeMode = micOn
    ? 'recording'
    : hasTake || hasAudio || decoding
      ? 'loaded'
      : 'empty';

  return (
    <div className="tape-tool" data-mode={mode}>
      <div className="tape-stage">
        <StageCaption />
        <TruncatedNote />
        {/* the paper strip: the sheet behind the roll gives it its
            margins, shadow and torn end, from outside the canvases */}
        <div className="tape-frame" data-trace={traceMode}>
          <div className="tape-sheet" aria-hidden="true">
            <div className="tape-sheet-paper" />
          </div>
          <div className="tape-roll" ref={wrapRef}>
            <canvas ref={canvasRef} className="tape-paper" />
            <TraceCanvas elRef={traceRef} />
            <Playhead elRef={playheadRef} />
          </div>
          {mode === 'empty' && <EmptyNote ctl={ctl} />}
        </div>
        {mode !== 'loaded' && <LooseStatus />}
        {mode === 'recording' && <RecordingControls ctl={ctl} />}
        {mode === 'loaded' && (
          <>
            <Transport ctl={ctl} />
            <Inspector ctl={ctl} />
            <Bottom ctl={ctl} />
          </>
        )}
      </div>
      {mode !== 'recording' && <Controls ctl={ctl} mode={mode} />}
    </div>
  );
}
