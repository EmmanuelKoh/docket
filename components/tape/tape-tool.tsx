'use client';

// components/tape/tape-tool.tsx — the Tape tool's React layer: one tape
// deck built from the parts kit (components/hardware/kit/). The head plate
// carries the engraved name and the printer lamp; the window under it
// shows the paper strip running through the deck and the pitch trace on
// the screen below it; then the transport, the note editor and the print
// keys, each on its own plate; then the takes and the settings plates.
//
// The page commits to the session's state (data-mode on the root): EMPTY
// shows a blank strip of paper with a printed note, Record, Load and Demo,
// the time counter at zero, and the takes;
// RECORDING shows the live trace, Record held with its LED lit, Stop and
// Discard; LOADED is the full deck. Controls read the shared store
// (store.ts) and call controller methods (controller.js); the only
// imperative DOM is the canvas island inside .tape-roll, which the
// controller's view module owns. The canvases stay mounted in every mode
// and CSS hides them; the roll holds exactly the two canvases and the
// playhead.

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Body, Plate, PlateTitle } from '@/components/hardware/kit/body';
import { Fader } from '@/components/hardware/kit/controls';
import { Counter } from '@/components/hardware/kit/counter';
import { digitDrums } from '@/components/hardware/kit/counter-window';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Screen } from '@/components/hardware/kit/screen';
import { Row, Rows, RowText } from '@/components/hardware/kit/sheet';
import { Switch } from '@/components/hardware/kit/switch';
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

const SPEEDS = [
  { value: '0.25', label: '0.25×' },
  { value: '0.5', label: '0.5×' },
  { value: '0.75', label: '0.75×' },
  { value: '1', label: '1×' },
] as const;

const TRACE_MODES = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'aligned', label: 'Aligned' },
  { value: 'linear', label: 'Linear' },
] as const;

const MODE_OPTIONS = MUGHAM_MODES.map((m: { id: string; name: string }) => ({
  value: m.id,
  label: m.name,
}));

const TONIC_OPTIONS = TONIC_NAMES.map((t: string, pc: number) => ({
  value: String(pc),
  label: t,
}));

// ---------------------------------------------------------------------
// Small parts

/** The tape counter: the time on drums behind a window, a colon and a
 *  point printed on the window between them. */
function TimeCounter({
  seconds,
  label,
  className,
}: {
  seconds: number;
  label: string;
  className?: string;
}) {
  const t = fmtTime(seconds);
  const [min, rest] = t.split(':');
  const [sec, hundredths] = rest.split('.');
  return (
    <span
      className={
        className
          ? `pk-counter tape-counter ${className}`
          : 'pk-counter tape-counter'
      }
    >
      <span className="pk-counter-window" aria-hidden="true">
        {digitDrums(min)}
        <span className="tape-counter-sep">:</span>
        {digitDrums(sec)}
        <span className="tape-counter-sep">.</span>
        {digitDrums(hundredths)}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Record's legend: the word with the indicator LED set into the strip
 *  before it, lit red while the mic is live. */
function RecordLegend({ live }: { live: boolean }) {
  return (
    <>
      <span
        className={live ? 'tape-strip-led is-lit' : 'tape-strip-led'}
        aria-hidden="true"
      />
      <span className="tape-legend-text">Record</span>
    </>
  );
}

/** A labelled control on a plate: the engraved name on the legend line,
 *  the control under it, level with the key caps beside it. */
function Group({
  name,
  htmlFor,
  className,
  children,
}: {
  name: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `tape-grp ${className}` : 'tape-grp'}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pk-engr tape-grp-name">
          {name}
        </label>
      ) : (
        <span className="pk-engr tape-grp-name" aria-hidden="true">
          {name}
        </span>
      )}
      <div className="tape-grp-ctl">{children}</div>
    </div>
  );
}

/** A setting on a plate: the engraved name and its reading at the left,
 *  the short slider at the right. */
function Setting(props: {
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
    <Row className="tape-set">
      <span className="tape-set-text">
        <label htmlFor={id} className="pk-engr">
          {props.label}
        </label>
        <output htmlFor={id} className="tape-set-value">
          {props.fmt ? props.fmt(value) : value}
        </output>
      </span>
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
    </Row>
  );
}

