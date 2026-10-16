'use client';

// The Photo tool: one camera body. The upper plate holds the screen (a
// black-paint bezel set into the body, the display at print size, the
// Edit / Preview switch on its chin) beside Levels, the tone sliders, Crop
// and Rotate; past the seam, the lower plate holds Caption, Size, Bold,
// the Capture release and one key well: Load, Camera and the red Print key
// last. On a phone the release and the key well dock at the foot of the
// screen. Styles: app/(dashboard)/photo/photo-tool.css.
//
// All the work is done by the imperative engine (components/photo-engine.js,
// live-tested against the printer; do not edit it), mounted by the effect
// below. Its contract is the element ids, the data-* attributes and the
// classes it toggles. The engine draws and binds these elements in place:
// #editCanvas, #histCanvas, #levelTrack and its handles, the five sliders
// and their labels, #photoRoll (it appends the rendered preview there),
// #camDither and #cameraFeed, #photoStatus, #captionInput, #rotateBtn,
// #captureBtn, #takeBtn (the Camera key) and #dropzone (the whole body).
//
// The engine's other controls are kept in a hidden block and driven from
// the kit controls: the crop presets, caption size and weight, Auto, the
// two file inputs and Print (the engine rewrites the Print button's text,
// which would wipe a key cap). The kit controls read their state back from
// the engine's classes (a MutationObserver), so a crop drag, a level drag
// or a finished print shows on them as it happens.

import {
  type CSSProperties,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { Body } from '@/components/hardware/kit/body';
import { Fader, Shutter } from '@/components/hardware/kit/controls';
import { Counter } from '@/components/hardware/kit/counter';
import { Engraved, PageName } from '@/components/hardware/kit/engraved';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Screen } from '@/components/hardware/kit/screen';
import { Switch } from '@/components/hardware/kit/switch';
import { initPhotoTool } from '@/components/photo-engine.js';
import { cn } from '@/components/utils';

// The engine's crop presets (data-a) and their names on the counter
const CROPS = [
  { a: '', value: 'full', label: 'Full' },
  { a: '1', value: '1', label: '1:1' },
  { a: '1.3333', value: '1.3333', label: '4:3' },
  { a: '1.5', value: '1.5', label: '3:2' },
];
const FREE = { value: 'free', label: 'Free' };

// Caption size: the engine's font sizes (data-v)
const SIZES = [
  { value: '28', label: 'S' },
  { value: '36', label: 'M' },
  { value: '48', label: 'L' },
];

