# Tape transcription v2: from thresholds to global decoding

Status: proposed, 2026-07. The v1 pipeline (pitch worker, note tracker)
works for mid-register takes over a dam but fails at register edges and
accumulates interacting thresholds. This note records why, and the v2
architecture.

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
(Melodia et al.) — why hand-roll? Correct. v1's detector was built for
the original solo-duduk assumption; the dam moved the problem into the
predominant-melody-extraction field and the right response is to adopt
a research-grade front end rather than rebuild one:

- **@spotify/basic-pitch** (Apache-2.0, tfjs): neural polyphonic
  audio-to-MIDI. Outputs note events with onsets, durations, and pitch
  bends; polyphony means it can report melody AND dam simultaneously
  (we filter the dam by register). Runs in the browser and in Node.
  First candidate.
- **essentia.js** (AGPL-3.0, WASM): literal Melodia
  (PredominantPitchMelodia) — f0 contour of the predominant melody over
  accompaniment. Strong fit, but AGPL needs a license decision for this
  public repo before adoption.

On dependencies: this repo has no no-dependency rule. Dependencies are
discussed and adopted on their merits (fit, license, size, maintenance)
like any other design decision. The v1 workers were vanilla JS only
because classic public/ workers cannot import npm modules without a
bundling step — a technical detail, not a policy, and not a reason to
avoid adopting research-grade libraries where they fit.

**Bake-off result (2026-07-09): Basic Pitch wins decisively.** Run
offline on both fixtures (scripts: session scratchpad
bakeoff-basicpitch.mjs + skeleton.mjs). It transcribes melody AND dam
as separate note tracks (fixture 1's dam: F#3 moving to B2 at the end),
and a trivial skeleton filter (melody register G#3..G#5, amplitude >=
0.45, merge same-pitch gaps <= 120ms, drop < 120ms) yields 12-13 note
skeletons matching the maintainer's ground truth on BOTH takes —
including the low B3/A#3 ending that v1's spectral analysis could not
resolve at any threshold (one B3 2.5s, no octave errors). Merged
segments carry an articulation count, a direct input for the ornament
pass. Junk (hallucinated low notes in near-silence, harmonic spray)
sits at low amplitude and dies to the filter. essentia.js was not
needed. Adoption: tfjs + bundled model (~5-10 MB, served from public/,
offline like everything else), Apache-2.0 notice alongside the Bravura
one. The winner
becomes stage 1-3 of the pipeline below (Basic Pitch subsumes salience
AND decoding); our remaining work is the duduk-specific interpretation
layer (reference from the dam, up-from-base vibrato identity,
grace-vs-vibrato, ornament marks) and the unchanged rendering pipeline.
What the literature does NOT provide off the shelf is exactly that
interpretation layer — the v1 lessons feed it.

## Multi-pass decoding (maintainer's framing, adopted)

Whatever the front end, decoding is COARSE TO FINE, each pass
independently testable:

1. **Skeleton pass** — main melody only: long, confident notes, rests,
   breaths. Aggressively conservative; no ornaments. This must be right
   before anything else is attempted, and is the bar for "working".
2. **Ornament pass** — attribute the residual pitch activity around the
   skeleton (fast neighbor visits, dips, alternations) as grace notes
   where confident, approximate ornament MARKS where not. BUILT
   2026-07-09 (scripts/tape-eval/ornaments.mjs): graces are residual
   fragments that dip below a nearby main note or sit 2+ semitones
   above it (exactly +1 is a vibrato crest, never an ornament); a main
   note re-struck after an ornament splits in two when the ornament
   OVERLAPS the note's own segments at an internal boundary — sequential
   flicks (note pauses, flick sounds, note resumes) decorate a single
   held note and do not split it. Approximate ornament marks still
   pending (needs a Bravura mordent/turn glyph in the renderer).
3. **Marking pass** — notation detail: slide connectors on glide
   transitions, vibrato/ornament squiggles, breath commas (already
   done in rendering). BUILT 2026-07-09 (scripts/tape-eval/marks.mjs):
   slide connectors fire when a note's opening frames sit about a
   semitone under the take's bend center (approached from below —
   the same sub-run-length material the re-snap refuses to relabel);
   rendered as a diagonal between pitches or a dip scoop for
   same-pitch slides. Ornament squiggles (Bravura ornamentShortTrill,
   rasterized like the clef) print above the staff at same-pitch
   re-strikes whose pre-strike ornament was too quiet to render as a
   grace — visible uncertainty instead of a confidently wrong note. A
   re-strike with a shown grace gets neither mark; the grace is the
   notation.

## v2 architecture (used only where the bake-off leaves gaps)

Four stages. Only the third is genuinely new code.

