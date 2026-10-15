'use client';

// The Photo tool's markup. This component renders once and never
// re-renders: all interaction is owned by the imperative engine
// (components/photo-engine.js), which is live-tested against the printer
// and mounted via the effect below. Element ids, data-* attributes and the
// classes the engine toggles (.has-photo, .crop-mode, .camera, .pnl,
// .pnl-on, .on, [hidden]) are the contract with the engine and with
// app/(dashboard)/photo/photo-tool.css; keep them. The engine rewrites the
// text of #printBtn and #toneChev, so neither holds child elements.
//
// The effect adds four things around the engine without changing it:
// aria-pressed and aria-expanded follow the classes the engine sets, a
// status line that is not a progress word prints in red (the engine
// writes failures as plain text), the drop tray marks a file held over
// it, and on a phone the adjustments open at once (the phone shows one
// tool at a time through the dock, and Tailwind keeps a [hidden] element
// hidden whatever the CSS says).

import { useEffect } from 'react';
import { Fader } from '@/components/hardware/fader';
import { Field } from '@/components/hardware/field';
import { Module } from '@/components/hardware/module';
import { PaperRoll, PaperSlip, PrinterEdge } from '@/components/hardware/paper';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { initPhotoTool } from '@/components/photo-engine.js';

const CROPS = [
  { a: '', label: 'Full' },
  { a: '1', label: '1:1' },
  { a: '1.3333', label: '4:3' },
  { a: '1.5', label: '3:2' },
];