/** A numbered plate section's title. */
function SectionTitle({
  number,
  id,
  sub,
  children,
}: {
  number: string;
  id?: string;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tape-section-title">
      <PlateTitle number={number}>
        <Engraved as="h2" id={id}>
          {children}
        </Engraved>
      </PlateTitle>
      {sub ? (
        <Engraved tone="soft" className="tape-section-sub">
          {sub}
        </Engraved>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// The window: the paper strip through the deck, the trace on the screen

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

// the note printed on the blank strip before anything is on tape (its
// keys, Record, Load and Demo, sit in the deck's well below)
function EmptyNote() {
  return (
    <div className="tape-empty">
      <p className="tape-empty-title">Nothing on tape yet.</p>
      <p className="tape-empty-text">
        Press Record, open a saved take, or press Demo to load a sample phrase.
      </p>
    </div>
  );
}

// the display's status line: the open take (and its phrase), or REC and
// the running time while the mic is live
function Osd() {
  const micOn = useTape((s) => s.micOn);
  const hasTake = useTape((s) => s.hasTake);
  const decoding = useTape((s) => s.decoding);
  const current = useTape((s) => s.currentTake);
  const clipDur = useTape((s) => s.clipDur);
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const focus = useTape((s) => s.phraseView === 'focus');

  if (micOn) {
    return (
      <div className="tape-osd">
        <span>
          <span className="tape-osd-rec">Rec</span> {fmtTime(clipDur)}
        </span>
        <span>Live pitch</span>
      </div>
    );
  }
  const name = hasTake || decoding ? (current?.name ?? 'Unsaved take') : '';
  const phrase =
    phrases.length > 1
      ? focus
        ? `Phrase ${active + 1} of ${phrases.length} · `
        : `${phrases.length} phrases · `
      : '';
  return (
    <div className="tape-osd">
      <span className="tape-osd-name">{name}</span>
      <span>{clipDur > 0 ? `${phrase}${fmtTime(clipDur)}` : ''}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
// The deck plate: session keys, transport, counter and speed

// a hidden file input behind Load: a loaded file opens as a new take
function useLoadAudio(ctl: Controller | null) {
  const input = useRef<HTMLInputElement>(null);
  const el = (disabled: boolean) => (
    <input
      ref={input}
      type="file"
      accept="audio/*"
      hidden
      tabIndex={-1}
      disabled={disabled}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) ctl?.loadClip(file);
        e.target.value = '';
      }}
    />
  );
  return { open: () => input.current?.click(), el };
}

/** The transport: Rewind, Play (held down while the clip plays), Forward
 *  and Stop. On a phone it also docks at the foot of the screen. */
function Transport({
  ctl,
  className,
}: {
  ctl: Controller | null;
  className: string;
}) {
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const playState = useTape((s) => s.playState);
  const playTime = useTape((s) => s.playTime);
  const hasAudio = useTape((s) => s.hasAudio);
  const idle = !hasAudio || micOn || decoding;
  const playing = playState === 'playing';
  return (
    <KeyWell label="Transport" className={className}>
      <Key
        legend="Rewind"
        title="Back 5 seconds (⇧<)"
        disabled={idle}
        onClick={() => ctl?.seekBy(-5)}
      />
      <Key
        legend="Play"
        // held down while the clip plays; press again to pause
        pressed={playing}
        title={playing ? 'Pause (space)' : 'Play (space)'}
        disabled={idle}
        onClick={() => ctl?.playPause()}
      />
      <Key
        legend="Forward"
        title="Forward 5 seconds (⇧>)"
        disabled={idle}
        onClick={() => ctl?.seekBy(5)}
      />
      <Key
        legend="Stop"
        title="Stop and go back to the start"
        disabled={idle || (playState === 'stopped' && playTime === 0)}
        onClick={() => ctl?.stopPlay()}
      />
    </KeyWell>
  );
}

function Deck({ ctl, mode }: { ctl: Controller | null; mode: TapeMode }) {
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const playTime = useTape((s) => s.playTime);
  const clipDur = useTape((s) => s.clipDur);
  const hasAudio = useTape((s) => s.hasAudio);
  const speed = useTape((s) => s.speed);
  const load = useLoadAudio(ctl);
  const idle = !hasAudio || micOn || decoding;

  if (mode === 'recording') {
    return (
      <Plate seam className="tape-deck">
        <KeyWell label="Recorder" className="tape-well-transport">
          <Key
            legend={<RecordLegend live />}
            pressed
            aria-label="Record"
            title="Stop and transcribe"
            onClick={() => ctl?.toggleMic()}
          />
          <Key
            legend="Stop"
            title="Stop and transcribe"
            onClick={() => ctl?.toggleMic()}
          />
        </KeyWell>
        <KeyWell label="Take" className="tape-well-discard">
          <Key
            legend="Discard"
            title="Stop without transcribing"
            onClick={() => ctl?.discard()}
          />
        </KeyWell>
        <Group name="Time" className="tape-grp-time">
          <TimeCounter
            seconds={clipDur}
            label={`${fmtTime(clipDur)} recorded`}
          />
        </Group>
        <LooseStatus />
      </Plate>
    );
  }

  return (
    <Plate seam className="tape-deck">
      <KeyWell label="New take" className="tape-well-session">
        <Key
          legend={<RecordLegend live={false} />}
          aria-label="Record"
          title="Record a new take"
          disabled={decoding}
          onClick={() => ctl?.toggleMic()}
        />
        <Key
          legend="Load"
          title="Open an audio file as a new take"
          disabled={decoding}
          onClick={load.open}
        />
        {mode === 'empty' ? (
          <Key
            legend="Demo"
            title="Load the demo phrase"
            onClick={() => ctl?.demo()}
          />
        ) : null}
      </KeyWell>
      {load.el(decoding)}
      {mode === 'loaded' ? (
        <>
          <Transport ctl={ctl} className="tape-well-transport" />
          <div className="tape-deck-dials">
            <Group name="Time" className="tape-grp-time">
              <TimeCounter
                seconds={playTime}
                label={`${fmtTime(playTime)} of ${fmtTime(clipDur)}`}
              />
            </Group>
            <Group name="Speed">
              <Counter
                label="Speed"
                options={SPEEDS}
                value={String(speed)}
                onChange={(v) => ctl?.setSpeed(parseFloat(v))}
                digits={0}
                nameWidth={58}
                wrap={false}
                disabled={idle}
              />
            </Group>
          </div>
        </>
      ) : (
        <>
          <LooseStatus />
          <div className="tape-deck-dials">
            <Group name="Time" className="tape-grp-time">
              <TimeCounter seconds={0} label="Nothing on tape" />
            </Group>
          </div>
        </>
      )}
    </Plate>
  );
}

// the controller's status line outside the loaded deck (a mic that
// failed to start, a take that failed to load), so no error goes unseen
function LooseStatus() {
  const status = useTape((s) => s.status);
  if (!status) return null;
  return <Note className="tape-status">{status}</Note>;
}

// ---------------------------------------------------------------------
// The editor plate: the selected note and what can be done to it

function Editor({ ctl }: { ctl: Controller | null }) {
  const hasTake = useTape((s) => s.hasTake);
  const selection = useTape((s) => s.selection);
  const editCount = useTape((s) => s.editCount);
  const redoCount = useTape((s) => s.redoCount);
  const playTime = useTape((s) => s.playTime);
  const viewMode = useTape((s) => s.viewMode);
  const cuts = useTape((s) => s.cuts);
  if (!hasTake) return null;
  const note = selection && !selection.mark ? selection : null;
  const canSplit =
    !!note && playTime > note.t0 + 0.02 && playTime < note.t1 - 0.02;
  const isCut = !!note && cuts.includes(note.t0);
  const readout = selection?.mark
    ? `Ornament · ${fmtTime(selection.t0)}`
    : selection
      ? `${selection.label} · ${fmtTime(selection.t0)}–${fmtTime(selection.t1)}`
      : null;

  return (
    <Plate seam className="tape-editor">
      <div className="tape-editor-top">
        <Group name="Note" className="tape-grp-note">
          <Screen kind="editor" className="tape-readout" aria-live="polite">
            {readout ? (
              <span className="tape-readout-text">{readout}</span>
            ) : (
              <span className="tape-readout-hint">
                {viewMode === 'full'
                  ? 'Pick a note on the tape.'
                  : 'Switch to Full notation to edit.'}
              </span>
            )}
          </Screen>
        </Group>
        <KeyWell label="Walk the notes">
          <Key
            legend="Prev"
            aria-label="Previous note"
            title="Previous note (←)"
            onClick={() => ctl?.selectAdjacent(-1)}
          />
          <Key
            legend="Next"
            aria-label="Next note"
            title="Next note (→)"
            onClick={() => ctl?.selectAdjacent(1)}
          />
        </KeyWell>
        <KeyWell label="History" className="tape-well-history">
          <Key
            legend={editCount ? `Undo ${editCount}` : 'Undo'}
            aria-label={editCount ? `Undo, ${editCount} edits` : 'Undo'}
            title="Undo (⌘Z)"
            disabled={!editCount}
            onClick={() => ctl?.undoEdit()}
          />
          <Key
            legend="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!redoCount}
            onClick={() => ctl?.redoEdit()}
          />
        </KeyWell>
      </div>
      <div className="tape-edit-wells">
        <KeyWell label="Shape the note" className="tape-well-edit">
          <Key
            legend="Pitch −"
            aria-label="Pitch down a semitone"
            title="Pitch down a semitone (↓)"
            disabled={!note}
            onClick={() => ctl?.nudgePitch(-1)}
          />
          <Key
            legend="Pitch +"
            aria-label="Pitch up a semitone"
            title="Pitch up a semitone (↑)"
            disabled={!note}
            onClick={() => ctl?.nudgePitch(1)}
          />
          <Key
            legend="Ornament"
            width={104}
            pressed={!!note?.ornament}
            title="Ornament arc (O)"
            disabled={!note}
            onClick={() => ctl?.toggleOrnament()}
          />
          <Key
            legend="Slide"
            pressed={!!note?.slide}
            title="Slide from the previous note"
            disabled={!note}
            onClick={() => ctl?.toggleSlide()}
          />
        </KeyWell>
        <KeyWell label="Cut and join" className="tape-well-edit">
          <Key
            legend="Split"
            title={
              canSplit
                ? 'Split at the playhead (S)'
                : 'Move the playhead into the note first'
            }
            disabled={!canSplit}
            onClick={() => ctl?.splitAtPlayhead()}
          />
          <Key
            legend="Join"
            title="Join with the next note (J)"
            disabled={!note?.canJoin}
            onClick={() => ctl?.joinNext()}
          />
          <Key
            legend="Cut before"
            width={112}
            pressed={isCut}
            title="Start a new phrase at this note (C)"
            disabled={!note}
            onClick={() => ctl?.cutBefore()}
          />
          <Key
            legend="Remove"
            title={selection?.mark ? 'Remove ornament (⌫)' : 'Remove note (⌫)'}
            disabled={!selection}
            onClick={() => ctl?.removeNote()}
          />
        </KeyWell>
      </div>
      <Note className="tape-hint tape-hint-kbd">
        Drag the tape to seek · Space play · ⇧&lt; ⇧&gt; 5 s · ← → note · ↑ ↓
        pitch · 0–9 phrase
      </Note>
      <Note className="tape-hint tape-hint-touch">
        Tap the tape to seek. Tap a note to edit it.
      </Note>
    </Plate>
  );
}

// ---------------------------------------------------------------------
// The front plate: the take name and Save, the print keys (red last),
// and the status line under them

function FrontPlate({ ctl }: { ctl: Controller | null }) {
  const status = useTape((s) => s.status);
  const canPrint = useTape((s) => s.canPrint);
  const printState = useTape((s) => s.printState);
  const phraseCount = useTape((s) => s.phrases.length);
  const focused = useTape(
    (s) => s.phraseView === 'focus' && s.phrases.length > 1,
  );
  const hasTake = useTape((s) => s.hasTake);
  const hasAudio = useTape((s) => s.hasAudio);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const busy = useTape((s) => s.persistBusy);
  const current = useTape((s) => s.currentTake);
  const [name, setName] = useState('');
  const canSave = hasTake && hasAudio && !micOn && !decoding && !busy;
  const off = !canPrint || printState === 'queuing';

  // the name field follows the open take (load, save, untie)
  const currentId = current?.id ?? null;
  const currentName = current?.name ?? '';
  useEffect(() => {
    setName(currentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  return (
    <Plate seam className="tape-front">
      <div className="tape-front-row">
        {hasTake && (
          <div className="tape-save">
            <Field
              label="Take name"
              placeholder="Take"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="tape-save-name"
            />
            <KeyWell label="Save" className="tape-well-save">
              <Key
                legend={current ? 'Save' : 'Save take'}
                width={current ? 88 : 104}
                disabled={!canSave}
                onClick={() => ctl?.saveTake(name.trim() || 'Take')}
              />
              {current && (
                <Key
                  legend="Save as new"
                  width={124}
                  disabled={!canSave}
                  onClick={() => ctl?.saveTakeAsNew(name.trim() || 'Take')}
                />
              )}
              {hasAudio && (
                <Key
                  legend="WAV"
                  aria-label="Download WAV"
                  title="Download the recording as a WAV file"
                  disabled={micOn || decoding}
                  onClick={() => ctl?.downloadTake()}
                />
              )}
            </KeyWell>
          </div>
        )}
        <KeyWell label="Print" className="tape-well-print">
          {phraseCount > 1 && (
            <Key
              legend={`Print ${phraseCount} phrases`}
              width={150}
              title="Print each phrase as its own receipt"
              disabled={off}
              onClick={() => ctl?.printPhrases()}
            />
          )}
          <Key
            legend={
              printState === 'queuing'
                ? 'Queuing…'
                : focused
                  ? 'Print phrase'
                  : 'Print take'
            }
            print
            width={focused ? 124 : 112}
            disabled={off}
            onClick={() => ctl?.print()}
          />
        </KeyWell>
      </div>
      <Note className="tape-status" aria-live="polite">
        {status}
      </Note>
    </Plate>
  );
}

// ---------------------------------------------------------------------
// 01 Takes: every saved take is a project; the open one lists its phrases

function PhraseRows({ ctl }: { ctl: Controller | null }) {
  const phrases = useTape((s) => s.phrases);
  const active = useTape((s) => s.activePhrase);
  const view = useTape((s) => s.phraseView);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const busy = micOn || decoding;
  const many = phrases.length > 1;

  return (
    <ul className="pk-rows tape-phrases" aria-label="Phrases">
      {many && (
        <Row>
          <RowText title="Song" sub="All phrases" />
          <KeyWell compact label="Song">
            <Key
              legend="Open"
              aria-label="Open the song"
              pressed={view === 'song'}
              disabled={busy}
              onClick={() => ctl?.selectTab(-1)}
            />
          </KeyWell>
        </Row>
      )}
      {many &&
        phrases.map((p, k) => (
          <Row key={`${p.t0}-${p.t1}`}>
            <RowText
              title={`Phrase ${k + 1}`}
              sub={`${fmtTime(p.t0)}–${fmtTime(p.t1)}${
                p.editCount || p.frozen ? ' · Edited' : ''
              }`}
            />
            <KeyWell compact label={`Phrase ${k + 1}`}>
              {k > 0 && (
                <Key
                  legend="Merge"
                  aria-label={`Merge phrase ${k + 1} into phrase ${k}`}
                  title={`Merge phrase ${k + 1} into phrase ${k}`}
                  disabled={busy}
                  onClick={() => ctl?.removeCutAt(k - 1)}
                />
              )}
              <Key
                legend="Open"
                aria-label={`Open phrase ${k + 1}`}
                pressed={view === 'focus' && k === active}
                disabled={busy}
                onClick={() => ctl?.selectTab(k)}
              />
            </KeyWell>
          </Row>
        ))}
      <Row className="tape-phrase-cut">
        <Note as="span">
          {many ? 'Cut again at the rests.' : 'Split the take into phrases.'}
        </Note>
        <KeyWell compact label="Phrases">
          <Key
            legend="Cut at breaths"
            width={150}
            title="Start a phrase after each breath"
            disabled={busy}
            onClick={() => ctl?.cutAtBreaths()}
          />
        </KeyWell>
      </Row>
    </ul>
  );
}

function Takes({ ctl }: { ctl: Controller | null }) {
  const takes = useTape((s) => s.takes);
  const busy = useTape((s) => s.persistBusy);
  const hasTake = useTape((s) => s.hasTake);
  const micOn = useTape((s) => s.micOn);
  const decoding = useTape((s) => s.decoding);
  const current = useTape((s) => s.currentTake);
  const clipDur = useTape((s) => s.clipDur);
  const lastDeleted = useTape((s) => s.lastDeleted);
  const [armed, setArmed] = useState<string | null>(null);
  const currentId = current?.id ?? null;

  return (
    <Plate
      seam
      as="section"
      className="tape-takes"
      aria-labelledby="tape-takes"
    >
      <SectionTitle number="01" id="tape-takes">
        Takes
      </SectionTitle>
      <Rows ruled className="tape-take-rows">
        {hasTake && !current && (
          <Row className="tape-take">
            <div className="tape-take-line">
              <TimeCounter
                seconds={clipDur}
                label={`${fmtTime(clipDur)} long`}
                className="tape-take-time"
              />
              <RowText
                className="tape-take-text"
                title="Unsaved take"
                sub="Open"
              />
            </div>
            <PhraseRows ctl={ctl} />
          </Row>
        )}
        {takes?.map((t) => {
          const open = t.id === currentId;
          return (
            <Row key={t.id} className="tape-take">
              <div className="tape-take-line">
                <TimeCounter
                  seconds={t.seconds}
                  label={`${fmtTime(t.seconds)} long`}
                  className="tape-take-time"
                />
                <RowText
                  className="tape-take-text"
                  title={<span title={t.name}>{t.name}</span>}
                  sub={open ? 'Open' : undefined}
                />
                <KeyWell compact label={t.name}>
                  {armed === t.id ? (
                    <>
                      <Key legend="Keep" onClick={() => setArmed(null)} />
                      <Key
                        legend="Delete take"
                        width={124}
                        disabled={busy}
                        onClick={() => {
                          setArmed(null);
                          ctl?.deleteTakeById(t.id);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Key
                        legend="Open"
                        aria-label={`Open ${t.name}`}
                        pressed={open}
                        disabled={busy || micOn || decoding}
                        onClick={() => {
                          if (!open) ctl?.loadTakeById(t.id);
                        }}
                      />
                      <Key
                        legend="Delete"
                        aria-label={`Delete ${t.name}`}
                        disabled={busy}
                        onClick={() => setArmed(t.id)}
                      />
                    </>
                  )}
                </KeyWell>
              </div>
              {open && <PhraseRows ctl={ctl} />}
            </Row>
          );
        })}
        {takes && takes.length === 0 && !hasTake && (
          <Row className="tape-take">
            <Note>No saved takes yet.</Note>
          </Row>
        )}
      </Rows>
      {lastDeleted && (
        <div className="tape-deleted">
          <Note>Deleted “{lastDeleted.name}”.</Note>
          <KeyWell compact label="Deleted take">
            <Key
              legend="Undo"
              aria-label={`Undo, restore ${lastDeleted.name}`}
              disabled={busy}
              onClick={() => ctl?.undeleteTake()}
            />
          </KeyWell>
        </div>
      )}
    </Plate>
  );
}

// ---------------------------------------------------------------------
// 02 Key, 03 Detection, 04 View, 05 Layout

function KeySection({ ctl }: { ctl: Controller | null }) {
  const keySig = useTape((s) => s.settings.keySig);
  const system = useTape((s) => s.settings.scaleSystem);
  const mode = useTape((s) => s.settings.mughamMode);
  const tonic = useTape((s) => s.settings.mughamTonic);
  const sigName =
    KEY_SIGS.find((k: { sharps: number }) => k.sharps === keySig)?.name ?? '';
  const keyId = useId();

  return (
    <section className="tape-section" aria-labelledby="tape-key">
      <SectionTitle number="02" id="tape-key">
        Key
      </SectionTitle>
      <Rows>
        <Row>
          <span className="pk-engr" aria-hidden="true">
            System
          </span>
          <Switch
            variant="mode"
            legends={['Western', 'Mugham']}
            label="Mugham modes"
            checked={system === 'mugham'}
            onChange={(on) =>
              ctl?.setSetting('scaleSystem', on ? 'mugham' : 'western')
            }
          />
        </Row>
        {system === 'western' ? (
          <Row>
            <label htmlFor={keyId} className="pk-engr">
              Key
            </label>
            <span className="pk-field-window tape-key-window">
              <select
                id={keyId}
                className="pk-field-input"
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
            </span>
          </Row>
        ) : (
          <>
            <Row>
              <span className="pk-engr" aria-hidden="true">
                Mode
              </span>
              <Counter
                label="Mode"
                options={MODE_OPTIONS}
                value={mode}
                onChange={(v) => ctl?.setSetting('mughamMode', v)}
                digits={0}
                nameWidth={164}
              />
            </Row>
            <Row>
              <span className="pk-engr" aria-hidden="true">
                Tonic
              </span>
              <Counter
                label="Tonic"
                options={TONIC_OPTIONS}
                value={String(tonic)}
                onChange={(v) =>
                  ctl?.setSetting('mughamTonic', parseInt(v, 10))
                }
                digits={0}
                nameWidth={46}
              />
            </Row>
            <Note className="tape-section-note">
              {mughamKey(mode, tonic).name} prints as {sigName}.
            </Note>
          </>
        )}
      </Rows>
    </section>
  );
}

function DetectionSection({ ctl }: { ctl: Controller | null }) {
  const keySig = useTape((s) => s.settings.keySig);
  const frozen = useTape((s) => s.frozen);
  const activePhrase = useTape((s) => s.activePhrase);
  const phraseCount = useTape((s) => s.phrases.length);
  return (
    <section className="tape-section" aria-labelledby="tape-detection">
      <SectionTitle
        number="03"
        id="tape-detection"
        sub={phraseCount > 1 ? `Phrase ${activePhrase + 1}` : undefined}
      >
        Detection
      </SectionTitle>
      <Rows>
        <Setting
          ctl={ctl}
          k="melodyFloor"
          label="Melody floor"
          min={120}
          max={500}
          fmt={(v) => `${v} Hz / ${noteLabel(floorToMidi(v), keySig)}`}
          disabled={frozen}
        />
        {frozen && (
          <Row className="tape-start-over">
            <Note as="span">
              {phraseCount > 1
                ? `Editing pauses detection. Start over detects phrase ${activePhrase + 1} again.`
                : 'Editing pauses detection. Start over detects the recording again.'}
            </Note>
            <KeyWell compact label="Detection">
              <Key
                legend="Start over"
                width={124}
                onClick={() => ctl?.reread()}
              />
            </KeyWell>
          </Row>
        )}
      </Rows>
    </section>
  );
}

function ViewSection({ ctl }: { ctl: Controller | null }) {
  const viewMode = useTape((s) => s.viewMode);
  const traceMode = useTape((s) => s.traceMode);
  return (
    <section className="tape-section" aria-labelledby="tape-view">
      <SectionTitle number="04" id="tape-view">
        View
      </SectionTitle>
      <Rows>
        <Row>
          <span className="pk-engr" aria-hidden="true">
            Notation
          </span>
          <Switch
            variant="mode"
            legends={['Full', 'Main notes']}
            label="Main notes only"
            checked={viewMode === 'skeleton'}
            onChange={(on) => ctl?.setViewMode(on ? 'skeleton' : 'full')}
          />
        </Row>
        <Row>
          <span className="pk-engr" aria-hidden="true">
            Pitch trace
          </span>
          <Counter
            label="Pitch trace"
            options={TRACE_MODES}
            value={traceMode}
            onChange={(v) => ctl?.setTraceMode(v)}
            digits={0}
            nameWidth={96}
            wrap={false}
          />
        </Row>
        {traceMode === 'linear' && (
          <Setting
            ctl={ctl}
            k="traceZoom"
            label="Trace stretch"
            min={20}
            max={400}
            fmt={(v) => `${v} px/s`}
          />
        )}
      </Rows>
    </section>
  );
}

function LayoutSection({ ctl }: { ctl: Controller | null }) {
  return (
    <section className="tape-section" aria-labelledby="tape-layout">
      <SectionTitle number="05" id="tape-layout">
        Layout
      </SectionTitle>
      <Rows>
        <Setting
          ctl={ctl}
          k="msPerRow"
          label="Time per row"
          min={5}
          max={60}
          fmt={(v) => `${v} ms`}
        />
        <Setting
          ctl={ctl}
          k="staffGap"
          label="Staff gap"
          min={12}
          max={48}
          fmt={(v) => `${v} dots`}
        />
        <Setting
          ctl={ctl}
          k="noteDots"
          label="Note width"
          min={4}
          max={32}
          fmt={(v) => `${v} dots`}
        />
        <Setting
          ctl={ctl}
          k="glyphScale"
          label="Glyph size"
          min={1}
          max={4}
          fmt={(v) => `${v}×`}
        />
        <Setting
          ctl={ctl}
          k="breathGapMs"
          label="Breath gap"
          min={150}
          max={1000}
          fmt={(v) => `${v} ms`}
        />
      </Rows>
    </section>
  );
}

function SettingsPlate({ ctl }: { ctl: Controller | null }) {
  return (
    <Plate seam className="tape-settings">
      <KeySection ctl={ctl} />
      <DetectionSection ctl={ctl} />
      <ViewSection ctl={ctl} />
      <LayoutSection ctl={ctl} />
    </Plate>
  );
}

function TruncatedNote() {
  const truncated = useTape((s) => s.truncated);
  if (!truncated) return null;
  return (
    <Note className="tape-truncated">
      The preview stops here. The print includes the whole take.
    </Note>
  );
}

// ---------------------------------------------------------------------

export function TapeTool({ lamp }: { lamp?: ReactNode }) {
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
      // a control already took the key (the counters step on ↑ ↓)
      if (e.defaultPrevented) return;
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
    <div className="tape-tool" data-mode={mode} data-trace={traceMode}>
      <Body as="section" className="tape-unit" aria-labelledby="tape-name">
        <Plate head className="tape-head">
          <PageName id="tape-name">Tape</PageName>
          {lamp}
        </Plate>
        <div className="tape-window-plate">
          {/* the window: the paper strip runs through it, the trace sits
              on the screen under the paper. The sheet behind the roll
              gives the paper its margins; the canvases stay exact. */}
          <Screen
            kind="editor"
            className="tape-window"
            screenClassName="tape-screen"
          >
            <div className="tape-sheet" aria-hidden="true" />
            <div className="tape-roll" ref={wrapRef}>
              <canvas ref={canvasRef} className="tape-paper" />
              <TraceCanvas elRef={traceRef} />
              <Playhead elRef={playheadRef} />
            </div>
            {mode === 'empty' && <EmptyNote />}
            {mode !== 'empty' && <Osd />}
          </Screen>
          <TruncatedNote />
        </div>
        <Deck ctl={ctl} mode={mode} />
        {mode === 'loaded' && (
          <>
            <Editor ctl={ctl} />
            <FrontPlate ctl={ctl} />
          </>
        )}
        {mode !== 'recording' && <Takes ctl={ctl} />}
        {mode === 'loaded' && <SettingsPlate ctl={ctl} />}
      </Body>
      {/* phones: the transport docks at the foot of the screen, so Play
          and Stop stay in reach while the tape is in view */}
      {mode === 'loaded' && (
        <div className="tape-dock">
          <Transport ctl={ctl} className="tape-well-dock" />
        </div>
      )}
    </div>
  );
}