1. **Salience analysis (no decisions).** For the whole take, compute a
   continuous pitch-salience map: multi-resolution spectra (1024 AND
   2048 windows at 24 kHz, fused — short preserves ornaments, long
   resolves the low register), background subtraction as today, comb
   salience over a fine pitch grid. Emit the map; discard nothing. The
   existing worker becomes this layer with modest reshaping.

2. **Reference estimation ("auto-tune the reference, not the audio").**
   The dam drones the tonal center all take: estimate the dam track and
   the melody pitch histogram, derive the take's own pitch grid
   (tonic + scale degrees + local intonation offset, per section).
   Replaces the global Tuning slider and absorbs intonation drift.

3. **Global decoding.** One Viterbi pass over the salience map: states =
   scale notes x {note, ornament-visit} + rest; emissions = salience +
   energy; transitions encode the v1 lessons as priors (vibrato rises
   from base and never moves the lower envelope; ornaments are brief
   neighbor visits near transitions; minimum note durations; breath
   rests; octave jumps are penalized). This single optimization replaces
   the threshold stack. Sliders become a few interpretable priors
   (ornament sensitivity, rest sensitivity, tempo scale).

4. **Rendering (unchanged).** Renderer, engraved glyphs, look-behind
   feed, grace notes, player, print path are validated and stay. Replay
   = exact decode of the whole clip. Live mode = raw trace immediately,
   decoded tape following with a few seconds of lookahead (printing
   trails further anyway). Planned notation additions ride on decoder
   output: approximate-ornament squiggles where the decoder is unsure,
   slide connectors on glide transitions.

## Robustness checklist (before pass 1 is "done")

Ranked. The first item gates the rest.

1. **Evaluation corpus + automated scoring.** DONE (2026-07-09):
   `npm run tape:eval` transcribes every `data/clips/*.truth.json`
   fixture through Basic Pitch + the pass-1 skeleton
   (scripts/tape-eval/) and scores the note+rest sequence against truth
   by global alignment. Baseline: dam-melody-1 F=1.00, take2 F=0.92
   against provisional truth, mean 0.96; exit code fails under 0.75.
   Every flagged clip becomes a fixture. Robustness is a number, not a
   vibe.
2. **Input normalization.** Arbitrary Load-clip files: resample to
   22050 via OfflineAudioContext (not linear interp), deliberate stereo
   downmix, loudness normalization before inference. Skeleton
   thresholds relative to the take's own amplitude distribution, never
   absolute constants.
3. **Derived, not hardcoded, register split.** Identify the dam as the
   long-persistence track; derive or profile the melody band (bass
   duduk, other keys, no-dam solo takes must degrade gracefully).
4. **Predominant-line selection** for overlapping melody-band notes
   (second voice, octave doubles): prefer continuity + strength —
   Melodia-style contour thinking at the note level.
5. **Tuning re-snap from pitch bends.** DONE for the sharp-side case
   (2026-07-09): the take's bend center is estimated from its own
   duration-weighted bend histogram, and sustained runs sitting about a
   semitone below it re-snap down (a sharp-played D#4 with upward
   vibrato is otherwise labeled E4). Guard rails: short low stretches
   are slides, very deep sags are reverb decays — neither re-snaps.
   Flag: repertoire may be genuinely microtonal — equal temperament is
   an untested assumption.
6. **Tempo-relative durations.** MIN_LEN/merge-gap scale with the
   take's note-length distribution or are exposed as priors.
7. **Visible uncertainty.** Low-confidence regions render as
   approximate ornament marks, never as confidently wrong notes —
   pass 2 doubles as the failure-handling strategy.
8. **Long-take performance.** Chunked inference with overlap, progress
   UI; live mode = raw trace live, decode on stop (stated in UI).
9. Housekeeping: Apache-2.0 notice for Basic Pitch; audio never leaves
   the machine (fixtures gitignored, inference in-browser).

## What stays hard regardless

- Passages ~20 dB under the melody's level (measured -26 dB for one
  fast figure) are below any algorithm's reach: mic placement/balance.
- Sub-60ms ornaments are at the analysis floor; the decoder can place
  them by context but not conjure their pitch. Measured case
  (2026-07-09): the E4-D#4-E4 slide opening take2's first phrase leaves
  NO trace even in Basic Pitch's raw contour — the salience map is flat
  on E4 through the whole figure. Fast shallow dips during a quiet
  attack, under the note's own reverb, sit below the model's
  time-pitch resolution. Candidate fix if calibration clips show the
  floor is the model and not the mic: a high-resolution attack
  resolver over the ~150ms around each note onset (the v1 spectral
  machinery, repurposed), feeding pass 3.

## Evaluation

data/clips/ fixtures with maintainer-supplied ground truth, plus
requested calibration clips (long D#4 with natural vibrato; slow
E4-D#4-E4 alternation; long B3 with vibrato) to fit the vibrato and
intonation priors per register. The offline harness pattern (vm-load
the worker + decode + diff against ground truth) carries over.
