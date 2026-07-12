# Docket: dashboard design spec

The source of truth for building the dashboard UI. The HTML mockups (if
present alongside) are visual reference only. Build from this spec, not by
extending the mockup files.

## Identity

Two-color register ribbon: everything is one neutral gray ramp (monochrome),
plus a single deep "register red" used only where an old receipt printer would
ink red: attention and motion. Paper-flat, hairline rules, no shadows, no
gradients. Data is monospace; labels are small letterspaced caps.

Name/wordmark: DOCKET, mono font, 14px, weight 500, letter-spacing 0.14em.

## Fonts (standalone stacks, no external dependencies required)

--font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace

Weights: 400 and 500 only. Mono is for DATA VALUES only (counts, job names,
timestamps, config JSON, intervals), never for labels or body copy.

Icons: any single icon set, outline style, 14-15px, colored --ink-faint.
(The mockups used Tabler icons via webfont; self-host or swap freely.)

## Color tokens: light ("paper") and dark ("darkroom")

| Token          | Light    | Dark     | Use                                    |
|----------------|----------|----------|----------------------------------------|
| --page         | #fbfbfa  | #161615  | page background                        |
| --raised       | #ffffff  | #1c1c1a  | cards, stat strip, list containers     |
| --hairline     | #eaeae8  | #2e2d2b  | inner row separators                   |
| --border       | #dcdcda  | #2e2d2b  | card/container borders (0.5px)         |
| --dash         | #c6c6c3  | #3d3c39  | dashed section dividers                |
| --ink          | #161616  | #e8e6e1  | primary text, heavy rule, on-toggle    |
| --ink-muted    | #6d6d6a  | #8f8d87  | secondary text                         |
| --ink-faint    | #9b9b97  | #6b6963  | labels, hints, icons                   |
| --red          | #b3261e  | #d64541  | THE accent (see usage rules)           |

Dark mode is the same ramp inverted; red is the same hue at a brighter stop
(deep red goes muddy on near-black).

