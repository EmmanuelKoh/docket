# Tape transcription v2: from thresholds to global decoding

Status (October 2026): shipped in the Tape tool, in this form:

- Basic Pitch transcribes the recording in the browser
  (`components/tape/decode.js`). Its model ships in `public/basic-pitch/`
  (about 0.9 MB). The take decodes when recording stops or a file loads;
  while the mic is live the screen shows only the raw pitch trace.
- Before the model runs, the input is normalized for loudness
  (`scripts/tape-eval/normalize.mjs`) and, when the take sits 40 cents or
  more off the semitone grid, resampled onto it
  (`scripts/tape-eval/tuning.mjs`).
- Passes 1 to 3 below turn the model's notes into the tape
  (`scripts/tape-eval/skeleton.mjs`, `ornaments.mjs`, `marks.mjs`). The
  browser (`components/tape/doc.mjs`) and the eval harness
  (`npm run tape:eval`) run the same modules.
- Ornaments render as a small arc above the staff on the ornamented main
  note, never as grace noteheads.

The salience map and Viterbi decoder described under "v2 architecture"
were not built: Basic Pitch replaced them. The rest of this note records
why v1 failed and how the shipped pipeline was chosen.

## What v1 taught us

Built and validated against real clips (data/clips/, gitignored):

- Time-domain pitch detection (MPM) is helpless against a dam: 0/272
  frames on melody in the mixture test. Spectral subtraction plus
  harmonic salience works.
- The dam breathes, wobbles, and changes pitch. Minimum statistics
  collapse at every breath; a plain EMA absorbs the melody. A dual-rate
  log-domain tracker (bins present more than a third of the time are
  background) holds up.
- A held note and a drone are indistinguishable by persistence. The only
  discriminator is what the tracker is holding, and hold masks must be
  tuning-corrected or a sharp player's own harmonics get eaten.
