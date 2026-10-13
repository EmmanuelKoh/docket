# Docket: dashboard design spec

The source of truth for building the dashboard UI. It describes what is
built. Update it in the same change as the UI.

## Identity

Two-color register ribbon: everything is one neutral gray ramp (monochrome),
plus a single deep "register red" used only where an old receipt printer would
ink red: attention and motion. Paper-flat, hairline rules, no blurred
shadows, no gradients, square corners. The chrome borrows from the machine
(July 2026 "material" pass, first proven on the Tape studio and then
applied app-wide): committing actions are solid ink, workbench actions are
raised keys with a hard second-strike edge (see Components).

Name/wordmark: DOCKET, mono font, 14px, weight 500, letter-spacing 0.14em
(the wordmark is the one letterspaced thing in the product).

## Fonts (standalone stacks, no external dependencies required)

ONE typeface: the receipt mono carries the entire app. --font-sans keeps
its NAME (so utilities don't churn) but its VALUE is the mono stack:

--font-sans: ui-monospace, "SF Mono", Menlo, Consolas, monospace
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace

Weights: 400, 500/600 for emphasis, 700 for knockout buttons and banners.
NO uppercase, NO letter-spacing in page copy (the wordmark, the REC
banner, typed codes, stamps and the barcode id excepted): section labels are 13px --ink at semibold weight, so
hierarchy comes from weight alone.

Icons: lucide-react, outline style, colored --ink-faint.

## Color tokens: light ("paper") and dark ("darkroom")

| Token          | Light    | Dark     | Use                                    |
|----------------|----------|----------|----------------------------------------|
| --page         | #fbfbfa  | #161615  | page background                        |
| --raised       | #ffffff  | #1c1c1a  | cards, stat strip, list containers     |
| --hairline     | #eaeae8  | #2e2d2b  | inner row separators                   |
| --border       | #dcdcda  | #2e2d2b  | card/container borders (0.5px)         |
| --dash         | #c6c6c3  | #3d3c39  | dashed and perforated dividers         |
| --ink          | #161616  | #e8e6e1  | primary text, heavy rule, on-toggle    |
| --ink-muted    | #6d6d6a  | #8f8d87  | secondary text                         |
| --ink-faint    | #9b9b97  | #6b6963  | hints, icons, quiet rails              |
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
Toggle: moon icon (light) / sun icon (dark) in the header; the choice
persists in localStorage.

### Red usage rules (strict)

Red appears ONLY as: (1) the active nav mark (the sidebar's left bar, the
underline in tab rows), (2) job status "printing" / inflight, (3) failures
and error text, (4) queue count when nonzero, (5) live audio actually
running (the Tape tool's mic button while listening, its Pause button and
playhead while a clip plays: hardware or transport actively running, the
same family as "printing"), (6) the Tape tool's selection halo, the one
contour tracing the glyph being edited (only one glyph is selected at a
time).
Everything else is gray. Enabled/on states are INK, not red (a working
plugin is normal, not an alert). Success/"done" is --ink-muted text.
Green is not used anywhere.

## Spacing system

- Content column: max 1120px, centered, with 48px side padding inside it
  (16px on phones). On wide screens the space outside the column grows.
  The Studio (/studio) and the Tape tool (/tape) are full-bleed
  workbenches with 24px side padding (16px on phones).
- Phones (below 640px): gutters drop to 16px, the stat strip becomes a
  2×2 grid, list rows move their status and actions under the row's text,
  History's expanded record stacks its columns without the indent, and
  thumbnails shrink one step (96x64 rows / 110x74 queue). Below 768px the
  sidebar becomes a sheet. The Photo tool goes single column at 720px and
  below. Same components with denser wrapping, not a separate mobile
  design.
- Header: a slim full-width row, 12px vertical and 16px horizontal
  padding; bottom rule 1.5px solid --ink, full-bleed.
- Sidebar items are 14px; tab rows are 12px (the Studio's Template/Data
  tabs) or 13px (the Photo tool's phone dock). The active item gets --ink text and
  a 1.5px --red mark: a bar on the item's left edge in the sidebar, an
  underline in tab rows. Everything else is --ink-muted or --ink-faint.
- Major blocks: 20px apart. Section title block: 16px/500 title, 12px
  --ink-muted subtitle 2px below.
- Cards: --raised bg, 0.5px --border, square, 16px padding.
- Inline-editable values: 1px dotted --ink-faint underline, --ink on
  focus.
- List containers: one --raised box, square; rows inside at 16px 20px
  with 0.5px --hairline separators (no per-row cards).
- Rows: 24px column gap (16px on phones), 16px 20px padding. The row's
  FIRST LINE is the LEDGER LINE: name, leader dots, and the rail meta
  (status · time, and any row action) share ONE baseline flex. The leader
  runs into the rail, actions baseline-align by their label text, and
  everything flushes right so timestamps rail-align down the page by
  their right edge (mono 12px, never wraps; "canceled · 33m" is the
  sizing case). Rows with a thumbnail TOP-ALIGN all content to the media
  (text centered against tall media floats in dead space); only
  single-line rows center vertically.
- Labels: 13px, --ink, semibold, no letter-spacing (the old 11px caps
  idiom is retired everywhere).
- Body 13px; meta/sub 12px; stat numbers 28px mono.
- PERFORATION divider between major page zones: a 1px dotted tear-off
  rule (5px dash / 6px gap of --dash, the .perf utility), inside the
  gutters.
- LEDGER LEADERS in list rows: a run of round --ink-muted dots on a 7px
  rhythm fills the space between a row's truncating name and its rail
  (name……………status · time, the .leader utility). Queue cards, History
  rows, the Overview Recent list, the Printer and Users ledgers, and the
  Tape takes list all speak it.

## Components

Buttons carry ONE of three materials by rank, never a bare outlined
rectangle. The shadcn Button primitive (`components/ui/button.tsx`)
carries them, mono 13px and square; the Photo and Tape tools carry the
same materials in their own `.btn` CSS.

- COMMITTING actions (variant default) are KNOCKOUT BLOCKS: solid ink,
  --raised text, 700 weight, the heavy bite (below). Hover DOUBLE-STRIKES
  (a 0.6px text-shadow thickens the strokes, the platen hitting twice);
  press nudges down 1px. Committing actions per page: Sign in, Create
  account, Pair, New invite, Print test, the Studio's Save and Print, the
  Photo tool's Take a photo and Print, and the Tape tool's Record/Stop,
  Save take and Print take.
- WORKBENCH actions (variant outline) are REGISTER KEYS: raised fill, 1px
  ink edge, and a hard unblurred 2px offset edge that is a SECOND STRIKE,
  not a shadow. It is always ink, in both themes (in dark it prints light
  against the page, a misregistered double impression, deliberately
  visible). Hover lifts the key (3px offset, -1px translate), press sinks
  it flat (2px translate, no offset). Examples: Share, Revoke, Leave, Copy
  link, slip Save and Delete, Reprint, the Studio's New and Delete.
- HOUSEKEEPING is quiet lowercase text buttons: Queue's cancel and
  requeue (underlined), the Printer page's remove, the Queue's refresh.
  (The primitive's link variant is the same idiom.)
- The red knockout (variant destructive) is reserved for failures and
  truly destructive commits; no page uses it today.
- DISABLED is UNPRINTED on every variant: transparent fill, --ink-faint
  text, a 1px dashed --border placeholder. No material at all.

The BITE: solid-ink surfaces carry a whisper of print texture, a CSS
mask of tail-thresholded fractal-noise layers multiplied together (sparse
speckle, an occasional splatter clump, and micro dust so fine it lands at
half a pixel; the texture is authored at 480px and displayed at 240px to
push the dust sub-pixel). Two weights: BUTTONS take the heavy bite
(.bite-heavy, picked by eye on the live slider specimen: tails 9/8/6
zeros per 48 vs the light 8/8/7, plus a FOURTH mid-dust layer at
baseFrequency 0.3 with a 9-zero tail that widens the dust's size range;
big splatter stays unchanged because bigger blobs read as damage, not
grain, at button size); banners, stamps, and other solid surfaces keep
the light three-layer bite (.bite, 8/8/7, ~1-2%) so the ink reads solid
at a glance. Holes are always full paper-white, never faded gray, and
never touch body text, keys, or the paper itself. (Band thresholds are
forbidden: cutting a band out of smooth noise yields hollow rings, not
clumps.) The shared accents live in globals.css: --key-shadow, .bite,
.bite-heavy, .stamp, .stamp-red, .barcode, .perf and .leader.

PRINT VOCABULARY in the flow pages: Queue rows' cancel/requeue are quiet
lowercase LEDGER ACTIONS in the rail, so buttons never invade lists.
History's expanded record carries a rotated, ink-starved RUBBER STAMP on
the receipt naming how the job ended (PRINTED or CANCELED in ink, FAILED
in red; paper-fixed colors, never theme ink, because stamps sit on the
always-white paper) and signs off with the job id as a false BARCODE
bottom-right. No end-of-roll stripes, by decision.

Toggle: 34x20 pill, 16px knob inset 2px. On: --ink fill, knob --page.
Off: --border fill, knob --raised.

Status chip (plugins only): 11px lowercase ("enabled" / "off"), 2px 8px
padding, 0.5px --border, 4px corners. enabled = --ink-muted text; off =
--ink-faint. On a slip card the chip sits on the white paper: 10px, a
white chip with paper-fixed grays.
Job statuses are plain mono text, not chips: "printing" and "failed" in
--red, "queued" and "done" in --ink-muted, "canceled" in --ink-faint.

Thumbnails (real job/template preview PNGs): landscape to match the
artifact (receipts are wider than tall). 130x86 in list rows, 158x108 in
queue cards; 0.5px --border, object-fit contain. Background is always
#fff in BOTH themes: receipts are paper, and a theme background would
letterbox dark bars around them in darkroom mode. Thumbnails are for
recognizing a job; the History expand shows the receipt at reading size.

Segmented control (.seg, Photo tool): a bordered, square strip of flush
buttons; the active option is inverse mono (--ink background, --page
text), the same idiom as a toggle that's on, never red.

## Shell

The app is a Next.js React app with a left sidebar (there is no top nav).
The identity, tokens, red rules, spacing, and components above apply
throughout. Shell rules:

- Sidebar: DOCKET wordmark at top (links home), then Overview, Slips,
  Photo, Tape, Queue, History, Printer, and Users for admins. Collapsible
  to an icon rail; below 768px it becomes a sheet. Items are 14px
  --ink-muted with 16px outline icons in --ink-faint. Active item:
  --ink medium text, --hairline fill, and a 1.5px --red bar at the item's
  left edge.
- The Queue item carries a mono count badge, --red, shown only when
  nonzero. It never holds up a page: the shell renders without it and
  the count fills in a moment later.
- Header: the sidebar trigger left; theme toggle and sign-out icon right.
- Content column per the spacing system.
- Loading: while a page's data loads, the sidebar and header stay and the
  content column shows a skeleton of the common page grammar: a title
  block (a 16px bar over a 12px bar), then one list container (--raised,
  0.5px --border) of three rows split by 0.5px --hairline, each row a
  thumbnail frame at list-row size (0.5px --border on --page), a name
  bar, a rail bar right (from 640px up) and a shorter sub bar below. Bars
  are flat --hairline blocks, square like everything else; no red, no
  text but a screen-reader "Loading". The blocks pulse slowly in opacity,
  and hold still for reduced-motion users.
- Theme: data-theme on <html>, persisted under the localStorage key
  docket-theme, with a no-flash bootstrap so the first paint matches.
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
1. Latest print card: "Latest print" label, then the newest finished
   job's receipt at the paper width on white, with its name (mono 13px),
   "source · status 3m ago" (12px --ink-muted) and a "view in history →"
   link beside it (below it on phones). With no prints: "Nothing printed
   yet."
2. Stat strip: ONE bordered container split into 4 cells by 0.5px
   --hairline verticals (not separate cards). Cell: label / 28px mono
   number (8px below the label) / 12px --ink-muted sub (6px below).
   Templates ("in the store"), Plugins (enabled, "of N registered"), Queue
   ("N printing · N queued" or "nothing waiting"; the number is --red
   when > 0), Last print (its age; the job's name below).
3. System line (plain text row, 12px --ink-muted, 24px gaps): printer
   online dot (6px circle, --ink when seen within 90 seconds, else
   --ink-faint) + "printer seen 3m ago" or "no printer contact yet";
   version right-aligned in --ink-faint. A member of a shared printer sees
   that printer's contact. No infra internals (store driver, tick
   interval): those are operator diagnostics, not user copy.
4. Perforation divider.
5. Recent: label + "view all →" link; the 3 newest history rows
   (thumbnail, name mono, source, status · time in the rail). These are
   History's records: the three newest, read the same way.

### Slips
Everything the printer can produce, grouped by category. One page that
replaces the earlier Templates and Plugins pages.

Index: title block ("N slips · open one to configure, preview, and
print") with "New template" right: a small link chip (0.5px --border,
--raised fill, 12px text, --ink-faint border on hover) that opens the
Studio blank. Category groups (13px semibold label + mono count pill +
hairline rule), then a grid of cards each fixed at the receipt-paper width
(full width when the column is narrower). Card: the full rendered receipt
on white at the paper width over a dashed bottom edge, with the
enabled/off chip overlaid top-left on system slips only; a mono name
with a corner arrow; a two-line description; and a footer ("N
templates", right-aligned, 11px mono --ink-faint). No kind or engine
chips: "system"/"liquid" are internal vocabulary, not user copy. No Open
button: the card IS the button, its border shifting to --ink-faint on
hover.

Slip page: "← slips" breadcrumb, mono title + description. A template slip
has a two-step Delete right of the title (outline "Delete", then "Keep" /
"Really delete"; neutral, since the red rules forbid a red button here).
Delete refuses a template a system slip or the Photo tool prints with, and
the refusal shows in red beside the buttons ("This template is used by
Photo"). Below, two columns from 1024px up (stacked below): left, the
Preview card (the primary template rendered on white at the paper width)
with Print test and its mono status beside it; right, for a system slip,
a status row (enable toggle, enabled/off chip, right-aligned last-run in
mono, --red when it is an error like "calendar 401 · 2d ago") and the
Parameters card. A template slip shows a "Template" card instead, with
"Open in Studio →".

Parameters card (the per-field config grammar): a 110px column of 13px
semibold labels (lowercase field names) beside the values. Schedule row
first, then a read-only "next run" line, then one dotted-underline mono
input per config key, derived from the config's shape. Arrays edit as
one-item-per-line textareas (commas also accepted); numbers and booleans
are validated (types come from the plugin's defaults.config); long values
wrap at full width and never overflow. Template names last. The schedule
row's shape is fixed by the plugin: "every [N]s" for watchers, "at
[HH:MM] [timezone]" for fixed-time plugins; a plugin with no schedule
(message-ingest) shows no schedule row, and "next run" reads "on
message". There is never a raw-JSON blob input. Edits persist only via one
explicit Save (an outline key, right-aligned under the grid), which also
recomputes the next-due time; there is no save-on-change. The enable
toggle is immediate (the click is the action) and recomputes the due time
itself. Invalid input shows a red line under the grid and nothing is
saved. A disabled slip dims its Parameters card to 70% opacity, and "next
run" shows a dash.

Below the two columns: Templates rows (each "Open in Studio →"), and for a
system slip the State card (its stored state JSON).

### Studio
Full-bleed workbench at /studio (the sidebar collapses on entry, a
breadcrumb returns to where you came from). Toolbar card (template select
mono, New / Save / Delete, Print right with the shortcut hint), then
editors (Template / Data tabs with the red active underline,
syntax-highlighted source over the mono editor, JSON error line in
--red) beside the stage (status dot + mono size line, the receipt
preview, Recent jobs strip). The strip refreshes on the Queue's cadence
(every 3s while you are active, every 30s after two idle minutes, paused
after thirty, never in a hidden tab); any pointer or key interaction
resumes it, so it shows no cadence line of its own. Toasts are a small
centered raised chip. Delete refuses a template a system slip or the
Photo tool prints with; the toast names it ("This template is used by
Photo"). Keyboard: Cmd/Ctrl+S save, +P print.

### Photo
A print tool, not a registry plugin (no run()/toggle, user-initiated).
Title block ("Print a photo on receipt paper."), then one card split
make/result: the left column shapes the print, the right column IS the
print (slip preview with the Print button and mono status centered
directly beneath it, so the commit action lives with the result). Its
engine (`components/photo-engine.js`) is carried over verbatim.

Left column (400px): dashed dropzone (1px dashed --dash, choose-or-drop;
slims to a one-line row once a photo exists so the editor becomes the
hero), then a full-width "Take a photo" button. Phones open the native
camera via the file input's capture hint or the in-page camera below; the
button opens an in-page viewfinder on desktops AND phones (phones use the
rear camera, unmirrored, since selfie cams mirror) that shares the
editor's stage. The viewfinder is LIVE DITHERED: a Web Worker runs the
print pipeline's serpentine dither on each camera frame (mirrored, paced
to the camera's ~30fps, and shown smooth-scaled at the print's 576-dot
width so it reads as the same texture as the render), so framing already
looks like the print. In camera mode the viewfinder takes the whole stage
(the dropzone and preview hide), with a camera-app shutter below: a 44px
--ink ring whose inner disc grows on hover, centered, and a quiet mono
"cancel" right-aligned. Capturing grabs the full-resolution raw frame
(mirrored to match), but the editor then WEARS IT DITHERED: the crop
canvas displays a worker-dithered skin of the capture while the color
original stays the hidden edit source underneath, keeping crops sharp and
tone/calibration working on real grays, so nothing color ever shows for a
camera capture.

Then the editor (appears once a photo loads): the source image on a
bordered canvas with a draggable/resizable crop rectangle (white border +
corner handles over a 55% dim outside the crop), preset shortcuts Full /
1:1 / 4:3 / 3:2 (ratios follow the image's orientation; presets only set
the rectangle, which stays adjustable) and a Rotate 90° button. Below
that an Adjustments section, collapsed by default behind a header row
(13px label, a quiet mono "adjusted" note when anything is non-default,
▸/▾ chevron in --ink-faint, dashed top rule). Expanded it holds: a Levels
row (label, a small mono "auto" chip, inverse ink while on, and a mono
"black · white" readout), a 40px monochrome histogram of the cropped
photo with clipped tones dimmed, a hairline track with two 10px square
handles (black filled, white outlined) dragged to set black/white points,
then Midtone, Shadows, Brightness, Contrast and Sharpen rows: label,
hairline-track slider with a 10px square --ink thumb, mono value right.
Auto recomputes the points on every crop/rotate; dragging a handle turns
it off; double-clicking a label resets that control. Adjustments show in
the live render only. The edit canvas keeps the untouched photo (tone ops
compose into one lookup table, sharpening is an unsharp-mask pass, and
the calibration curve still runs last). Then the Caption label + dotted
editable input (mono output) with segmented controls for size (S/M/L =
28/36/48px) and weight (Regular/Bold). Take a photo and Print are
knockouts; the other buttons are register keys.

Right: the live preview on white paper (the real /preview render of the
full-bleed "Photo Print" template: borderless 576px photo, optional mono
caption below). Photos downscale client-side before upload; every edit
re-derives the print image, so what you see is the dithered print, not an
approximation.

At 720px and below (phones are the primary use case) the loaded state
becomes an iPhone-style editor, nothing sticky, 20px air between zones,
top to bottom: the slip preview (roll full width, capped 60vh, taller
slips scroll inside), one tool panel in a fixed-height (~96px, centered)
zone so nothing jumps when switching, a horizontally scrollable tool row
(Photo · Crop · Levels · Midtone · Shadows · Brightness · Contrast ·
Sharpen) styled like a tab row (quiet --ink-muted text, active tool --ink
with the 1.5px --red underline; it IS nav, between tools; it replaces the
desktop-only Adjustments collapse), then the Caption field (always
visible: it's content, not a tool), and a full-width Print at the bottom
with mono status above it. The Crop tool hides the roll so the crop canvas
takes the stage; every other tool shows the preview. The empty state stays
a simple stack: dropzone, Take a photo, empty preview.

### Tape

Full-bleed workbench at /tape (sidebar collapses on entry, like the
Studio). The page commits to ONE of three MODES and shows only that
mode's controls; no state ever renders another state's chrome grayed
out. EMPTY (nothing on deck): the session buttons (Record / Load audio)
sit at the top of the controls column, the SAME place they hold in loaded
mode, so they never move between states, followed by the takes list and
nothing else; the bare paper shrinks to a short strip carrying a BOLD
KNOCKOUT BAR (fixed ink-on-paper: #1a1a1a bar, white 700 type, the bite
like every knockout) reading "nothing on tape yet", with a pointer to
Record, a saved take, or the demo phrase, which is underlined and
clickable inside it. RECORDING: the paper hides entirely (the tape is only
ever written by the real transcription, never sketched) and the raw pitch
trace becomes the screen, full height (320px) in linear time,
auto-following; above it the red REC banner, below it one big Stop and a
quiet lowercase "discard" (the false-start escape: stop without
transcribing). A screen wake lock (best-effort) keeps a phone's display,
and its mic stream, alive through a take. LOADED: the full bench described
below. The roll keeps its place in every mode; only the controls around
it change.
Notation glyphs (treble clef, key signature, accidentals, breath commas)
are engraved shapes rasterized from Bravura (SIL OFL), sized to the staff;
the take opens with bare paper, then the clef and key signature before
the first note. The canvases track the roll's width via a ResizeObserver
(the app sidebar collapses after mount) and stay mounted across modes
(CSS hides them; the controller holds their refs). Monophonic
transcription: while the mic is live, only the raw pitch trace draws
(live notation was deliberately dropped: the sketch was discarded on Stop
anyway, and live guesses that differ from the final tape make the tape
harder to trust); when the
take ends (Stop or Load audio) the recording is transcribed by a neural
model (Basic Pitch, bundled, in-browser) and decoded into main notes,
rearticulation splits, slide connectors (a thin diagonal between pitches;
a dip scoop for a same-pitch slide), and ornament marks (a small
backwards "c", a procedurally drawn arc opening toward the earlier tape,
above the staff at the attack of every ornamented main note). Ornaments
never render as small notes on the staff; the arc is painted OVER the
preceding tape rather than inserting rows, so main notes stay close
together. The preview canvas shows the exact raster rows the printer would
receive, in reading orientation (staff horizontal, time flowing left to
right, new tape entering at the right; the strip auto-follows unless the
user scrolls back). The tape sits on white in both themes; receipts are
paper. A take past the preview's width cap (~14 minutes of sounding tape)
keeps printing whole; a hint line grows above the roll saying the preview
is cut off, never silently. The stage carries no title, no live-note
readout, and no event log; the only permanent stage text is the
transport and the transient status line.

Tape material and type (scoped to this page, on top of the app-wide
materials in Components): ONE typeface, the receipt mono, at TWO sizes
(13px words, 12px asides) and TWO colors (--ink, --ink-muted); no
uppercase, no letter-spacing, section titles differ by weight (700)
alone. Committing actions here are Record/Stop, Save take and Print take
(knockouts). Workbench actions (transport, inspector verbs, Load audio,
Save as new, Print phrases) are register keys; a toggle held ON
(Ornament, Slide) is a key sunk in ink fill with no travel. Housekeeping
stays lowercase underlined text (discard, download take). Live capture
red per the red rules: Stop while recording is the red knockout, Play
while audio runs a red-edged key. Record carries a round LAMP (outline
circle idle, filled red with a slow blink while live). Sections separate
with dotted PERFORATION rules (5px dash / 6px gap hairlines) in both
columns; the takes list draws LEDGER LEADERS (name……………duration) like
receipt line items; the roll is framed as a receipt strip: a square
hairline frame with a TORN sawtooth right edge (card-color triangles over
the paper). Sliders are FADERS: 1px track, 7×15px square ink thumb. Lucide
icons where a symbol is universal, sized 13-16px so they read at arm's
length: icon-only Play/Pause/Stop transport, chevron pitch nudges and note
walk, scissors on Cut before, trash for Remove, curved Undo/Redo arrows
(tooltips carry shortcuts), printer glyph on print buttons. Domain actions
(Ornament, Slide from prev, Split at playhead, Join next) stay as words.
The one BOLD element (borrowed from the plugin receipts' FULL TIME
knockout bar): the TAKE BANNER over the roll, an inverted ink bar with
centered 15px/700 knockout type naming the open take ("unsaved take · 2
phrases", or "name · phrase 2 of 3" in focus). While the mic is live it
turns --red with a blinking white lamp and a running counter ("● REC
0:12.4"), the loudest red on the page, used only while the mic records. The
transport readout is a quiet one-line unit that never wraps: elapsed in
the ordinary mono value size, " / duration" a shade fainter
(--ink-faint). The REC banner already carries the loud counter, so the
transport doesn't.

Left column (300px, loaded mode; the empty page shows only the takes
list here), project-first: session buttons (Record / Load audio, two
equal halves filling the column edge to edge; both start a NEW take;
there is no separate New-take button, Record always resets, and the demo
phrase is NOT a main button; it lives in the empty note's bar on the
paper), then the TAKES list. Every saved take is a PROJECT. Rows are plain
text (name + mono duration; no note counts), clicking a row opens it, the
open row renders bold and expands to its PHRASE LIST (see Phrases below)
indented under a hairline; an unsaved session shows as a bold "unsaved
take" row. A ✕ per row deletes behind a confirm. Deletes are SOFT:
tombstoned and hidden for 30 days before payloads purge (on list loads),
the status line says so, and an underlined inline "undo" restores. The
save row (name input + Save) appears once a take exists: a session saved
or loaded stays TIED to its record. "Save" updates in place without
re-uploading audio, the name field renames on save, "Save as new" forks;
the tie clears when the audio genuinely changes (fresh recording, Demo,
Load audio, discard). Under the save row, a quiet lowercase "download
take (wav)" writes the audio to the user's machine, named after the take:
a download, deliberately not called saving. Saving round-trips the whole
song document (phrases, edits, versions, layout) plus the recording as
lossless WAV, so a loaded take comes back frozen where edited and
re-transcribes identically. Below the list: the KEY picker (the one
always-visible setting), a system select (Western: major / minor, or
Mugham: Rast, Shur, Segah…). Western lists every signature named with its
relative minor ("G major / E minor · 1♯"). Mugham offers the seven
principal modes (Rast, Shur, Segah, Shushtar, Chahargah, Bayati-Shiraz,
Humayun) on a chosen tonic; each pick derives the best-fit printed
signature (most shared pitches, ties to fewer accidentals then flats) and
a hint states it plainly ("Segah on A: prints as F major / D minor ·
1♭"). Neutral quarter-tone degrees round to the nearest semitone for now,
so the paper shows plain accidentals and the player adds the intonation;
the interval rows are data in tape-renderer.js (MUGHAM_MODES), correctable
one line per mode. Then COLLAPSIBLE groups (details/summary, ▸/▾ markers,
closed by default): DETECTION (the
Melody floor slider, value shown as "230 Hz / A♯3", a note name, not bare
Hz), VIEW (Notation: Full / Main notes only; Pitch trace: Hidden /
Aligned under the tape / Linear time, with the Trace stretch slider only
in Linear), LAYOUT (the five geometry sliders + hint). There is no
Clip-file group: loading lives in the session buttons and the entry panel
(a loaded file opens as its own new take), downloading in the Takes
group. Status during a decode: "transcribing… N%", then the line clears;
no note or ornament counts, ever. While the decode runs, the session,
clip, and transport controls disable rather than race it. The mic button
while listening is --red text and border (red rule 5, a live capture).
Right stage: the tape roll with the raw-pitch trace riding inside it
(below, hideable), a transport row (Play/Pause, Stop, a varispeed select
0.25×-1×, the position readout at hundredths), the inspector strip, and a
bottom row with the status line left and the print buttons right.

The pitch trace shares the tape's x-axis and scroll: it sits directly
under the paper inside the same roll (hairline separator, --raised
background: an instrument panel under paper), one column per tape row, so
the raw pitch that produced a note bar sits directly below that bar at
any scroll position. Ink dots weighted by detector confidence, a thin
--ink-faint line for the committed note, and faint full-width reference
rows at A3/A4/A5 (the duduk-in-A anchors). Like the tape, its x-axis is
sounding time: silence compresses.

The player: Play/Pause and Stop (small register keys) with a mono
"elapsed / total" readout, plus a playhead crossing both the tape and
the trace: a 1.5px DOM overlay spanning the roll (never drawn into the
canvases; the tape canvas holds exact print bytes), --ink-muted while
paused and --red while audio runs (red rule 5; the Play button mirrors
it as a red Pause). The tape is not linear in time (silence compresses
to a breath mark, glyphs occupy timeless rows), so the playhead follows
the renderer's time-to-row timeline: it sweeps steadily through notes
and skips across breath marks, matching the ear. Both panes are the
scrub surface (crosshair cursor, hint right-aligned in the transport
row): a mouse drag pauses and seeks, releasing resumes if it was
playing. TOUCH is different: a phone has no scrollbar, so the drag
gesture belongs to navigation. Touch drags PAN the roll natively
(touch-action: pan-x) and only a TAP seeks (and selects, with a
~24px slack toward the nearest note; note bars can be 2px wide).
The transport hint speaks the device's input language: keyboard
shortcuts on fine pointers, "tap the tape to seek · tap a note to
edit" on coarse ones.
While playing the roll auto-scrolls to keep the bar in view.

Editing: once a take is decoded, clicking a note on the tape selects
it; the same click still seeks. The selection is a register-red contour
TRACING the selected glyph's exact shape, its inner edge flush against
the ink (no air, no rounding the shape doesn't have): a sharp rectangle on
a note's bar (2.25px --red stroke), and on an ornament arc the true
crescent outline (1.5px; the finer glyph takes the finer line), derived by
dilating the arc's reconstructed ink; red rule 6. It is painted over the
preview repaint only, never into the offscreen print bytes, so exports
and prints stay pristine. An inspector strip under the transport shows the
selected note in mono ("A♯4 · 0:00.07–0:02.23") with its actions:
prev/next note chevrons at the left (the buttons for the ←/→ walk, the
only edit verb that had no touch path), Pitch −/+, Ornament and
Slide-from-prev toggles (a pressed toggle inverts to ink on raised; red
stays reserved), Split at playhead (enabled while the playhead rests
inside the note; edits keep the playback position), Join next, Remove,
and Undo (n) / Redo pushed to the right. Before a selection the strip
teaches the affordance ("pick a note on the tape to edit it"); the
Main-notes-only view doesn't edit ("switch to Full notation to edit").
Ornament arcs are selectable too, BOTH kinds identically, so no arc ever
behaves differently: standalone time-anchored marks and the arc a note's
own Ornament flag draws. An arc's little box hit-tests on both axes and
wins over the note band under it; selecting one shows a reduced strip
("ornament · 0:01.42") with only Remove, a normal undoable edit (removing
a flag arc toggles the owner note's ornament off). Keyboard
(YouTube-spirited; skipped while a form control has focus): space
play/pause, ⇧< / ⇧> seek ±5s (also on the transport as deck ◀◀/▶▶
buttons), ←/→ walk the notes (auto-scrolling the selection into view),
↑/↓ nudge the selected note's pitch, 1-9 open a phrase and 0 the Song
overview, O toggles the ornament, J joins next, S splits at the playhead,
C cuts a phrase before the note, Esc deselects, Cmd/Ctrl-Z and
Shift-Cmd-Z undo/redo, Backspace/Delete removes the selected note; button
tooltips carry their keys, and the transport hint line lists the core
set.
Every edit re-renders the whole tape from the edited timeline, so the
preview and the print bytes remain the same rows, and the roll keeps its
scroll position (re-renders never yank the viewport; only live recording
follows the paper). Freeze-on-edit: while a take has edits, the Melody
floor slider disables with a hint and a Start over button appears; it
re-reads the recording, keeping the edited tape as a snapshot; undoing
every edit unlocks the slider again. Background re-derivation (the trace
backfill finishing) never replaces an edited timeline.

Phrases: a song splits into phrases at CUTS, timestamps snapped to note
attacks, seeded by "cut into phrases at breaths" (rests ≥ 2× the Breath
gap) in the phrase list, or toggled per note with the inspector's "Cut
before"; a phrase entry's ✕ merges it into its predecessor. Cutting and
merging PARTITION the tape as it stands: the visible timeline, edits
included, is sliced (or concatenated) unchanged; a cut only adds the
caesura. Halves of an edited phrase keep those edits baked in and stay
frozen (slider locked, "· edited" chip) until an explicit Start over; the
undo history itself resets at the cut, with the pre-cut state kept as a
snapshot. Each phrase is a full take document of its own: its own melody
floor (the Detection group reads "Detection · phrase N" and edits only the
ACTIVE phrase), its own edit log, undo/redo, versions, and freeze state. A
phrase re-derives as a standalone clip (boundary rules stopping at the
cut) only on Start over or a floor change. The song is the PROJECT and
phrases are its pages, navigated from the PHRASE LIST under the open take
in the left column: "Song: all phrases" plus one mono entry per phrase
("Phrase 2 · 0:05.38–0:09.02", "· edited" when frozen; the selected entry
renders bold ink). "Song" is the overview: every phrase stitched in time
order with a printed CAESURA at each cut (two parallel strokes slanting
up-time above the staff, replacing the breath comma there); the preview
stays identical to print; selecting a note there activates its phrase in
place for the Detection panel and inspector. A phrase entry opens that
phrase's OWN tape: its own roll exactly as it prints, its own detection
settings and undo history, playback confined to its span (practice mode),
and a print button reading "Print phrase", so "prints exactly as shown"
stays true in every scope. "Print phrases (N)" sits beside Print take in
the bottom row when phrases exist. Sessions and loaded projects open on
Song; a take with no cuts lists no phrase entries, just the cut action.

Print take queues the rendered rows verbatim through /api/tape/print
(source "tape"); the button reads "Queuing…" while in flight and the
status line answers in plain words ("sent to the print queue", never a
raw job id). Jobs carry the take's saved name; a phrase prints as
'name · phrase 2 of 5', and "Print phrases (N)" queues every phrase as
its own standalone receipt (fresh clef and key signature each). The
jobs appear in Queue and History like any other, but they are raw
jobs (kind "raw": bytes, no template), so History shows no Reprint
button for them; print again from the tool.

Small screens and touch. At 900px and below the columns stack with the
STAGE FIRST (banner, roll, transport, inspector, print) and the project
column after; the phone is the recorder, and the empty and recording
modes each fit a single screen. Coarse pointers (@media pointer: coarse)
get finger-sized targets: taller buttons, selects, and list rows, and a
13×29px fader thumb; same layout, more air. The page pads its bottom with
the safe-area inset. The transport wraps rather than overflows; the
keyboard hint swaps for the touch hint (see the scrub paragraph above).
Everything else (modes, entry panel, the full-height recording trace) is
the same design on every width.

### Queue
Title "Queue" with "What prints next." subtitle; job count right (mono,
as of page load). Above the list, a right-aligned 12px --ink-faint status
line: mono cadence text ("updates every 3s" while active, "updates every
30s" after two idle minutes, "paused" after thirty) plus a quiet lowercase
"refresh" text button (hover to ink) that re-fetches immediately and
resumes the fast cadence; any pointer or key interaction also resumes it.
Job CARDS: receipt thumbnail (110x74 phone / 158x108 desktop), the ledger
line (name mono, leader, then the rail: status mono, "printing" --red or
"queued" --ink-muted; for a printing job "started 12s ago" in --ink-faint
and a "requeue" ledger action; for a waiting job a "cancel" ledger
action), and a sub line "source · created HH:MM:SS", which ends in "· N
failed attempts" ("1 failed attempt" singular) once a printer has handed
the job back. Requeue sends a stuck claim back to the queue, from where it
prints again or can be canceled. On phones the status and the action move
under the sub line. The list is the print order: jobs a printer holds
first, then waiting jobs oldest first. From a job's third failed attempt
on, each failure sends it to the back: it lists behind every job queued
before that failure and ahead of any queued since, which is where it will
print. The list re-fetches `/api/queue` at the cadence the status line
shows, only while the tab is visible. Empty: "No jobs waiting."

### History
Title + "N jobs · newest first"; filter links right (all / done / failed
/ canceled; the active one --ink with a dotted underline). One list
container; list rows (receipt thumbnail, name, source, plus "· N failed
attempts" when a printer handed the job back before it ended) with
status · time in the rail ("failed" --red, "canceled" --ink-faint). Row
click expands (chevron) an inset panel: --page bg, indented past the
thumbnail (padding-left 162px; no indent on phones), three columns headed
"Printed", "Template" and "Data": the receipt PNG at 200px stamped
PRINTED, CANCELED or FAILED by the job's status; the template source,
clipped (mono 11.5px --ink-muted); the data JSON, clipped. Below them a
Reprint key (re-renders from the stored template and data; never resends
old bytes) with its mono status, and the job id as a barcode at the right
(from 640px up). Raw jobs (Tape prints: bytes rendered by the tool, no
template) show no Reprint button. 20 rows per page; pagination centered
below: "← newer  1 / N  older →", 12px. Empty: "Nothing here yet."

### Login
Same paper page, centered small card: DOCKET wordmark, then the account
form (email field, password field, one full-width knockout "Sign in"
button). Errors are 12px --red under the form. There is nothing else on
the page.

### Invite (public, /invite/[token])
The login card's twin: wordmark, then name / email / password fields and
one full-width knockout "Create account" button. Email is read-only when
the invite is pinned to an address. A dead link renders the card with one
--ink-faint sentence instead of the form ("This invite link is invalid,
already used, or expired…").

### Printer
Title "Printer" with no subtitle. A status card: online dot (6px, --ink
when the printer was seen within 90 seconds) and "online" / "offline" in
mono 13px, then a label/value grid (110px column of 13px semibold labels,
mono 12.5px --ink-muted values): printer (seen 3m ago, or no printer
contact yet), print width (576 dots), version. No infra internals and no
links out. A member of a shared printer sees that printer's contact.

Below the status card, the "Devices" ledger section (13px semibold ink
heading): one row per device, rows ruled by 0.5px --border. Row: name
(14px medium ink), dotted leader, rail in 12px --ink-faint ("paired 3d
ago"; a shared one prefixes "shared with you · "), then the row's actions:
owners get small "Share" and "Revoke" keys, members get "Leave". Share
swaps in place for the minted code as mono 12px ("share code ABC123 ·
15m, single use"); an unexpired code re-renders on reload. Under an
owner's row with members, a 12px --ink-faint second line: "also prints
for {email}" with a quiet lowercase "remove" text button per member. A
mid-pairing row's rail reads "pairing…", and while one exists the page
re-renders every 3s (visible tab only) until the device collects its
token. If the printer prints a new code after a code was entered but
before it collected its token (it rebooted, or its 14-minute code
rotation came round), that claim is void: enter the newly printed code.
Empty state: one --ink-faint sentence covering both codes. Below
the list, one form for both code kinds: mono uppercase input ("pairing or
share code") + name input + a knockout "Pair" button; errors 12px --red on
their own line. A pairing code from a printer that another account still
holds is refused with "This printer belongs to another account. Its owner
can remove it on their Printer page."

### Users (admin only)
Two ledger sections, "Accounts" and "Invites", 13px semibold ink
headings. Rows are one baseline flex: name (14px medium ink; an invite
shows its email, or "anyone with the link"), dotted leader, rail in 12px
--ink-faint (email · admin; or the expiry date). Invite rows carry two
small keys right of the rail: "Copy link" (flips to "Copied" for 1.5s)
and "Revoke". Below the invites list, one inline form: optional email
input + a knockout "New invite" button. Non-admins see a single
--ink-faint sentence. The sidebar shows Users (lucide Users icon) to
admins only, after Printer.

## Voice

Sentence case everywhere except the wordmark and what prints on paper
(stamps, the barcode id). No exclamation marks, no em dashes in
sentences (a lone dash marks an empty value), no jargon or file paths in
page copy. Errors say what happened + age ("calendar 401 · 2d ago").
Empty states are short and plain ("No jobs waiting.", "Nothing printed
yet.").