Page texture: the body carries a faint dither grain, a repeating 96x96
tile of ~120 seeded-random dots, sized 60% 1px / 25% 1.5px / 15% 2px, in
mixed tones. In LIGHT mode all dots sit a touch darker than --page, never
lighter (bright specks on paper read as noise, not grain). In DARK mode
about a third of the base grain may sit slightly lighter than --page
(#1b1b1a/#232322). Near-black has little room below it, so a hint of
lift keeps the texture perceptible. Plus three deeper tiers, each rarer
as it gets heavier:
  ~5%   rare:  one step down (#dcdcd9 light / #060606 dark), 1px only
  ~2.5% ultra: darker still (#a5a5a1 light / #000000 dark), 1px only
  ~1.5% mid:   the rare-tier tone at 1.5px (the rarest tier)
Visual weight (depth × size) is budgeted: the darker or bigger a fleck,
the rarer it must be. Nothing dark ever reaches 2px. The effect echoes
thermal-paper dithering.
Small uniform tiles read as a lattice; randomness reads as grain. Cards
and list containers stay solid --raised so they lift off the texture.
Keep it barely perceptible, so it reads as texture rather than pattern.
Toggle: moon icon (light) / sun icon (dark) in the header; persist the
choice in localStorage (this is a normal hosted page, not a sandboxed
artifact).

### Red usage rules (strict)

Red appears ONLY as: (1) active nav underline, (2) job status "printing" /
inflight, (3) failures and error text, (4) queue count when nonzero,
(5) live audio actually running (the Tape tool's mic button while
listening, its Pause button and playhead while a clip plays: hardware or
transport actively running, the same family as "printing").
Everything else is gray. Enabled/on states are INK, not red (a working
plugin is normal, not an alert). Success/"done" is --ink-muted text.
Green is not used anywhere.

## Spacing system

- Content column: max 1120px, centered. Gutters are max(48px, half the
  leftover viewport): never under 48px, growing naturally on wide screens.
  The studio (/studio) stays full-bleed; it is a workbench, not a page.
- Phones (≤640px): gutters drop to 16px, the sidebar collapses to a sheet,
  the stat strip becomes a 2×2 grid, history expand stacks its columns
  without the indent, slip config labels sit above their values,
  thumbnails shrink one step (96x64 rows / 110x74 queue), and the Photo
  tool goes single column with a taller tap target. Same components with
  denser wrapping, not a separate mobile design.
- Header: 16px vertical padding; bottom rule 1.5px solid --ink, full-bleed,
  with contents aligned to the content column.
- Sidebar and tab rows: 13px text. The active item gets --ink text and a
  1.5px --red mark: a bar on the item's left edge in the sidebar, an
  underline in tab rows (the Studio's Template/Data tabs, the Photo tool
  dock). Everything else is --ink-muted.
- Major blocks: 20px apart. Section title block: 16px/500 title,
  12px --ink-faint subtitle 3px below.
- Cards: --raised bg, 0.5px --border, radius 6px, padding 16px 18px,
  12px gap between cards.
- Card detail line: separated by 1px dashed --dash, 14px padding above and
  below, fields 24px apart. Inline-editable values get 1px dotted
  --ink-faint underline.
- List containers: one --raised box, radius 6px; rows inside at 16px 20px
  with 0.5px --hairline separators (no per-row cards).
- Rows: 24px column gap, 16px 20px padding; right meta column fixed 118px, right-aligned, mono
  12px, never wraps ("canceled · 33m" is the sizing case), so timestamps
  rail-align down the page. Rows with a thumbnail TOP-ALIGN all content to
  the media (text centered against tall media floats in dead space); only
  single-line rows center vertically.
- Labels: 11px, letter-spacing 0.12em, UPPERCASE, --ink-faint.
- Body 13px; meta/sub 12px; stat numbers 28px mono.
- Dashed divider between major page zones: 1px dashed --dash, inside the
  gutters.

## Components

Buttons: outline only, 0.5px --border, radius 6px, --raised or --page bg,
--ink text 12-12.5px, padding 6px 12px (4px 10px for in-row buttons).
No filled buttons anywhere.

Toggle: 34x20 pill, 16px knob inset 2px. On: --ink fill, knob --page.
Off: --border fill, knob white/raised.

Status chip (plugins only): 11px caps, 0.06em tracking, 2px 8px, 0.5px
--border, radius 4px. ENABLED = --ink-muted text; OFF = --ink-faint.
Job statuses are plain mono text, not chips: "printing"/"failed" in --red,
"queued"/"done" in --ink-muted / --ink-faint.

Thumbnails (real job/template preview PNGs at build time): landscape to
match the artifact (receipts are wider than tall). 130x86 in list rows,
158x108 in queue cards; 0.5px --border, radius 2px, object-fit contain.
Background is always #fff in BOTH themes: receipts are paper, and a theme
background would letterbox dark bars around them in darkroom mode.
Hovering any list thumbnail floats a 288px-wide peek of the same PNG
(--raised, 0.5px --border, no shadow). Thumbnails identify; the peek and
the History expand are where receipts are read.

## Shell

The app is a Next.js React app with a left sidebar (there is no top nav).
The identity, tokens, red rules, spacing, and components above apply
throughout. Shell rules:

- Sidebar: DOCKET wordmark at top (links home), then Overview, Slips,
  Photo, Tape, Queue, History, Printer. Collapsible to an icon rail; on
  phones it becomes a sheet.
  Items are 13px --ink-muted with 14px outline icons in --ink-faint.
  Active item: --ink text, --hairline pill, and a 1.5px --red bar at the
  item's left edge (the vertical form of the old nav underline).
- The Queue item carries a mono count badge, --red only when nonzero.
- Header: slim row with the sidebar trigger left and theme toggle plus
  logout icon right, keeping the full-bleed 1.5px solid --ink bottom rule.
- Content column: unchanged (max 1120px, gutters per the spacing system).
- Overview: a LATEST PRINT card (the newest history PNG on a white panel,
  receipts are paper in both themes) above the stat strip, then the system
  line, dashed divider, and RECENT (detailed under Overview below).
- Theme: data-theme on <html>, persisted under the localStorage key
  docket-theme, with a no-flash bootstrap so the first paint matches.
- Slips: category-grouped cards of the slip previews, and a slip
  page for each (preview + Print test, plus config and schedule for system
  slips). The Studio (template editor) is served at /studio. Detailed
  under Slips below.
- Printer page: online dot per the 90-second rule, then a read-only
  label/value grid (device seen, store driver, tick, print width, job
  cap, version) and a quiet pointer to the hardware docs.
- Studio page: full-bleed workbench (the sidebar collapses on entry, a
  breadcrumb returns to where you came from). Toolbar card (template
  select mono, New/Save/Delete, Print right with the shortcut hint), then
  editors (Template / Data tabs with the red active underline,
  syntax-highlighted source over the mono editor, JSON error line in
  --red) beside the stage (status dot + mono size line, the receipt
  preview, RECENT JOBS strip). Toasts are a small centered raised chip.
  Keyboard: Cmd/Ctrl+S save, +P print.
- Photo page: the workbench per the Photo spec below (its engine carried
  over verbatim), inside the shell as a card under the title block.
- Tape page: full-bleed workbench like the Studio (the sidebar collapses
  on entry). Live music transcription; detailed under Tape below.
- Receipt previews (the render shown on white paper): one canonical width
  everywhere. The paper is 400px wide with the printed image at 92.3% of
  it (the 576 printable dots within the 624-dot / 80mm stock), centered,
  smooth-scaled. Below 400px of available width it goes full width. This
  is the same on Overview, the slip pages and cards, the Studio, and the
  Photo tool (`components/receipt-preview.tsx`). Small identifying
  thumbnails in list rows are a separate element and keep their row sizes.

## Pages

Every page lives in the sidebar shell above. The specs below describe
each page's content zone.

### Overview
1. Stat strip: ONE bordered container split into 4 cells by 0.5px --hairline
   verticals (not separate cards). Cell: label / 28px mono number (8px
   below label) / 12px sub (2px below). Queue number is --red when > 0.
2. System line (plain text row, 12px, 24px gaps): printer online dot
   (6px --ink circle) + last device contact; store driver; tick interval;
   version right-aligned --ink-faint.
3. Dashed divider.
4. RECENT: label + "view all →" link; the 3 newest history rows (name mono,
   source, status·time in the 92px rail). Same records as History: a
   preview slice, not a separate feature.

### Slips
Everything the printer can produce, grouped by category. One page that
replaces the earlier Templates and Plugins pages.

Index: title block + "New template" button right. Category groups (11px
caps label + mono count chip + hairline rule), then a grid of cards each
fixed at the receipt-paper width (full width when the column is narrower).
Card: the full rendered receipt on white (inset at the paper width, chips
overlaid top-left), a mono name with a corner arrow, a two-line
description, and a footer (engine left, template count right). No Open
button: the card IS the button, its border shifting to --ink-faint on
hover. "New template" opens the Studio blank.

Slip page: breadcrumb, mono title + description, kind (SYSTEM / TEMPLATE)
and LIQUID chips, and for a template slip a two-step Delete (neutral
outline; the red rules forbid a red button here). Left: the PREVIEW stage
(the primary template rendered on white at the paper width) with a Print
test button and mono status beneath. Right, for a system slip: a status
row (enable toggle, ENABLED/OFF chip, right-aligned last-run in mono, --red
when it is an error like "calendar 401 · 2d ago") and a PARAMETERS card.

PARAMETERS card (the per-field config grammar): schedule row first, then a
read-only "next run" line, then per-field config in a label/value grid
(110px caps label column): one dotted-underline mono input per config key,
derived from the config's shape. Arrays edit as one-item-per-line
textareas (also accept commas); numbers are validated (types come from the
plugin's defaults.config); long values wrap at full width and never
overflow. Template names last. The schedule row's shape is fixed by the
plugin's kind: "every [N]s" for watchers, "at [HH:MM] [tz]" for fixed-time;
passive (push-driven) plugins show no schedule and "next run" reads "on
message". There is never a raw-JSON blob input. Edits persist only via one
explicit Save (right of the grid), which also recomputes the next-due time;
there is no save-on-change. The enable toggle is immediate (the click is
the action) and recomputes the due time itself. Invalid input shows a red
inline error spanning the grid and nothing is saved. A disabled slip
drops its text one step (--ink → --ink-muted) and "next run" shows "—".

Below the two columns: TEMPLATES rows (each "Open in Studio"), and for a
system slip the STATE debug record (its stored state JSON).

### Photo
A print tool, not a registry plugin (no run()/toggle, user-initiated).
Title block ("Print a photo on receipt paper."), one card
split make/result: the left column shapes the print, the right column IS
the print (slip preview with the Print button and mono status centered
directly beneath it, so the commit action lives with the result). Left
column (400px): dashed dropzone (1px dashed --dash, choose-or-drop;
slims to a one-line row once a photo exists so the editor becomes the
hero),
a full-width "Take a photo" button (phones open the native camera via the
file input's capture hint or the in-page camera below; the Take-a-photo
button opens an in-page viewfinder on desktops AND phones (phones use the
rear camera, unmirrored, since selfie cams mirror) that shares the editor's
stage, and the viewfinder is LIVE DITHERED: a Web
Worker runs the print pipeline's serpentine dither on each camera frame
(mirrored, paced to the camera's ~30fps, and shown smooth-scaled at the
print's 576-dot width so it reads as the same texture as the render), so
framing already looks like the print. In camera mode the viewfinder takes
the whole stage (the dropzone and preview hide); a camera-app shutter
below: a 44px
--ink ring whose inner disc grows on hover, centered, quiet mono "cancel"
right-aligned; capturing grabs the full-resolution raw frame (mirrored to
match) but the editor then WEARS IT DITHERED: the crop canvas displays a
worker-dithered skin of the capture while the color original stays the
hidden edit source underneath, keeping crops sharp and tone/calibration
working on real grays, so nothing color ever shows for a camera capture),
then the
editor
(appears once a photo loads): the source image on a bordered canvas with a
draggable/resizable crop rectangle (white border + corner handles over a
55% dim outside the crop), preset shortcuts Full / 1:1 / 4:3 / 3:2 (ratios
follow the image's orientation; presets only set the rectangle, which
stays adjustable) and a Rotate 90° button; below that an ADJUSTMENTS section,
collapsed by default behind a header row (caps label, quiet mono
"adjusted" note when anything is non-default, ▸/▾ chevron in --ink-faint,
dashed top rule). Expanded it holds: a LEVELS row (caps label, small mono
AUTO chip (inverse ink while on) and a mono "black · white" readout), a
40px monochrome histogram of the cropped photo with clipped tones dimmed,
a hairline track with two 10px square handles (black filled, white
outlined) dragged to set black/white points, then MIDTONE, SHADOWS,
BRIGHTNESS, CONTRAST and SHARPEN rows: caps label, hairline-track slider
with a 10px square --ink thumb, mono value right. Auto recomputes the
points on every crop/rotate; dragging a handle turns it off;
double-clicking a label resets that control. Adjustments show in the live
render only. The edit canvas keeps the untouched photo (tone ops compose
into one lookup table, sharpening is an unsharp-mask pass, and the
calibration curve still runs last); CAPTION label + dotted editable input
(mono output) with segmented controls for size (S/M/L = 28/36/48px) and
weight (Regular/Bold); outline Print button, mono status text. Right: the
live preview on white paper (the real /preview render of the full-bleed
"Photo Print" template: borderless 576px photo, optional mono caption
below). Photos downscale client-side before upload; every edit re-derives
the print image, so what you see is the dithered print, not an
approximation. Under 720px (phones are the primary use case) the loaded
state becomes an iPhone-style editor, nothing sticky, 20px air between
zones,
top to bottom: the slip preview (roll full width, capped 60vh, taller
slips scroll inside), one tool panel in a fixed-height (~96px, centered)
zone so nothing jumps when switching, a horizontally scrollable tool row
(Photo · Crop · Levels · Midtone · Shadows · Brightness · Contrast ·
Sharpen) styled like the header nav (quiet --ink-muted text, active tool
--ink with the 1.5px --red underline; it IS nav, between tools; replaces
the desktop-only ADJUSTMENTS collapse), then the CAPTION field (always
visible: it's content, not a tool), and a full-width Print at the bottom
with mono status above it. The Crop tool hides the roll so the crop canvas
takes the stage; every other tool shows the preview. The empty state stays
a simple stack: dropzone, Take a photo, empty preview.

Segmented control (.seg): a bordered pill of flush buttons; the active
option is inverse mono (--ink background, --page text), the same idiom as
a toggle that's on, never red.

### Tape

Full-bleed workbench at /tape (sidebar collapses on entry, like the
Studio). Notation glyphs (treble clef, key signature, accidentals,
breath commas) are engraved shapes rasterized from Bravura (SIL OFL),
sized to the staff; the take opens with bare paper, then the clef and
key signature before the first note. Monophonic transcription in two
regimes: while the mic is live, a lightweight pitch tracker sketches
the tape and trace in real time; when the take ends (Stop or Load
clip) the recording is transcribed by a neural model (Basic
Pitch, bundled, in-browser) and decoded into main notes,
rearticulation splits, slide connectors (a thin diagonal between
pitches; a dip scoop for a same-pitch slide), and ornament marks (a
small backwards "c" — a procedurally drawn arc opening toward the
earlier tape — above the staff at the attack of every ornamented main
note). Ornaments never render as small notes on the staff; the arc is
painted OVER the preceding tape rather than inserting rows, so main
notes stay close together. (The renderer still draws small grace
noteheads with shrunk accidentals for the live sketch's tracker
events.) The final tape replaces the sketch. The
preview canvas shows the exact raster rows the printer would receive,
in reading orientation (staff horizontal, time flowing left to right,
new tape entering at the right; the strip auto-follows unless the user
scrolls back). The tape sits on white in both themes, receipts are
paper. A take past the preview's width cap (~14 minutes of sounding
tape) keeps printing whole; a hint line grows above the roll saying
the preview is cut off, never silently. The stage carries no title,
no live-note readout, and no event log — the tape itself is the
answer; the only permanent stage text is the transport and the
transient status line.

Left column (300px), project-first: session buttons (Start mic / Demo
phrase / New take), then the TAKES list — every saved take is a
PROJECT. Rows are plain text (name + mono duration; no note counts),
clicking a row opens it, the open row renders bold and expands to its
PHRASE LIST (see Phrases below) indented under a hairline; an unsaved
session shows as a bold "unsaved take" row. A ✕ per row deletes
behind a confirm — deletes are SOFT: tombstoned and hidden for 30
days before payloads purge (lazily, on list reads), the status line
says so, and an underlined inline "undo" restores. The save row (name
input + Save) appears once a take exists: a session saved or loaded
stays TIED to its record — "Save" updates in place without
re-uploading audio, the name field renames on save, "Save as new"
forks; the tie clears when the audio genuinely changes (New take,
fresh recording, Demo, Load clip). Saving round-trips the whole song
document (phrases, edits, versions, layout) plus the recording as
lossless WAV, so a loaded take comes back frozen where edited and
re-transcribes identically. Below the list: the key signature select
(the one always-visible setting), then COLLAPSIBLE groups
(details/summary, ▸/▾ markers, closed by default — settings earn
space only when open): DETECTION (the Melody floor slider, value
shown as "230 Hz / A♯3" — a note name, not bare Hz), VIEW (Notation:
Full / Main notes only; Pitch trace: Hidden / Aligned under the tape /
Linear time, with the Trace stretch slider only in Linear), LAYOUT
(the five geometry sliders + hint), and CLIP FILE (Save clip / Load
clip WAV round-trip; a loaded clip opens as its own new take). Status
during a decode: "transcribing… N%", then the line clears — no note
or ornament counts, ever; while the decode runs, the session, clip,
and transport controls disable rather than race it. The mic button
while listening is --red text and border (red rule 5, a live
capture). Right stage: the tape roll with the raw-pitch trace riding
inside it (below, hideable), a transport row (Play/Pause, Stop, a
varispeed select 0.25×–1×, the position readout at hundredths), the
inspector strip, and a bottom row with the status line left and the
print buttons right.

The pitch trace shares the tape's x-axis and scroll: it sits directly
under the paper inside the same roll (hairline separator, --raised
background — instrument panel under paper), one column per tape row, so
the raw pitch that produced a note bar sits directly below that bar at
any scroll position. Ink dots weighted by detector confidence, a thin
--ink-faint line for the committed note, and faint full-width reference
rows at A3/A4/A5 (the duduk-in-A anchors). Like the tape, its x-axis is
sounding time — silence compresses.

The player: Play/Pause and Stop (outline .btn.small) with a mono
"elapsed / total" readout, plus a playhead crossing both the tape and
the trace — a 1.5px DOM overlay spanning the roll (never drawn into the
canvases; the tape canvas holds exact print bytes), --ink-muted while
paused and --red while audio runs (red rule 5; the Play button mirrors
it as a red Pause). The tape is not linear in time (silence compresses
to a breath mark, glyphs occupy timeless rows), so the playhead follows
the renderer's time-to-row timeline: it sweeps steadily through notes
and skips across breath marks, matching the ear. Both panes are the
scrub surface (crosshair cursor, hint right-aligned in the transport
row): dragging pauses and seeks, releasing resumes if it was playing.
While playing the roll auto-scrolls to keep the bar in view.

Editing: once a take is decoded, clicking a note on the tape selects
it — the same click still seeks. The selection is an ink-wash band
(8% ink, hairline --ink-muted edges) over the tape pane only, drawn as
a DOM overlay like the playhead, never into the canvas (exact print
bytes). An inspector strip under the transport shows the selected note
in mono ("A♯4 · 0:00.07–0:02.23") with its actions: Pitch −/+,
Ornament and Slide-from-prev toggles (a pressed toggle inverts to ink
on raised — red stays reserved), Split at playhead (enabled while the
playhead rests inside the note; edits keep the playback position),
Join next, Remove, and Undo (n) / Redo pushed to the right. Before a
selection the strip teaches the affordance ("click a note on the tape
to edit it"); the Main-notes-only view doesn't edit ("switch to Full
notation to edit"). Keyboard: Esc deselects, Cmd/Ctrl-Z and
Shift-Cmd-Z undo/redo, Backspace/Delete removes the selected note.
Every edit re-renders the whole tape from the edited timeline, so the
preview and the print bytes remain the same rows. Freeze-on-edit:
while a take has edits, the Melody floor slider disables with a hint
and a Start over button appears — it re-reads the recording, keeping
the edited tape as a snapshot; undoing every edit unlocks the slider
again. Background re-derivation (the trace backfill finishing) never
replaces an edited timeline.

Phrases: a song splits into phrases at CUTS — timestamps snapped to
note attacks, seeded by "cut into phrases at breaths" (rests ≥ 2× the
Breath gap) in the phrase list, or toggled per note with the
inspector's "Cut before"; a phrase entry's ✕ merges it into its
predecessor. Each phrase is a full take document of its own: its own
melody floor (the Detection group reads "Detection · phrase N" and
edits only the ACTIVE phrase), its own edit log, undo/redo, versions,
and freeze state. A phrase behaves like a standalone clip — detection
never reaches across a cut. The song is the PROJECT and phrases are
its pages, navigated from the PHRASE LIST under the open take in the
left column: "Song — all phrases" plus one mono entry per phrase
("Phrase 2 · 0:05.38–0:09.02", "· edited" when frozen; the selected
entry renders bold ink). "Song" is the overview: every phrase
stitched in time order with a printed CAESURA at each cut (two
parallel strokes slanting up-time above the staff, replacing the
breath comma there) — preview stays identical to print; selecting a
note there activates its phrase in place for the Detection panel and
inspector. A phrase entry opens that phrase's OWN tape: its own roll
exactly as it prints, its own detection settings and undo history,
playback confined to its span (practice mode), and a print button
reading "Print phrase" — "prints exactly as shown" stays true in
every scope. "Print phrases (N)" sits beside Print take in the bottom
row when phrases exist. Sessions and loaded projects open on Song; a
take with no cuts lists no phrase entries, just the cut action.

Print take queues the rendered rows verbatim through /api/tape/print
(source "tape"); the button reads "Queuing…" while in flight and the
status line answers in plain words ("sent to the print queue", never a
raw job id). Jobs carry the take's saved name; a phrase prints as
'name · phrase 2 of 5', and "Print phrases (N)" queues every phrase as
its own standalone receipt (fresh clef and key signature each). The
jobs appear in Queue and History like any other, but carry no
template, so Reprint declines them with a pointer back to the tool.

### Queue
Title "Queue" with "updates every 3 seconds" subtitle; job count right (mono).
Job CARDS: receipt thumbnail (110x74 phone / 158x108 desktop), name +
"source · created HH:MM:SS" sub,
status mono ("printing" --red / "queued" --ink-muted), rail = a Cancel
button for a queued job, or "claimed Ns" plus a Requeue button for an
inflight one (Requeue sends a stuck claim back to queued, from where it
prints again or can be canceled). The list re-fetches `/api/queue` every
3s in React, only while the tab is visible.

### History
Title + "N jobs · newest first"; filter control right (dotted-underline
value). One list container; list rows (receipt thumbnail, name, source)
with status·time in the rail ("failed" --red). Row click expands (chevron)
an inset panel:
--page bg, indented past the thumbnail (padding-left 162px), three columns:
PRINTED (the receipt PNG at 200px), TEMPLATE (name + truncated source,
mono 11.5px --ink-muted) and DATA (the JSON), plus a Reprint button
(re-renders from stored template+data; never resends old bytes). Pagination centered below: "← newer  1 / N
older →", 12px.

### Login
Same paper page, centered small card: DOCKET wordmark, password field,
one outline button "Sign in". There is nothing else on the page.

## Voice

Sentence case everywhere except the wordmark and 11px section labels.
No exclamation marks, no em dashes, no jargon or file paths in page copy.
Errors say what happened + age ("calendar 401 · 2d ago"). Empty states are
short and plain ("No jobs waiting.", "Nothing printed yet.").
