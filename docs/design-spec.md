# Docket — dashboard design spec

The source of truth for building the dashboard UI. The HTML mockups (if
present alongside) are visual reference only — build from this spec, not by
extending the mockup files.

## Identity

Two-color register ribbon: everything is one neutral gray ramp (monochrome),
plus a single deep "register red" used only where an old receipt printer would
ink red — attention and motion. Paper-flat, hairline rules, no shadows, no
gradients. Data is monospace; labels are small letterspaced caps.

Name/wordmark: DOCKET — mono font, 14px, weight 500, letter-spacing 0.14em.

## Fonts (standalone stacks, no external dependencies required)

--font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace

Weights: 400 and 500 only. Mono is for DATA VALUES only (counts, job names,
timestamps, config JSON, intervals) — never for labels or body copy.

Icons: any single icon set, outline style, 14–15px, colored --ink-faint.
(The mockups used Tabler icons via webfont; self-host or swap freely.)

## Color tokens — light ("paper") and dark ("darkroom")

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

Page texture: the body carries a faint dither grain — a repeating 96x96
tile of ~120 seeded-random dots, sized 60% 1px / 25% 1.5px / 15% 2px, in
mixed tones. In LIGHT mode all dots sit a touch darker than --page, never
lighter (bright specks on paper read as noise, not grain). In DARK mode
about a third of the base grain may sit slightly lighter than --page
(#1b1b1a/#232322) — near-black has little room below it, so a hint of
lift keeps the texture perceptible. Plus three deeper tiers, each rarer
as it gets heavier:
  ~5%   rare  — one step down (#dcdcd9 light / #060606 dark), 1px only
  ~2.5% ultra — darker still (#a5a5a1 light / #000000 dark), 1px only
  ~1.5% mid   — the rare-tier tone at 1.5px, the rarest of all
The governing rule: visual weight (depth × size) is budgeted — the darker
or bigger a fleck, the rarer it must be. Nothing dark ever reaches 2px.
Echoes thermal-paper dithering.
Small uniform tiles read as a lattice; randomness reads as grain. Cards
and list containers stay solid --raised so they lift off the texture.
Keep it barely perceptible: texture, not pattern. Toggle: moon icon (light) / sun icon
(dark) in the nav; persist the choice (cookie or localStorage — this is a
normal hosted page, not a sandboxed artifact).

### Red usage rules (strict)

Red appears ONLY as: (1) active nav underline, (2) job status "printing" /
inflight, (3) failures and error text, (4) queue count when nonzero.
Everything else is gray. Enabled/on states are INK, not red (a working
plugin is normal, not an alert). Success/"done" is --ink-muted text — no
green anywhere.

## Spacing system

- Content column: max 1120px, centered. Gutters are max(48px, half the
  leftover viewport) — never under 48px, growing naturally on wide screens.
  The studio (/studio) stays full-bleed; it is a workbench, not a page.
- Phones (≤640px): gutters drop to 16px, header and nav wrap, the stat
  strip becomes a 2×2 grid, history expand stacks its columns without the
  indent, plugin config labels sit above their values, thumbnails shrink
  one step (96x64 rows / 110x74 queue), and the Photo tool goes single
  column with a taller tap target. Same components, denser wrapping — no
  separate mobile design.
- Header: 16px vertical padding; bottom rule 1.5px solid --ink, full-bleed,
  with contents aligned to the content column.
- Nav: 13px text, uniform 20px gap between all items including icons.
  Active item: --ink text + 1.5px --red underline with 3px padding-bottom.
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
  12px, never wraps ("canceled · 33m" is the sizing case) — timestamps
  rail-align down the page. Rows with a thumbnail TOP-ALIGN all content to
  the media (text centered against tall media floats in dead space); only
  single-line rows center vertically.
- Labels: 11px, letter-spacing 0.12em, UPPERCASE, --ink-faint.
- Body 13px; meta/sub 12px; stat numbers 28px mono.
- Dashed divider between major page zones: 1px dashed --dash, inside the
  gutters.

## Components

Buttons: outline only — 0.5px --border, radius 6px, --raised or --page bg,
--ink text 12–12.5px, padding 6px 12px (4px 10px for in-row buttons).
No filled buttons anywhere.

Toggle: 34x20 pill, 16px knob inset 2px. On: --ink fill, knob --page.
Off: --border fill, knob white/raised.

Status chip (plugins only): 11px caps, 0.06em tracking, 2px 8px, 0.5px
--border, radius 4px. ENABLED = --ink-muted text; OFF = --ink-faint.
Job statuses are plain mono text, not chips: "printing"/"failed" in --red,
"queued"/"done" in --ink-muted / --ink-faint.

Thumbnails (real job/template preview PNGs at build time): landscape to
match the artifact — receipts are wider than tall. 130x86 in list rows,
158x108 in queue cards; 0.5px --border, radius 2px, object-fit contain.
Background is always #fff in BOTH themes — receipts are paper, and a theme
background would letterbox dark bars around them in darkroom mode.
Hovering any list thumbnail floats a 288px-wide peek of the same PNG
(--raised, 0.5px --border, no shadow). Thumbnails identify; the peek and
the History expand are where receipts are read.

## Pages

Header (all pages): DOCKET wordmark left; nav right: Home, Templates,
Photo, Plugins, Queue, History, then theme-toggle icon, logout icon.

### Home
1. Stat strip: ONE bordered container split into 4 cells by 0.5px --hairline
   verticals (not separate cards). Cell: label / 28px mono number (8px
   below label) / 12px sub (2px below). Queue number is --red when > 0.
2. System line (plain text row, 12px, 24px gaps): printer online dot
   (6px --ink circle) + last device contact; store driver; tick interval;
   version right-aligned --ink-faint.
3. Dashed divider.
4. RECENT: label + "view all →" link; the 3 newest history rows (name mono,
   source, status·time in the 92px rail). Same records as History — a
   preview slice, not a separate feature.

### Templates
Title block + "New template" button right. Templates are visual artifacts,
so this page is a CARD GRID, not a list: repeat(auto-fill, minmax(240px,
1fr)), 12px gaps. Each card: the top of the real rendered receipt as the
hero (170px tall, white, top-cropped, 1px dashed --dash bottom edge), then
one head line — name (mono 13px) with a trash icon right, revealed on card
hover — and a quiet sub: "used by <plugin>" or "manual only" · edited-ago.
No Open button: the card IS the button (preview and name both load the
studio; card border shifts to --ink-faint on hover as the cue). Buttons
earn their border by being the exception — never repeat the default action
of an already-clickable object. New opens the studio blank. (Lists remain
the pattern for records — History, Queue.)

### Photo
A print tool, not a registry plugin (no run()/toggle — user-initiated).
Title block ("print a picture — dithered like everything else"), one card:
left column (320px) — dashed dropzone (1px dashed --dash, choose-or-drop),
a full-width "Take a photo" button (phones open the native camera via the
file input's capture hint; desktops open an in-page webcam viewfinder that
shares the editor's stage — mirrored video on black swaps in where the
edit canvas sits, with a camera-app shutter below: a 44px --ink ring whose
inner disc grows on hover, centered, quiet mono "cancel" right-aligned;
capturing mirrors the frame to match the viewfinder and swaps the canvas
back in place), then the editor
(appears once a photo loads): the source image on a bordered canvas with a
draggable/resizable crop rectangle (white border + corner handles over a
55% dim outside the crop), preset shortcuts Full / 1:1 / 4:3 / 3:2 (ratios
follow the image's orientation; presets only set the rectangle — it stays
adjustable) and a Rotate 90° button; below that a TONE group: a LEVELS row
(caps label, small mono AUTO chip — inverse ink while on — and a mono
"black · white" readout), a 40px monochrome histogram of the cropped photo
with clipped tones dimmed, a hairline track with two 10px square handles
(black filled, white outlined) dragged to set black/white points, then
BRIGHTNESS and CONTRAST rows: caps label, hairline-track slider with a
10px square --ink thumb, mono value right. Auto recomputes the points on
every crop/rotate; dragging a handle turns it off; double-clicking a label
resets that control. Adjustments show in the live render only — the edit
canvas keeps the untouched photo; CAPTION label + dotted editable input
(mono output) with segmented controls for size (S/M/L = 28/36/48px) and
weight (Regular/Bold); outline Print button, mono status text. Right — the
live preview on white paper (the real /preview render of the full-bleed
"Photo Print" template: borderless 576px photo, optional mono caption
below). Photos downscale client-side before upload; every edit re-derives
the print image, so what you see is the dithered print, not an
approximation. Stacks vertically under 720px (phone use is the point).

Segmented control (.seg): a bordered pill of flush buttons; the active
option is inverse mono (--ink background, --page text) — same idiom as a
toggle that's on, never red.

### Plugins
Title block + "Register plugin" button. Per-plugin CARDS (not a list):
line 1 — toggle, id (mono), ENABLED/OFF chip, right-aligned last-run
(mono, --red if it's an error like "calendar 401 · 2d ago");
dashed rule; below it, PER-FIELD config editing in a label/value grid
(110px label column, 11px caps labels): one dotted-underline input per
config key, derived from the config's shape — arrays edit as
one-item-per-line textareas (also accept commas), numbers are validated
(types come from the plugin's defaults.config), long values wrap at full
width, never overflow the card. Interval first, template names last.
Invalid input → red inline error spanning the grid, nothing saved.
Never a raw-JSON blob input. Disabled plugin: text drops one step
(--ink → --ink-muted).

### Queue
Title "Queue" with "refreshes every 3s" subtitle; job count right (mono).
Job CARDS: thumbnail 38x56, name + "source · created HH:MM:SS" sub,
status mono ("printing" --red / "queued" --ink-muted), rail = "claimed Ns"
for inflight or a Cancel button for queued ONLY (inflight cannot be
canceled — the printer already claimed it). List auto-refreshes (htmx
polling every 3s on the list fragment).

### History
Title + "N jobs · newest first"; filter control right (dotted-underline
value). One list container; rows like Templates but with status·time in
the rail ("failed" --red). Row click expands (chevron) an inset panel:
--page bg, indented past the thumbnail (padding-left 162px), three columns —
PRINTED (the receipt PNG at 200px), TEMPLATE (name + truncated source,
mono 11.5px --ink-muted) and DATA (the JSON) — plus a Reprint button
(re-renders from stored template+data; never resends old bytes). Pagination centered below: "← newer  1 / N
older →", 12px.

### Login
Same paper page, centered small card: DOCKET wordmark, password field,
one outline button "Sign in". Nothing else.

## Voice

Sentence case everywhere except the wordmark and 11px section labels.
No exclamation marks. Errors say what happened + age ("calendar 401 · 2d
ago"). Empty states are invitations ("No jobs waiting — print something
from Templates").