const TONES = [
  { name: 'mid', label: 'Midtone', min: -100, max: 100 },
  { name: 'shadow', label: 'Shadows', min: -100, max: 100 },
  { name: 'bright', label: 'Brightness', min: -100, max: 100 },
  { name: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { name: 'sharp', label: 'Sharpen', min: 0, max: 200 },
];

/** Status words the engine writes that are not failures. */
const STATUS_OK = new Set(['', 'rendering…', 'queued']);

// 203 dpi: 8 dots to the millimetre
const DOTS_PER_MM = 8;

type EngineState = {
  hasPhoto: boolean;
  camera: boolean;
  auto: boolean;
  /** The crop preset held by the engine, or "free" after a drag or a turn. */
  crop: string;
  size: string;
  bold: boolean;
  printDisabled: boolean;
  printLegend: string;
  statusError: boolean;
  /** The print's size in dots, for the display's status line. */
  dots: string;
  /** The preview's height on the display (CSS px), 0 before one. */
  printH: number;
};

const INITIAL: EngineState = {
  hasPhoto: false,
  camera: false,
  auto: true,
  crop: 'full',
  size: '36',
  bold: false,
  printDisabled: true,
  printLegend: 'Print',
  statusError: false,
  dots: '576 dots wide',
  printH: 0,
};

const byId = (id: string) => document.getElementById(id);

/** Clicks one of the engine's controls (the hidden ones included). */
const press = (selector: string) =>
  document.querySelector<HTMLElement>(selector)?.click();

/** Reads the engine's state from the classes and text it writes. */
function readEngine(root: HTMLElement): EngineState {
  const camera = byId('photoEditor')?.classList.contains('camera') ?? false;
  const on = (sel: string) =>
    root.querySelector<HTMLElement>(`${sel} button.on`)?.dataset;
  const preset = on('#cropPresets');
  const print = byId('printBtn') as HTMLButtonElement | null;
  const status = byId('photoStatus')?.textContent ?? '';

  let dots = '576 dots wide';
  const img = root.querySelector<HTMLImageElement>('#photoRoll img');
  const printH = img?.naturalWidth
    ? (288 * img.naturalHeight) / img.naturalWidth
    : 0;
  if (camera) {
    const cam = byId('camDither') as HTMLCanvasElement | null;
    if (cam?.width) {
      dots = `576 × ${Math.round((576 * cam.height) / cam.width)} dots`;
    }
  } else if (img?.naturalWidth) {
    const h = img.naturalHeight;
    dots = `${img.naturalWidth} × ${h} dots · ${Math.round(h / DOTS_PER_MM)} mm`;
  }

  return {
    hasPhoto: root.classList.contains('has-photo'),
    camera,
    auto: byId('autoBtn')?.classList.contains('on') ?? true,
    crop: preset
      ? (CROPS.find((c) => c.a === preset.a)?.value ?? 'full')
      : 'free',
    size: on('#capSize')?.v ?? '36',
    bold: on('#capWeight')?.v === '700',
    printDisabled: print?.disabled ?? true,
    printLegend: print?.textContent?.trim() || 'Print',
    statusError: !STATUS_OK.has(status),
    dots,
    printH,
  };
}

const same = (a: EngineState, b: EngineState) =>
  (Object.keys(a) as (keyof EngineState)[]).every((k) => a[k] === b[k]);

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

// The parts below render once and never again: the engine writes into
// them (canvases, the preview image, inline sizes and positions, text).

/** What the display shows: the print preview, the crop editor or the
 *  live camera, one at a time (data-screen on the root). */
const ScreenPanes = memo(function ScreenPanes() {
  return (
    <>
      <div className="ph-pane ph-pane--preview">
        <div className="ph-paper">
          <div id="photoRoll">
            <p className="ph-empty" id="photoEmpty">
              Press Load or Camera
              <span className="ph-empty-drop">
                ,<br />
                or drop a photo here
              </span>
              .
            </p>
          </div>
        </div>
      </div>
      <div className="ph-pane ph-pane--edit">
        <div className="ph-editor" id="photoEditor" hidden>
          <canvas
            id="editCanvas"
            aria-label="Crop: drag the frame or its corners"
          />
        </div>
      </div>
      <div className="ph-pane ph-pane--camera">
        <canvas id="camDither" aria-label="Camera view" />
      </div>
      {/* The worker's frame source. It stays rendered, out of sight: a
          video with display: none hands drawImage black frames. */}
      <div className="ph-feed" aria-hidden="true">
        <video id="cameraFeed" autoPlay playsInline muted />
      </div>
    </>
  );
});

/** The histogram and the black and white points under it. Drag on the
 *  points (pointer only; Auto and the sliders cover the keyboard). */
const LevelsPlot = memo(function LevelsPlot() {
  return (
    <div className="ph-plot" aria-hidden="true">
      {/* The engine shades the tones the points clip with a quarter-alpha
          grey. The display drops that shade where there are no bars and
          keeps it over the clipped bars (they read lighter). Set inline: a
          fragment url() in a stylesheet stalls the dev server's CSS. */}
      <svg className="ph-defs" width="0" height="0" aria-hidden="true">
        <filter id="ph-hist-dim" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0 1" />
          </feComponentTransfer>
        </filter>
      </svg>
      <canvas
        id="histCanvas"
        style={{
          filter: 'url(#ph-hist-dim) var(--ph-hist-tone) var(--ph-hist-shadow)',
        }}
      />
      <span className="ph-plot-base" />
      <div className="ph-track" id="levelTrack">
        <div className="ph-point ph-point--black" id="handleBlack" />
        <div className="ph-point ph-point--white" id="handleWhite" />
      </div>
    </div>
  );
});

/** The engine's own controls that the kit controls drive. */
const EngineControls = memo(function EngineControls() {
  return (
    <>
      <input
        type="file"
        id="photoInput"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        type="file"
        id="cameraInput"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div hidden>
        <span id="dropHint" />
        <div id="cropPresets">
          {CROPS.map((c) => (
            <button
              type="button"
              key={c.value}
              data-a={c.a}
              className={c.a === '' ? 'on' : undefined}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div id="capSize">
          {SIZES.map((s) => (
            <button
              type="button"
              key={s.value}
              data-v={s.value}
              className={s.value === '36' ? 'on' : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div id="capWeight">
          <button type="button" data-v="400" className="on">
            Regular
          </button>
          <button type="button" data-v="700">
            Bold
          </button>
        </div>
        <button type="button" id="autoBtn" className="on">
          Auto
        </button>
        <button type="button" id="toneToggle">
          <span id="toneSummary" />
          <span id="toneChev" />
        </button>
        <div id="toneBody" />
        <span id="levelsVal" />
        {TONES.map((t) => (
          <span key={t.name} id={`${t.name}Val`} />
        ))}
        <div id="toolDock" />
        <button type="button" id="cameraCancelBtn">
          Cancel
        </button>
        <button type="button" id="printBtn" disabled>
          Print
        </button>
      </div>
    </>
  );
});

/** The engine's status line, on the display. */
const StatusLine = memo(function StatusLine() {
  return <span className="ph-status" id="photoStatus" role="status" />;
});

export function PhotoTool({ lamp }: { lamp?: ReactNode }) {
  const [eng, setEng] = useState(INITIAL);
  const [view, setView] = useState<'preview' | 'edit'>('preview');
  const [over, setOver] = useState(false);

  useEffect(() => {
    const root = byId('photoTool');
    const drop = byId('dropzone');
    if (!root || !drop) return;
    mountEngine(root);

    const sync = () =>
      setEng((prev) => {
        const next = readEngine(root);
        return same(prev, next) ? prev : next;
      });
    const watch = new MutationObserver(sync);
    watch.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'disabled', 'width', 'height'],
    });
    sync();

    // The Camera key latches: pressed again while the camera runs, it
    // turns the camera off (the engine's key only turns it on). Caught on
    // the way down, before the engine's own listener sees the click.
    const cameraOff = (e: MouseEvent) => {
      const key = (e.target as Element | null)?.closest('#takeBtn');
      if (key && byId('photoEditor')?.classList.contains('camera')) {
        e.stopPropagation();
        e.preventDefault();
        press('#cameraCancelBtn');
      }
    };
    root.addEventListener('click', cameraOff, true);

    // A file held over the camera
    const enter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!drop.contains(e.relatedTarget as Node | null)) setOver(false);
    };
    const dropped = () => setOver(false);
    drop.addEventListener('dragover', enter);
    drop.addEventListener('dragleave', leave);
    drop.addEventListener('drop', dropped);

    // The engine reads the histogram's colour when it draws: draw it
    // again in the new theme (its resize listener redraws).
    const theme = new MutationObserver(() =>
      window.dispatchEvent(new Event('resize')),
    );
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      theme.disconnect();
      drop.removeEventListener('dragover', enter);
      drop.removeEventListener('dragleave', leave);
      drop.removeEventListener('drop', dropped);
      root.removeEventListener('click', cameraOff, true);
      watch.disconnect();
      releaseEngine();
    };
  }, []);

  const screen = eng.camera ? 'camera' : eng.hasPhoto ? view : 'empty';
  // the crop editor measures its column when it draws: draw it again when
  // it comes on the display (before paint, so it never shows stale)
  useLayoutEffect(() => {
    if (screen === 'edit') window.dispatchEvent(new Event('resize'));
  }, [screen]);

  const live = eng.hasPhoto && !eng.camera;
  const crops = eng.crop === 'free' ? [FREE, ...CROPS] : CROPS;
  const cropName = crops.find((c) => c.value === eng.crop)?.label ?? 'Full';
  const mode =
    screen === 'camera'
      ? 'Live'
      : screen === 'edit'
        ? `Crop ${cropName.toLowerCase()}`
        : '1-bit';

  return (
    <div className="ph" id="photoTool" data-screen={screen}>
      <Body
        as="section"
        id="dropzone"
        className="ph-body"
        aria-labelledby="ph-title"
        data-over={over || undefined}
      >
        <div className="ph-upper">
          <div className="ph-top">
            <PageName id="ph-title" className="ph-name">
              Photo
            </PageName>
            {lamp}
          </div>

          <div className="ph-grid">
            <div className="pk-window ph-screen">
              <div className="ph-bezel">
                <Screen
                  kind="lcd"
                  className="ph-glass"
                  screenClassName="ph-lcd"
                >
                  <div
                    className="ph-view"
                    style={
                      {
                        '--ph-print-h': `${eng.printH}px`,
                      } as CSSProperties
                    }
                  >
                    <ScreenPanes />
                    <span className="ph-drop" aria-hidden="true">
                      Drop to load
                    </span>
                  </div>
                  <div className={cn('ph-osd', eng.statusError && 'is-error')}>
                    <span className="ph-osd-left">
                      <StatusLine />
                      <span className="ph-osd-mode">{mode}</span>
                    </span>
                    <span className="ph-osd-dots">{eng.dots}</span>
                  </div>
                </Screen>
                <div className="ph-chin">
                  <Switch
                    variant="mode"
                    legends={['Edit', 'Preview']}
                    label="Preview"
                    checked={view === 'preview'}
                    disabled={!live}
                    onChange={(next) => setView(next ? 'preview' : 'edit')}
                    className="ph-mode"
                  />
                </div>
              </div>
            </div>

            <div className="ph-lvhead">
              <Engraved
                as="h2"
                id="levelsLabel"
                className="ph-h2"
                title="Double-click to reset"
              >
                Levels
              </Engraved>
              <span className="pk-switch-row">
                <Engraved aria-hidden="true">Auto</Engraved>
                <Switch
                  legends={false}
                  label="Auto levels"
                  checked={eng.auto}
                  onChange={() => press('#autoBtn')}
                />
              </span>
            </div>
            <Screen
              kind="editor"
              className="ph-hist"
              screenClassName="ph-hist-scr"
            >
              <LevelsPlot />
            </Screen>

            {/* biome-ignore lint/a11y/useSemanticElements: the group is display: contents in the grid, which a fieldset does not take everywhere */}
            <div className="ph-tone" role="group" aria-label="Tone">
              {TONES.map((t, i) => (
                <div className={`ph-frow ph-f${i}`} key={t.name}>
                  <label
                    className="pk-engr"
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
                    disabled={!live}
                  />
                </div>
              ))}
            </div>

            <div className="ph-crop">
              <div className="ph-crop-ctl">
                <Engraved aria-hidden="true">Crop</Engraved>
                <Counter
                  label="Crop"
                  options={crops}
                  value={eng.crop}
                  onChange={(v) => {
                    const c = CROPS.find((x) => x.value === v);
                    if (c) press(`#cropPresets button[data-a="${c.a}"]`);
                  }}
                  digits={0}
                  nameWidth={40}
                  wrap={false}
                  disabled={!live}
                  className="ph-counter"
                />
              </div>
              <KeyWell className="ph-rot">
                <Key
                  id="rotateBtn"
                  legend="Rotate"
                  width={64}
                  disabled={!live}
                />
              </KeyWell>
            </div>
          </div>
        </div>

        <div className="pk-seam ph-lower">
          <div className="ph-settings">
            <div className="ph-grp ph-grp--caption">
              <label className="pk-engr ph-lab" htmlFor="captionInput">
                Caption
              </label>
              <Screen
                kind="editor"
                className="ph-capwin"
                screenClassName="ph-cap-scr"
              >
                <input
                  id="captionInput"
                  placeholder="Optional"
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Screen>
            </div>
            <div className="ph-grp ph-grp--size">
              <Engraved className="ph-lab" aria-hidden="true">
                Size
              </Engraved>
              <Counter
                label="Caption size"
                options={SIZES}
                value={eng.size}
                onChange={(v) => press(`#capSize button[data-v="${v}"]`)}
                digits={0}
                nameWidth={16}
                wrap={false}
                className="ph-counter"
              />
            </div>
            <div className="ph-grp ph-grp--bold">
              <Engraved className="ph-lab" aria-hidden="true">
                Bold
              </Engraved>
              <Switch
                label="Bold caption"
                checked={eng.bold}
                onChange={(next) =>
                  press(`#capWeight button[data-v="${next ? 700 : 400}"]`)
                }
              />
            </div>
          </div>

          <div className="ph-actions">
            <div className="ph-release">
              <Engraved
                className="ph-lab"
                tone={eng.camera ? undefined : 'soft'}
                aria-hidden="true"
              >
                Capture
              </Engraved>
              <Shutter id="captureBtn" disabled={!eng.camera} />
            </div>
            <KeyWell className="ph-keys" label="Photo">
              <Key
                legend="Load"
                onClick={() => {
                  const input = byId('photoInput') as HTMLInputElement | null;
                  if (!input) return;
                  // choosing the same file again loads it again
                  input.value = '';
                  input.click();
                }}
              />
              <Key
                id="takeBtn"
                legend="Camera"
                pressed={eng.camera}
                onClick={() => {
                  // no camera API (a page that is not https): the phone's
                  // own camera through the file picker
                  if (!navigator.mediaDevices?.getUserMedia) {
                    press('#cameraInput');
                  }
                }}
              />
              <Key
                print
                legend={eng.printLegend}
                disabled={eng.printDisabled}
                onClick={() => press('#printBtn')}
              />
            </KeyWell>
          </div>
        </div>
      </Body>
      <EngineControls />
    </div>
  );
}
