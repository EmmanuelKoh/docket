'use client';

// The Photo tool's markup, converted 1:1 from the retired
// views/photo.liquid. This component renders once and never re-renders:
// all interaction is owned by the imperative engine
// (components/photo-engine.js), which is live-tested against the printer
// and mounted via the effect below. Element ids, class names and data-*
// attributes are the contract with the engine and with photo-tool.css —
// change them together or not at all.

import { useEffect } from 'react';
import { initPhotoTool } from '@/components/photo-engine.js';

export function PhotoTool() {
  useEffect(() => initPhotoTool(), []);

  return (
    <div className="photo-tool" id="photoTool">
      <div className="photo-controls">
        <label className="dropzone pnl" id="dropzone" data-panel="source">
          <input type="file" id="photoInput" accept="image/*" hidden />
          <span id="dropHint">
            Choose a photo
            <br />
            <span className="sub">or drop one here</span>
          </span>
        </label>
        <label className="btn photo-take pnl" id="takeBtn" data-panel="source">
          <input
            type="file"
            id="cameraInput"
            accept="image/*"
            capture="environment"
            hidden
          />
          Take a photo
        </label>
        <div className="photo-editor" id="photoEditor" hidden>
          <video id="cameraFeed" autoPlay playsInline muted />
          <canvas id="camDither" className="cam-dither" />
          <canvas className="pnl" id="editCanvas" data-panel="crop" />
          <div className="camera-tools">
            <button
              type="button"
              className="shutter"
              id="captureBtn"
              title="Capture"
            />
            <button
              type="button"
              className="camera-cancel"
              id="cameraCancelBtn"
            >
              cancel
            </button>
          </div>
          <div className="edit-tools pnl" data-panel="crop">
            <div className="seg" id="cropPresets">
              <button type="button" data-a="" className="on">
                Full
              </button>
              <button type="button" data-a="1">
                1:1
              </button>
              <button type="button" data-a="1.3333">
                4:3
              </button>
              <button type="button" data-a="1.5">
                3:2
              </button>
            </div>
            <button type="button" className="btn small" id="rotateBtn">
              Rotate 90°
            </button>
          </div>
          <div className="tone-group">
            <button type="button" className="tone-toggle" id="toneToggle">
              <span className="label">Adjustments</span>
              <span className="tone-val" id="toneSummary" />
              <span className="tone-chev" id="toneChev">
                &#9656;
              </span>
            </button>
            <div className="tone-body" id="toneBody" hidden>
              <div className="tone-head pnl" data-panel="levels">
                <span className="label" id="levelsLabel">
                  Levels
                </span>
                <button type="button" className="auto-toggle on" id="autoBtn">
                  auto
                </button>
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
              >
                <div className="level-handle black" id="handleBlack" />
                <div className="level-handle white" id="handleWhite" />
              </div>
              <div className="tone-row pnl" data-panel="mid">
                <span className="label" id="midLabel">
                  Midtone
                </span>
                <input
                  type="range"
                  id="midSlider"
                  min="-100"
                  max="100"
                  defaultValue="0"
                />
                <span className="tone-val" id="midVal">
                  0
                </span>
              </div>
              <div className="tone-row pnl" data-panel="shadow">
                <span className="label" id="shadowLabel">
                  Shadows
                </span>
                <input
                  type="range"
                  id="shadowSlider"
                  min="-100"
                  max="100"
                  defaultValue="0"
                />
                <span className="tone-val" id="shadowVal">
                  0
                </span>
              </div>
              <div className="tone-row pnl" data-panel="bright">
                <span className="label" id="brightLabel">
                  Brightness
                </span>
                <input
                  type="range"
                  id="brightSlider"
                  min="-100"
                  max="100"
                  defaultValue="0"
                />
                <span className="tone-val" id="brightVal">
                  0
                </span>
              </div>
              <div className="tone-row pnl" data-panel="contrast">
                <span className="label" id="contrastLabel">
                  Contrast
                </span>
                <input
                  type="range"
                  id="contrastSlider"
                  min="-100"
                  max="100"
                  defaultValue="0"
                />
                <span className="tone-val" id="contrastVal">
                  0
                </span>
              </div>
              <div className="tone-row pnl" data-panel="sharp">
                <span className="label" id="sharpLabel">
                  Sharpen
                </span>
                <input
                  type="range"
                  id="sharpSlider"
                  min="0"
                  max="200"
                  defaultValue="0"
                />
                <span className="tone-val" id="sharpVal">
                  0
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="photo-field">
          <span className="label">Caption</span>
          <input
            className="editable"
            id="captionInput"
            placeholder="optional"
            spellCheck={false}
            maxLength={120}
          />
          <div className="caption-tools">
            <div className="seg" id="capSize">
              <button type="button" data-v="28">
                S
              </button>
              <button type="button" data-v="36" className="on">
                M
              </button>
              <button type="button" data-v="48">
                L
              </button>
            </div>
            <div className="seg" id="capWeight">
              <button type="button" data-v="400" className="on">
                Regular
              </button>
              <button type="button" data-v="700">
                Bold
              </button>
            </div>
          </div>
        </div>
        <div className="tool-dock" id="toolDock">
          <button type="button" data-panel="source">
            Photo
          </button>
          <button type="button" data-panel="crop" className="on">
            Crop
          </button>
          <button type="button" data-panel="levels">
            Levels
          </button>
          <button type="button" data-panel="mid">
            Midtone
          </button>
          <button type="button" data-panel="shadow">
            Shadows
          </button>
          <button type="button" data-panel="bright">
            Brightness
          </button>
          <button type="button" data-panel="contrast">
            Contrast
          </button>
          <button type="button" data-panel="sharp">
            Sharpen
          </button>
        </div>
      </div>
      <div className="photo-stage">
        <div className="photo-roll" id="photoRoll">
          <div className="empty" id="photoEmpty">
            Choose a photo to see the print preview
          </div>
        </div>
        <div className="photo-actions">
          <span className="status" id="photoStatus" />
          <button type="button" className="btn" id="printBtn" disabled>
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
