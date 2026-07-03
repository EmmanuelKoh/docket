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
(deep red goes muddy on near-black). Toggle: moon icon (light) / sun icon
(dark) in the nav; persist the choice (cookie or localStorage — this is a
normal hosted page, not a sandboxed artifact).

### Red usage rules (strict)

Red appears ONLY as: (1) active nav underline, (2) job status "printing" /
inflight, (3) failures and error text, (4) queue count when nonzero.
Everything else is gray. Enabled/on states are INK, not red (a working
plugin is normal, not an alert). Success/"done" is --ink-muted text — no
green anywhere.

## Spacing system

- Page gutter: 26px left/right, everywhere.
- Header: 16px vertical padding; bottom rule 1.5px solid --ink.
- Nav: 13px text, uniform 20px gap between all items including icons.
  Active item: --ink text + 1.5px --red underline with 3px padding-bottom.
- Major blocks: 20px apart. Section title block: 16px/500 title,
  12px --ink-faint subtitle 3px below.
- Cards: --raised bg, 0.5px --border, radius 6px, padding 16px 18px,
  12px gap between cards.
- Card detail line: separated by 1px dashed --dash, 14px padding above and
  below, fields 24px apart. Inline-editable values get 1px dotted
  --ink-faint underline.
- List containers: one --raised box, radius 6px; rows inside at 12px 18px
  with 0.5px --hairline separators (no per-row cards).
- Rows: 14px column gap; right meta column fixed 92px, right-aligned, mono
  12px — timestamps rail-align down the page.
- Labels: 11px, letter-spacing 0.12em, UPPERCASE, --ink-faint.
- Body 13px; meta/sub 12px; stat numbers 28px mono.
- Dashed divider between major page zones: 1px dashed --dash, inside the
  26px gutters.

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

Thumbnails (real job/template preview PNGs at build time): 30x44 in list
rows, 38x56 in queue cards; 0.5px --border, radius 2px, --page bg,
object-fit contain.

## Pages

Header (all pages): DOCKET wordmark left; nav right: Home, Templates,
Plugins, Queue, History, then theme-toggle icon, logout icon.

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
Title block + "New template" button right. One list container; rows:
thumbnail, name (mono 13px) with "used by <plugin>" or "manual only" sub,
edited-ago in rail, Open button, trash icon. Open loads the studio editor
with that template; New opens it blank.

### Plugins
Title block + "Register plugin" button. Per-plugin CARDS (not a list):
line 1 — toggle, id (mono), ENABLED/OFF chip, right-aligned last-run
(mono, --red if it's an error like "calendar 401 · 2d ago");
dashed rule; line 2 — interval, config JSON, template names (24px apart,
editable values dotted-underlined). Disabled plugin: text drops one step
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
--page bg, indented past the thumbnail (padding-left 62px), two columns —
TEMPLATE (name + truncated source, mono 11.5px --ink-muted) and DATA
(the JSON) — plus a Reprint button (re-renders from stored template+data;
never resends old bytes). Pagination centered below: "← newer  1 / N
older →", 12px.

### Login
Same paper page, centered small card: DOCKET wordmark, password field,
one outline button "Sign in". Nothing else.

## Voice

Sentence case everywhere except the wordmark and 11px section labels.
No exclamation marks. Errors say what happened + age ("calendar 401 · 2d
ago"). Empty states are invitations ("No jobs waiting — print something
from Templates").
