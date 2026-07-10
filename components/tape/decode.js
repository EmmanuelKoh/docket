// components/tape/decode.js — the neural transcription wrapper:
// recording in, raw note events out (t0/t1/midi/amp/bends/onset). Basic
// Pitch (Apache-2.0, model bundled in public/basic-pitch/) transcribes
// polyphonically — melody AND dam as separate note tracks — and the take
// document (doc.mjs) reduces that to the tape. tfjs is lazy-loaded on
// first use and the model instance is cached at module level, so it
// survives React remounts and later takes skip the load.

import { normalizeLoudness } from '../../scripts/tape-eval/normalize.mjs';
import { onsetAt } from '../../scripts/tape-eval/ornaments.mjs';

let neural = null; // cached { bp, ...bpModule } after first use

async function resampleTo22050(f32, srcRate) {
  if (Math.round(srcRate) === 22050) return f32;
  const oac = new OfflineAudioContext(
    1,
    Math.ceil((f32.length * 22050) / srcRate),
    22050,
  );
  const buf = oac.createBuffer(1, f32.length, srcRate);
  buf.copyToChannel(f32, 0);
  const src = oac.createBufferSource();
  src.buffer = buf;
  src.connect(oac.destination);
  src.start();
  return (await oac.startRendering()).getChannelData(0);
}

// onStatus receives human-readable progress lines for the status area.
export async function transcribe({ samples, sampleRate, onStatus }) {
  if (!neural) {
    onStatus?.('loading the transcriber…');
    const bpModule = await import('@spotify/basic-pitch');
    neural = {
      ...bpModule,
      bp: new bpModule.BasicPitch('/basic-pitch/model.json'),
    };
  }
  // loudness-normalize to the corpus calibration level: the whole
  // evidence chain is amplitude-shaped, and this makes mic gain and
  // clip level irrelevant to the transcription. Playback and the
  // raw-pitch trace keep the original audio
  const audio = normalizeLoudness(await resampleTo22050(samples, sampleRate));
  const frames = [];
  const onsets = [];
  const contours = [];
  await neural.bp.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (pct) => {
      onStatus?.(`transcribing… ${Math.round(pct * 100)}%`);
    },
  );
  const frameEvents = neural.addPitchBendsToNoteEvents(
    contours,
    neural.outputToNotesPoly(frames, onsets, 0.4, 0.3, 5),
  );
  const events = neural.noteFramesToTime(frameEvents);
  return events
    .map((e, i) => ({
      t0: e.startTimeSeconds,
      t1: e.startTimeSeconds + e.durationSeconds,
      midi: e.pitchMidi,
      amp: e.amplitude,
      bends: e.pitchBends ?? [],
      onset: onsetAt(onsets, frameEvents[i].startFrame, e.pitchMidi),
    }))
    .sort((a, b) => a.t0 - b.t0);
}
