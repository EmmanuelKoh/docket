'use client';

// The Tape tool's markup, following the Photo tool's contract: this
// component renders once and never re-renders; all interaction is owned
// by the imperative engine (components/tape-engine.js). Element ids and
// class names are the contract between the two and with tape-tool.css —
// change them together or not at all. Slider defaults mirror
// TAPE_DEFAULTS / TRACKER_DEFAULTS in the renderer and tracker modules.

import { useEffect, useRef } from 'react';
import { initTapeTool } from '@/components/tape-engine.js';
import { useSidebar } from '@/components/ui/sidebar';

function Slider(props: {
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
}) {
  return (
    <div className="tape-row">
      <span className="label">{props.label}</span>
      <input
        type="range"
        id={props.id}
        min={props.min}
        max={props.max}
        defaultValue={props.def}
      />
      <span className="tape-val" id={`${props.id}Val`} />
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

  useEffect(() => initTapeTool(), []);

  return (
    <div className="tape-tool" id="tapeTool">
      <div className="tape-controls">
        <div className="tape-btnrow">
          <button type="button" className="btn" id="tapeMicBtn">
            Start mic
          </button>
          <button type="button" className="btn" id="tapeDemoBtn">
            Demo phrase
          </button>
          <button type="button" className="btn" id="tapeNewBtn">
            New take
          </button>
        </div>

        <div className="tape-field">
          <span className="label">Key signature</span>
          <select id="tapeKeySig" className="tape-select" />
        </div>

        <div className="tape-group">
          <span className="label">Detection</span>
          <Slider
            id="tapeClarity"
            label="Clarity gate"
            min={50}
            max={99}
            def={88}
          />
          <Slider
            id="tapeOnsetHold"
            label="Onset hold"
            min={10}
            max={200}
            def={50}
          />
          <Slider
            id="tapeRetrig"
            label="Retrigger"
            min={20}
            max={120}
            def={60}
          />
          <Slider
            id="tapeChangeHold"
            label="Change hold"
            min={20}
            max={300}
            def={80}
          />
          <Slider id="tapeOffMs" label="Release" min={30} max={400} def={110} />
        </div>

        <div className="tape-group">
          <span className="label">Layout</span>
          <Slider
            id="tapeMsPerRow"
            label="Ms per row"
            min={5}
            max={60}
            def={20}
          />
          <Slider
            id="tapeStaffGap"
            label="Staff gap"
            min={12}
            max={48}
            def={28}
          />
          <Slider
            id="tapeNoteDots"
            label="Note width"
            min={4}
            max={24}
            def={10}
          />
          <Slider
            id="tapeGlyphScale"
            label="Glyph size"
            min={1}
            max={4}
            def={2}
          />
          <Slider
            id="tapeBreathGap"
            label="Breath gap"
            min={150}
            max={1000}
            def={350}
          />
          <p className="tape-hint">
            Layout applies to new tape as it prints — Replay re-renders the
            whole take with the current values.
          </p>
        </div>

        <div className="tape-group">
          <span className="label">Clip</span>
          <div className="tape-btnrow">
            <button type="button" className="btn small" id="tapeReplayBtn">
              Replay
            </button>
            <button type="button" className="btn small" id="tapeSaveClipBtn">
              Save clip
            </button>
            <label className="btn small" htmlFor="tapeLoadClip">
              Load clip
              <input type="file" id="tapeLoadClip" accept="audio/*" hidden />
            </label>
          </div>
        </div>
      </div>

      <div className="tape-stage">
        <div className="tape-stagehead">
          <span className="label">
            Tape — reading orientation, exact print bytes
          </span>
          <span className="tape-now">
            <span className="label">Sounding</span>
            <span className="tape-val" id="tapeNoteNow">
              —
            </span>
          </span>
        </div>
        <div className="tape-roll" id="tapeCanvasWrap">
          <canvas id="tapeCanvas" />
        </div>
        <span className="label">Pitch trace</span>
        <canvas id="tapeTraceCanvas" className="tape-trace" />
        <div className="tape-bottom">
          <div className="tape-log-wrap">
            <span className="label">Notes</span>
            <div className="tape-log" id="tapeEventLog" />
          </div>
          <div className="tape-actions">
            <span className="status" id="tapeStatus" />
            <button type="button" className="btn" id="tapePrintBtn" disabled>
              Print take
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