const TONES = [
  { name: 'mid', label: 'Midtone', min: -100, max: 100 },
  { name: 'shadow', label: 'Shadows', min: -100, max: 100 },
  { name: 'bright', label: 'Brightness', min: -100, max: 100 },
  { name: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { name: 'sharp', label: 'Sharpen', min: 0, max: 200 },
];

const DOCK = [
  { panel: 'source', label: 'Photo' },
  { panel: 'crop', label: 'Crop' },
  { panel: 'levels', label: 'Levels' },
  { panel: 'mid', label: 'Midtone' },
  { panel: 'shadow', label: 'Shadows' },
  { panel: 'bright', label: 'Brightness' },
  { panel: 'contrast', label: 'Contrast' },
  { panel: 'sharp', label: 'Sharpen' },
];

/** Status words the engine writes that are not failures. */
const STATUS_OK = new Set(['', 'rendering…', 'queued']);

/** Keeps the ARIA state of the engine's toggles in step with its classes. */
function syncAria(root: HTMLElement) {
  for (const key of root.querySelectorAll<HTMLButtonElement>(
    '#cropPresets button, #capSize button, #capWeight button, #autoBtn, #toolDock button',
  )) {
    const pressed = String(key.classList.contains('on'));
    if (key.getAttribute('aria-pressed') !== pressed) {
      key.setAttribute('aria-pressed', pressed);
    }
  }
  const body = root.querySelector<HTMLElement>('#toneBody');
  const toggle = root.querySelector<HTMLElement>('#toneToggle');
  if (body && toggle) {
    const open = String(!body.hidden);
    if (toggle.getAttribute('aria-expanded') !== open) {
      toggle.setAttribute('aria-expanded', open);
    }
  }
}

// The engine's dispose stops the camera and timers but leaves its element
// listeners, so a second init on the same markup binds every control twice
// (a toggle then flips twice and Print posts two jobs). React's dev Strict
// Mode runs an effect, its cleanup and the effect again on the same DOM,
// so the engine is disposed one task later and kept when the same root
// mounts again in between.
let engine: {
  root: HTMLElement;
  dispose: () => void;
  timer?: number;
} | null = null;

function mountEngine(root: HTMLElement) {
  if (engine?.root === root) {
    window.clearTimeout(engine.timer);
    return;
  }
  engine?.dispose();
  engine = { root, dispose: initPhotoTool() };
}

function releaseEngine() {
  const held = engine;
  if (!held) return;
  held.timer = window.setTimeout(() => {
    if (engine === held) {
      held.dispose();
      engine = null;
    }
  }, 0);
}

export function PhotoTool() {
  useEffect(() => {
    const root = document.getElementById('photoTool');
    const drop = document.getElementById('dropzone');
    if (!root || !drop) return;
    mountEngine(root);

    const observer = new MutationObserver(() => syncAria(root));
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
    syncAria(root);

    const status = document.getElementById('photoStatus');
    const markStatus = () => {
      status?.classList.toggle(
        'is-error',
        !STATUS_OK.has(status.textContent ?? ''),
      );
    };
    const statusWatch = new MutationObserver(markStatus);
    if (status) {
      statusWatch.observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    const over = () => drop.classList.add('is-over');
    const leave = (e: DragEvent) => {
      if (!drop.contains(e.relatedTarget as Node | null)) {
        drop.classList.remove('is-over');
      }
    };
    const dropped = () => drop.classList.remove('is-over');
    drop.addEventListener('dragover', over);
    drop.addEventListener('dragleave', leave);
    drop.addEventListener('drop', dropped);

    const phone = window.matchMedia('(max-width: 720px)');
    const openOnPhone = () => {
      if (phone.matches && document.getElementById('toneBody')?.hidden) {
        document.getElementById('toneToggle')?.click();
      }
    };
    openOnPhone();
    phone.addEventListener('change', openOnPhone);

    return () => {
      phone.removeEventListener('change', openOnPhone);
      drop.removeEventListener('dragover', over);
      drop.removeEventListener('dragleave', leave);
      drop.removeEventListener('drop', dropped);
      statusWatch.disconnect();
      observer.disconnect();
      releaseEngine();
    };
  }, []);

  return (
    <div className="photo-tool" id="photoTool">
      <div className="photo-controls">
        <Module
          number="01"
          title="Photo"
          className="photo-mod photo-mod--source"
        >
          <label className="photo-drop pnl" id="dropzone" data-panel="source">
            <input
              type="file"
              id="photoInput"
              accept="image/*"
              className="sr-only"
            />
            <span className="photo-drop-hint" id="dropHint">
              Choose a photo
              <br />
              <span className="sub">or drop one here</span>
            </span>
          </label>
          <div className="photo-source-keys">
            <KeyGroup>
              <label
                className="hw-push photo-take pnl"
                id="takeBtn"
                data-panel="source"
              >
                <input
                  type="file"
                  id="cameraInput"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                />
                <span className="hw-legend">Take a photo</span>
              </label>
            </KeyGroup>
          </div>
        </Module>

        <Module number="02" title="Edit" className="photo-mod photo-mod--edit">
          <div className="photo-editor" id="photoEditor" hidden>
            <canvas
              className="photo-crop pnl"
              id="editCanvas"
              data-panel="crop"
              aria-label="Crop area"
            />
            <div className="edit-tools pnl" data-panel="crop">
              <KeyGroup id="cropPresets" legend="Crop shape" legendHidden>
                {CROPS.map((c) => (
                  <PushKey
                    key={c.label}
                    data-a={c.a}
                    className={c.a === '' ? 'on' : undefined}
                    aria-pressed={c.a === ''}
                  >
                    {c.label}
                  </PushKey>
                ))}
              </KeyGroup>
              <KeyGroup>
                <PushKey id="rotateBtn">Rotate</PushKey>
              </KeyGroup>
            </div>
            <div className="tone-group">
              <button
                type="button"
                className="tone-toggle"
                id="toneToggle"
                aria-controls="toneBody"
                aria-expanded="false"
              >
                <span className="tone-title">Adjustments</span>
                <span className="tone-summary" id="toneSummary" />
                <span className="tone-chev" id="toneChev" aria-hidden="true">
                  &#9656;
                </span>
              </button>
              <div className="tone-body" id="toneBody" hidden>
                <div className="tone-head pnl" data-panel="levels">
                  <span
                    className="photo-legend"
                    id="levelsLabel"
                    title="Double-click to reset"
                  >
                    Levels
                  </span>
                  <KeyGroup>
                    <PushKey
                      size="compact"
                      id="autoBtn"
                      className="on"
                      aria-pressed
                    >
                      Auto
                    </PushKey>
                  </KeyGroup>
                  <span className="tone-val" id="levelsVal">
                    0 · 255
                  </span>
                </div>
                <canvas
                  className="hist-canvas pnl"
                  id="histCanvas"
                  data-panel="levels"
                />
                <div
                  className="level-track pnl"
                  id="levelTrack"
                  data-panel="levels"
                  aria-hidden="true"
                >
                  <div className="level-handle black" id="handleBlack" />
                  <div className="level-handle white" id="handleWhite" />
                </div>
                {TONES.map((t) => (
                  <div
                    className="tone-row pnl"
                    data-panel={t.name}
                    key={t.name}
                  >
                    <label
                      className="photo-legend"
                      id={`${t.name}Label`}
                      htmlFor={`${t.name}Slider`}
                      title="Double-click to reset"
                    >
                      {t.label}
                    </label>
                    <Fader
                      id={`${t.name}Slider`}
                      min={t.min}
                      max={t.max}
                      centered={t.min < 0}
                      defaultValue="0"
                    />
                    <span className="tone-val" id={`${t.name}Val`}>
                      0
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Module>

        <KeyGroup
          id="toolDock"
          className="tool-dock"
          legend="Tool"
          legendHidden
        >
          {DOCK.map((d) => (
            <PushKey
              key={d.panel}
              data-panel={d.panel}
              className={d.panel === 'crop' ? 'on' : undefined}
              aria-pressed={d.panel === 'crop'}
            >
              {d.label}
            </PushKey>
          ))}
        </KeyGroup>

        <Module
          number="03"
          title="Caption"
          className="photo-mod photo-mod--caption"
        >
          <Field
            label="Text"
            id="captionInput"
            placeholder="Optional"
            spellCheck={false}
            autoComplete="off"
            maxLength={120}
          />
          <div className="caption-tools">
            <KeyGroup id="capSize" legend="Size">
              <PushKey data-v="28" aria-label="Small" aria-pressed={false}>
                S
              </PushKey>
              <PushKey
                data-v="36"
                className="on"
                aria-label="Medium"
                aria-pressed
              >
                M
              </PushKey>
              <PushKey data-v="48" aria-label="Large" aria-pressed={false}>
                L
              </PushKey>
            </KeyGroup>
            <KeyGroup id="capWeight" legend="Weight">
              <PushKey data-v="400" className="on" aria-pressed>
                Regular
              </PushKey>
              <PushKey data-v="700" aria-pressed={false}>
                Bold
              </PushKey>
            </KeyGroup>
          </div>
        </Module>
      </div>

      <section className="photo-stage" aria-label="Print preview">
        <div className="photo-actions">
          <span
            className="photo-status hw-ink"
            id="photoStatus"
            role="status"
          />
          <span className="photo-camera-keys">
            <KeyGroup>
              <PushKey id="captureBtn">Capture</PushKey>
              <PushKey id="cameraCancelBtn">Cancel</PushKey>
            </KeyGroup>
          </span>
          <KeyGroup className="photo-print-keys">
            <button
              type="button"
              className="hw-push hw-push--print photo-print"
              id="printBtn"
              disabled
            >
              Print
            </button>
          </KeyGroup>
        </div>
        <div className="photo-feed">
          <PrinterEdge className="photo-edge" />
          <PaperRoll>
            <PaperSlip exact fed tear="new">
              <div className="photo-roll" id="photoRoll">
                <p className="photo-empty" id="photoEmpty">
                  Choose a photo to see the print preview.
                </p>
              </div>
              <video
                className="photo-cam-feed"
                id="cameraFeed"
                autoPlay
                playsInline
                muted
              />
              <canvas className="photo-cam" id="camDither" />
            </PaperSlip>
          </PaperRoll>
        </div>
      </section>
    </div>
  );
}
