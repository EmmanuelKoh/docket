---
version: 1
slug: "app-dashboard-page-tsx"
primary_target: "app/(dashboard)/page.tsx"
related_targets: ["app/(dashboard)/layout.tsx","components/app-sidebar.tsx","app/hardware.css"]
---

## Scope

Mode: Operate. The dashboard shell, Home, Studio, Photo and History are rebuilt as single machines from the approved labs. The user extended the redesign to the remaining pages (Slips, a slip's page, Printer, Queue, Users, Tape, Login, Invite): each is rebuilt as one machine body from the same parts kit (`app/kit.css`, one key sprite set), under the new nav, held to the approved pages' quality bar. They have no approved comp of their own. Constraints are in CLAUDE.md:
- the boundary lock;
- no Postgres on the device cadence;
- the photo engine and the tape canvases are contracts.

## Direction contract

THESIS: each tool page is one machine with its controls built into the housing. Nothing is a loose card on the mat. The refused default is a page of separate panels, bars and buttons.

OWN-WORLD:
- graph-paper mat (light) and cutting mat (dark);
- bodies in Leica satin silver (light) and black paint (dark), with engraved paint-filled lettering and rolled edges;
- tape-deck key wells with legend strips, the red print key last;
- slide switches, short terminal sliders, counter windows with thumbwheels (step buttons, never drag), the red-dot shutter;
- receipts at real size (320px slip, 288px print);
- fonts: Big Shoulders, Hanken Grotesk, Martian Mono.

STORY: the visitor sees what printed and whether the printer is alive, edits or prints a slip, and leaves. The machine tells them where every control is.

FIRST VIEWPORT:
- Nav: a satin unit holding lever keys with red flag windows. It rides a slim track under it, and knurled rollers in the slot turn as the page scrolls.
- Home: TODAY engraved, today's slips in a grid, the status unit as the printer with the newest slip rising from its platen, and the slip switches in the same body.
- Studio: a teleprinter. Paper rises from the platen above a full-width editor, and the front strip carries the counter, Template/Data and the key well.
- Photo: one camera body. The screen shows what will print, the adjustments sit beside it, and the strip holds caption, capture and the key well.
- History: a deck header (counter, filter keys, Reprint), then day sheets of records.

FORM: user-pinned, from the concept labs (units-refine, 2026-10-16). There is no seed key. Signature interaction: the track rollers turn with scroll and stay still under reduced motion. The current lever key dips lengthwise.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