- Duduk vibrato tends to rise FROM the base pitch, so nearest-semitone
  snapping misreads D#4-with-vibrato as E4. But vibrato style varies per
  note (the fixture's B3 dips below base), so a single margin fails.
- Grace notes are played as fast, shallow dips (~60-70 cents) that never
  reach the neighbor's pitch. Recognizing them requires hindsight; the
  engine renders ~300ms behind analysis for exactly this.
- Intonation drifts per take (+18 vs +30 cents) and within a take
  (~25 cents inside one passage).
- Register edges break single-resolution analysis: at A#3 (233 Hz) the
  43ms window cannot separate melody from a dam two semitones below,
  and octave errors take over.

The failure pattern of v1 is structural: ~15 causal, frame-local
thresholds (clarity gate, rest gate, onset floor, jump/glide, ornament
window/lockout/depth, octave holds...) that each fix one fixture and
regress another. Transcription is a global inference problem; v1 makes
greedy local decisions.

## Stand on research first (revision, 2026-07)

The maintainer's challenge: decades of melody-extraction research exist
(Melodia et al.), so why hand-roll? Correct. v1's detector was built for
the original solo-duduk assumption. The dam moved the problem into the
predominant-melody-extraction field, and the right response is to adopt
a research-grade front end rather than rebuild one:

- **@spotify/basic-pitch** (Apache-2.0, tfjs): neural polyphonic
  audio-to-MIDI. Outputs note events with onsets, durations, and pitch
  bends; polyphony means it can report melody AND dam simultaneously
  (we filter the dam by register). Runs in the browser and in Node.
  First candidate.
- **essentia.js** (AGPL-3.0, WASM): literal Melodia
  (PredominantPitchMelodia), the f0 contour of the predominant melody
  over accompaniment. Strong fit, but AGPL needs a license decision for
  this public repo before adoption.

On dependencies: this repo has no no-dependency rule. Dependencies are
discussed and adopted on their merits (fit, license, size, maintenance)
like any other design decision. The v1 workers were vanilla JS only
because classic public/ workers cannot import npm modules without a
bundling step. That was a limit of those workers. It does not rule out
research-grade libraries where they fit.

**Bake-off result (2026-07-09): Basic Pitch wins decisively.** Run
offline on both fixtures. It transcribes melody AND dam as separate note
tracks (fixture 1's dam: F#3 moving to B2 at the end), and a trivial
skeleton filter (melody register G#3..G#5, amplitude >= 0.45, merge
same-pitch gaps <= 120ms, drop < 120ms) yields 12-13 note skeletons
matching the maintainer's ground truth on BOTH takes, including the low
B3/A#3 ending that v1's spectral analysis could not resolve at any
threshold (one B3 2.5s, no octave errors). Merged segments carry an
articulation count, a direct input for the ornament pass. Junk
(hallucinated low notes in near-silence, harmonic spray) sits at low
amplitude and dies to the filter. essentia.js was not needed. Adopted:
tfjs plus the bundled model (about 0.9 MB, served from public/, offline
like everything else), with Basic Pitch's Apache-2.0 license beside the
model. Basic Pitch covers salience AND decoding. Our work is the
duduk-specific interpretation layer (up-from-base vibrato identity,
grace-vs-vibrato, ornament marks) and the unchanged rendering pipeline.
What the literature does NOT provide off the shelf is exactly that
interpretation layer; the v1 lessons feed it.

## Multi-pass decoding (maintainer's framing, adopted)

Whatever the front end, decoding is COARSE TO FINE, each pass
independently testable:

1. **Skeleton pass:** main melody only: long, confident notes, rests,
   breaths. Aggressively conservative; no ornaments. This must be right
   before anything else is attempted, and is the bar for "working".
   BUILT (scripts/tape-eval/skeleton.mjs).
2. **Ornament pass:** attribute the residual pitch activity around the
   skeleton (fast neighbor visits, dips, alternations). BUILT 2026-07-09
   (scripts/tape-eval/ornaments.mjs): ornament fragments are residuals
   that dip below a nearby main note or sit 2+ semitones above it
   (exactly +1 is a vibrato crest, never an ornament). A main note
   re-struck after an ornament splits in two when the ornament OVERLAPS
   the note's own segments at an internal boundary. Sequential flicks
   (note pauses, flick sounds, note resumes) decorate a single held note
   and do not split it. Detected ornaments are not cut into the tape as
   small notes; pass 3 marks them.
3. **Marking pass:** notation detail on the main notes. BUILT 2026-07-09
   (scripts/tape-eval/marks.mjs). Slide connectors fire when a note's
   opening frames sit about a semitone under the take's bend center
   (approached from below, the same sub-run-length material the re-snap
   refuses to relabel), or when the previous note's closing frames sag
   toward it. They render as a diagonal between pitches, or a dip scoop
   for a slide that returns to the same pitch. Every ornamented main note
   gets an ornament mark: a small backwards "c", drawn procedurally as
   an arc above the staff. A detected ornament attaches to the main note
   whose attack it sits nearest, and a same-pitch re-strike counts as
   ornamented even when its ornament is below the model's floor. Brief
   upper-neighbor excursions in the v1 fine-cents trace
   (scripts/tape-eval/fine.mjs in the harness, the trace backfill in the
   browser) add marks the model misses. An ornament mark suppresses the
   slide mark on the same note. Breath commas come from rendering.

## v2 architecture (not built)

This was the plan before the bake-off, for wherever Basic Pitch left
gaps. Basic Pitch took stages 1 and 3. `scripts/tape-eval/tuning.mjs`
stands in for stage 2 with one global offset per take.

1. **Salience analysis (no decisions).** For the whole take, compute a
   continuous pitch-salience map: multi-resolution spectra (1024 AND
   2048 windows at 24 kHz, fused: short preserves ornaments, long
   resolves the low register), background subtraction, comb salience
   over a fine pitch grid. The map is kept whole; no pitch is dropped
   at this stage.

2. **Reference estimation ("auto-tune the reference, not the audio").**
   The dam drones the tonal center all take: estimate the dam track and
   the melody pitch histogram, derive the take's own pitch grid
   (tonic + scale degrees + local intonation offset, per section).
   Absorbs intonation drift.

3. **Global decoding.** One Viterbi pass over the salience map: states =
   scale notes x {note, ornament-visit} + rest; emissions = salience +
   energy; transitions encode the v1 lessons as priors (vibrato rises
   from base and never moves the lower envelope; ornaments are brief
   neighbor visits near transitions; minimum note durations; breath
   rests; octave jumps are penalized). This single optimization replaces
   the threshold stack. Sliders become a few interpretable priors
   (ornament sensitivity, rest sensitivity, tempo scale).

4. **Rendering (unchanged).** Renderer, engraved glyphs, player and
   print path stay. Replay is an exact decode of the whole clip.

## Robustness checklist (before pass 1 is "done")

Ranked. The first item gates the rest.

1. **Evaluation corpus + automated scoring.** DONE (2026-07-09):
   `npm run tape:eval` transcribes every `data/clips/*.truth.json`
   fixture through Basic Pitch and passes 1-3 (scripts/tape-eval/) and
   scores the note+rest sequence against truth by global alignment.
   Baseline: dam-melody-1 F=1.00, take2 F=0.92 against provisional
   truth, mean 0.96; exit code fails under 0.75. Every flagged clip
   becomes a fixture.
2. **Input normalization.** Loudness DONE (2026-07-09,
   scripts/tape-eval/normalize.mjs): every input reaches the model at
   one calibration level (active-median frame RMS 0.025,
   corpus-selected), because the whole evidence chain is
   amplitude-shaped: a bare -6 dB gain change was measured to flip note
   decisions (a confirmed G4 vanished). With normalization the corpus
   scores IDENTICALLY at input gains 0.5x-4x (TAPE_GAIN=<g> npm run
   tape:eval is the regression check). Cost: mean F 0.98 -> 0.96 at the
   common level; take2's rearticulation-dip region gains two razor-edge
   insertions.
   Tuning DONE (scripts/tape-eval/tuning.mjs): the take's offset from
   the semitone grid is estimated, and a take 40 cents or more off it
   (with enough voiced evidence) is resampled onto the grid before Basic
   Pitch. TAPE_DETUNE=<cents> and TAPE_RETUNE=0 are the regression
   hooks. Still open: stereo downmix and resampling quality for
   arbitrary loaded files.
   NEGATIVE RESULT (2026-07-09): classic late-reverb spectral
   subtraction as a preprocessing stage (scripts/tape-eval/dereverb.mjs,
   A/B via TAPE_DEREVERB=1 npm run tape:eval) made every fixture WORSE
   (mean F 0.87 at best vs 0.98 raw, swept over rt60/strength): the
   symbolic reverb rules already extract what the tail carries, and the
   DSP's sustain-thinning fragments notes. The module stays in the
   harness for future A/Bs. A maintainer-supplied neural-dereverbed
   reference file would measure the ceiling before any heavier
   dependency is considered.
3. **Derived, not hardcoded, register split.** Identify the dam as the
   long-persistence track; derive or profile the melody band (bass
   duduk, other keys, no-dam solo takes must degrade gracefully). Open:
   the melody band is a per-instrument profile.
4. **Predominant-line selection** for overlapping melody-band notes
   (second voice, octave doubles): prefer continuity + strength,
   Melodia-style contour thinking at the note level. Open.
5. **Tuning re-snap from pitch bends.** DONE for the sharp-side case
   (2026-07-09): the take's bend center is estimated from its own
   duration-weighted bend histogram, and sustained runs sitting about a
   semitone below it re-snap down (a sharp-played D#4 with upward
   vibrato is otherwise labeled E4). Guard rails: short low stretches
   are slides, very deep sags are reverb decays; neither re-snaps.
   Flag: repertoire may be genuinely microtonal, and equal temperament
   is an untested assumption.
6. **Tempo-relative durations.** MIN_LEN/merge-gap scale with the
   take's note-length distribution or are exposed as priors. Open.
7. **Visible uncertainty.** Uncertain ornament activity renders as an
   ornament mark, never as a confidently wrong note. DONE with pass 3.
8. **Long-take performance.** The take decodes on stop with a
   percentage on the status line; while the mic is live only the raw
   trace draws.
9. Housekeeping: Basic Pitch's Apache-2.0 license ships in
   `public/basic-pitch/`. Inference runs in the browser, and the
   fixtures are gitignored. A saved take uploads its WAV to the
   account's storage.

## What stays hard regardless

- Passages ~20 dB under the melody's level (measured -26 dB for one
  fast figure) are below any algorithm's reach: mic placement/balance.
- Sub-60ms ornaments are at the analysis floor. The passes can place
  them from context but cannot recover their pitch. Measured case
  (2026-07-09): the
  E4-D#4-E4 slide opening take2's first phrase leaves NO trace even in
  Basic Pitch's raw contour; the salience map is flat on E4 through the
  whole figure. Fast shallow dips during a quiet attack, under the
  note's own reverb, sit below the model's time-pitch resolution.
  Candidate fix if calibration clips show the floor is the model and not
  the mic: a high-resolution attack resolver over the ~150ms around each
  note onset (the v1 spectral machinery, repurposed), feeding pass 3.

## Evaluation

data/clips/ fixtures with maintainer-supplied ground truth, plus
requested calibration clips (long D#4 with natural vibrato; slow
E4-D#4-E4 alternation; long B3 with vibrato) to fit the vibrato and
intonation priors per register. The harness runs the browser's pass
modules in Node, with the v1 detector vm-loaded for the fine-cents trace
(scripts/tape-eval/fine.mjs), and diffs the result against ground truth.
