---
name: DOCKET
description: The printer's own control deck. A dashboard for a home thermal receipt printer.
colors:
  ground: "#e8e6e1"
  face: "#dadad6"
  fill: "#191918"
  fill-soft: "#3b3a37"
  red-fill: "#a8281b"
  focus: "#161616"
  strip: "#161615"
  strip-ink: "#ebe8e1"
  strip-off-ink: "#77746d"
  nav-legend: "#2c2a26"
  drum: "#1c1b19"
  drum-ink: "#e9e5dc"
  eink: "#dcdad3"
  eink-ink: "#23221f"
  eink-dim: "#5e5b55"
  eink-faint: "#8b877f"
  eink-red: "#a8291f"
  dark-screen: "#121211"
  dark-screen-ink: "#d5d1c7"
  paper: "#fefefe"
  sheet-stock: "#f3f1ec"
  sheet-ink: "#1f1e1c"
  sheet-band: "#2b2a27"
  printed-ink: "#262420"
  led-green: "#9be41f"
  led-red: "#f23a1e"
  switch-on: "#cf6d2f"
typography:
  wordmark:
    fontFamily: "Big Shoulders, Arial Narrow, sans-serif"
    fontSize: "31px"
    fontWeight: 640
    lineHeight: 0.8
    letterSpacing: "0.04em"
  page-name:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.32em"
  engraved:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.15em"
  nav-legend:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.15em"
  key-legend:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  note:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  drum:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "'tnum'"
  plate-number:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 82"
  screen:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.3
    fontVariation: "'wdth' 82"
  sheet-band:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 82"
  caption-time:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 600
    fontVariation: "'wdth' 82"
  stamp:
    fontFamily: "Big Shoulders, Arial Narrow, sans-serif"
    fontSize: "14px"
    fontWeight: 734
    lineHeight: 1.1
    letterSpacing: "0.12em"
    fontVariation: "'opsz' 72"
rounded:
  strip: "1.5px"
  screen: "2px"
  counter: "2.5px"
  wheel: "3px"
  window: "4px"
  lkey: "5px"
  body: "12px"
spacing:
  key-gap: "2px"
  field-gap: "10px"
  row-pad: "12px"
  body-x-phone: "16px"
  plate-y: "22px"
  body-x: "30px"
  sheet-x: "44px"
  row-pitch: "48px"
  gutter: "48px"
components:
  body:
    backgroundColor: "{colors.face}"
    textColor: "{colors.fill}"
    rounded: "{rounded.body}"
  plate:
    padding: "22px 30px"
  plate-head:
    typography: "{typography.page-name}"
    padding: "0 30px"
    height: "58px"
  key:
    textColor: "{colors.strip-ink}"
    typography: "{typography.key-legend}"
    width: "88px"
    height: "45.84px"
  key-print:
    textColor: "{colors.strip-ink}"
    typography: "{typography.key-legend}"
    width: "104px"
    height: "45.84px"
  key-disabled:
    textColor: "{colors.strip-off-ink}"
  key-legend-strip:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.strip-ink}"
    rounded: "{rounded.strip}"
    height: "20px"
  counter-window:
    backgroundColor: "{colors.drum}"
    textColor: "{colors.drum-ink}"
    typography: "{typography.drum}"
    rounded: "{rounded.counter}"
    padding: "3px"
    height: "36px"
  thumbwheel:
    rounded: "{rounded.wheel}"
    width: "27px"
    height: "46px"
  slide-switch:
    width: "52px"
    height: "22px"
  fader:
    width: "150px"
    height: "40px"
  leica-key:
    textColor: "{colors.fill}"
    typography: "{typography.engraved}"
    rounded: "{rounded.lkey}"
    width: "81px"
    height: "31px"
  leica-key-wide:
    rounded: "{rounded.lkey}"
    width: "96px"
    height: "31px"
  shutter:
    size: "56px"
  led:
    size: "13px"
  screen-eink:
    backgroundColor: "{colors.eink}"
    textColor: "{colors.eink-ink}"
    typography: "{typography.screen}"
    rounded: "{rounded.screen}"
  screen-dark:
    backgroundColor: "{colors.dark-screen}"
    textColor: "{colors.dark-screen-ink}"
    typography: "{typography.screen}"
    rounded: "{rounded.screen}"
  field:
    backgroundColor: "{colors.eink}"
    textColor: "{colors.eink-ink}"
    typography: "{typography.screen}"
    rounded: "{rounded.screen}"
    padding: "0 14px"
    height: "40px"
  printer-block:
    width: "340px"
    height: "70px"
  platen:
    width: "352px"
    height: "21px"
  slip:
    backgroundColor: "{colors.paper}"
    padding: "18px 16px 26px"
    width: "320px"
  thumb:
    backgroundColor: "{colors.paper}"
    padding: "5px 4px 6px"
    width: "84px"
  record-sheet:
    backgroundColor: "{colors.sheet-stock}"
    textColor: "{colors.sheet-ink}"
    padding: "36px 44px 30px"
  record-sheet-band:
    backgroundColor: "{colors.sheet-band}"
    typography: "{typography.sheet-band}"
    padding: "0 12px 0 11px"
    height: "30px"
  nav-unit:
    backgroundColor: "{colors.face}"
    rounded: "{rounded.body}"
    width: "222px"
  nav-lever-key:
    textColor: "{colors.nav-legend}"
    typography: "{typography.nav-legend}"
    width: "166px"
    height: "45px"
  stamp:
    textColor: "{colors.printed-ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.strip}"
    padding: "2px 7px 1px"
---

# Design System: DOCKET

This file holds the tokens and the parts. `docs/design-spec.md` holds the behavior of each page, the shell and the voice. When the UI changes, update both files in the same change. The frontmatter values are the light theme. `.impeccable/design.json` holds the dark values, the shadows, the motion and the breakpoints.

## Overview

**Creative North Star: "The Printer's Own Control Deck"**

Each tool page is one machine. Its controls are built into the housing, and nothing is a loose card on the mat. The machine body is Leica satin silver in light and Leica black paint in dark, with a rolled edge all round, plates joined by seams, and names engraved into the plate and filled with paint. The bodies stand on a graph-paper mat in light and a cutting mat in dark. The nav unit rides a slim satin track at the left of the mat.

The parts are the parts kit: `app/kit.css` (every class has the `pk-` prefix), `components/hardware/kit/` (React parts) and `components/hardware/kit/slip.css` (paper). The parts get their depth from sprites rendered offline in one oblique light (`public/hardware/kit/`, `public/hardware/nav/`; each PNG carries its generator). Motion is short mechanical travel: a key goes down, a cap slides, a lever dips, a roller turns. Nothing fades or springs.

The user pinned these choices from the concept labs (units-refine, 2026-10-16). They are accepted and are the system:
- one machine body per tool page, its controls in the housing;
- satin silver and black paint bodies, engraved paint-filled lettering, rolled edges;
- tape-deck keys in one well with a black legend strip, the red print key last;
- counter windows with thumbwheels that step (buttons, scroll or arrow keys, never drag);
- slide switches, short sliders and the red-dot shutter;
- receipts at real size: a 320px slip with the print at 288px;
- the nav unit on its track, with knurled rollers that turn as the page scrolls and stay still under reduced motion, and the current lever key dipped lengthwise;
- Big Shoulders, Hanken Grotesk and Martian Mono.

**Key Characteristics:**
- A printed mat (graph paper or cutting mat), never a flat fill.
- One body per page: a head plate with the engraved page name and the lamp, then plates and seams.
- Keys stand in one well under a black legend strip. The red print key is last.
- Counts and times read through counter windows on digit drums.
- Receipts at real size on white paper.
- Three accents with fixed jobs: red, green, orange.

## Colors

A grey machine in satin metal or black paint, ink and paper, with three small accents that each do one job.

### Primary
- **Register Red Fill** (`red-fill`): the red paint in an engraving and red notes. It marks printing, failures and errors, and waiting jobs.
- **Print Key Red**: the cap of the one print key in a well. It is in the key sprite (`key-red-up`, `key-red-down`), not in a token.
- **E-ink Red** (`eink-red`): the caret, the selection and the underline of a wrong value on a screen.

### Secondary
- **Lit LED Green** (`led-green`): the online LED and nothing else.
- **Lit LED Red** (`led-red`): the LED for printing, a failure, and live audio in Tape.

### Tertiary
- **Switch Orange** (`switch-on`): the ON mark painted on the floor of a slide switch slot. It is in the slot sprite and shows only when the cap is at ON.

### Neutral
- **Graph Paper Mat** (`ground`): the page under the printed grid (`.hw-ground`).
- **Satin Face** (`face`): the face of a body and of the nav unit, under the tone and grain textures.
- **Engraving Fill** (`fill`) and **Soft Fill** (`fill-soft`): paint in engraved names and notes; the soft fill is for secondary lines, plate numbers and disabled keys.
- **Legend Strip** (`strip`) with **Strip Ink** (`strip-ink`) and **Worn Strip Ink** (`strip-off-ink`): the black strip over a key well and its legends.
- **Lever Legend** (`nav-legend`): pad-printed legends on the cream lever keys.
- **Drum** (`drum`) with **Drum Ink** (`drum-ink`): the digit drums in a counter window.
- **E-ink** (`eink`), **E-ink Ink** (`eink-ink`), **E-ink Dim** (`eink-dim`), **E-ink Faint** (`eink-faint`): screens and fields in light. Dim is a placeholder or a read-only value; faint is disabled.
- **Dark Screen** (`dark-screen`) with **Dark Screen Ink** (`dark-screen-ink`): the Photo LCD, dark screens, and every screen and field in dark.
- **Thermal Paper** (`paper`): slips and thumbnails.
- **Sheet Stock** (`sheet-stock`), **Sheet Ink** (`sheet-ink`), **Sheet Band** (`sheet-band`): record sheets in History.
- **Printed Ink** (`printed-ink`): text printed on the mat (the Home heading, captions under slips).

### Named Rules
**The Fixed Jobs Rule.** Red marks only the current page (the flag window), printing, failures and errors, waiting jobs, the one print key, live audio in Tape and the Tape selection halo. Green is only the online LED. Orange is only the ON mark of a switch. The full list is in `docs/design-spec.md`, accent rules.

**The On Is Not Red Rule.** A slip that is on shows the switch position and its orange mark. A working slip is normal, not an alert.

**The Paper Stock Rule.** Slip and thumbnail stock is `paper` in both themes. In dark, the room light dims it a little (`--pk-paper-light`). A preview of what will print (Studio, Photo) is exact: no grain, no dimming, no tilt on its pixels.

## Typography

**Display Font:** Big Shoulders (with Arial Narrow), for the wordmark and stamps only.
**Body Font:** Hanken Grotesk (with Helvetica Neue, Arial), for engraved names, legends, drums and notes.
**Label/Mono Font:** Martian Mono at width 82% (with ui-monospace, SF Mono, Menlo), for screens, fields, plate numbers, record sheets and times.

**Character:** Wide-tracked engraved capitals, like the names cut into a camera top plate, over plain reading text. The mono is what a screen or a printer types.

### Hierarchy
- **Wordmark** (640, 31px, 0.8, 0.04em): "DOCKET" engraved deep into the nav unit's top plate. 25px when the unit lies across the top.
- **Page name** (600, 19px, 0.32em, uppercase): the h1, engraved in the head plate. On Home, the same letters print in ink on the mat.
- **Engraved** (600, 11.5px, 0.15em, uppercase): names on a plate, row names, switch ends (OFF, ON), field names, the lamp state.
- **Lever legend** (600, 12px, 0.15em, uppercase): nav keys. 11px on the narrow strip.
- **Key legend** (600, 10.5px, 0.14em, uppercase): legends on a key well strip and on a Leica key.
- **Note** (500, 14px, 1.45): sentence-case reading text on a plate: hints, descriptions, empty states.
- **Drum** (600, 17px, tabular): digits in a counter window. A name drum is 15px at 0.1em.
- **Plate number** (600, 11px mono, 0.08em): "01", "02" before a plate name.
- **Screen** (500, 16px mono, 1.3): typed text in a field or on a screen. 16px keeps phones from zooming.
- **Sheet band** (600, 12px mono, 0.1em, uppercase): the band at the top of a record sheet. Entries under it use an 11.5px mono sub-line.
- **Caption time** (600, 14px mono): the time under a slip on the mat.
- **Stamp** (734, 14px, 0.12em, uppercase): rubber stamps (Printed, Canceled, Failed).

### Named Rules
**The Capitals By CSS Rule.** Write names, legends and stamps in sentence case in the source. CSS sets the capitals. Unit symbols keep their case ("2 h", "274 px").

**The Engraving Floor Rule.** Engraved and legend capitals are 10.5px or larger. Text that is read as a sentence is 14px or larger.

**The Engrave Or Type Rule.** Names and legends are engraved on the plate. Values the user types or the machine reports show on a screen, a drum or paper.

## Layout

The shell is the nav unit and the content column side by side. Above 875px the nav unit (222px wide) stands in a 284px dock at the left and stays in view while the page scrolls; on a short window the dock scrolls on its own. Under it, a 60px satin track with a 10px slot is screwed to the mat and runs the full height of the page, so it scrolls with the page. Two knurled rollers in the slot, one above and one below the unit, turn as the page scrolls.

At 875px and below the unit lies across the top, 16px from the screen edges: DOCKET and the printer line, then the lever keys in one strip that scrolls sideways and snaps to whole keys (a part key always shows at its end), then the Dark switch and Sign out. There is no track.

The content column is left-aligned, at most 1180px wide, with 40px top, 48px side and 72px bottom padding above 875px, 32px sides from 640px and 16px on phones. Tape uses the full width. A body's rolled edge reaches 26px outside it (31.5px below), so leave that room round a body.

Inside a body, plates have 22px top and bottom padding and 30px sides (16px on phones). The head plate is 58px tall (54px on phones). Rows sit on a 48px pitch with 12px padding when ruled. Keys in a well are 2px apart. A field's name is 10px above its window. Every control has a 44px hit area.

On Home the heading prints on the mat and the printer is one body (384px, 352px from 1060px of content width) with the newest slip rising from its platen. The older slips lie on the mat at real size, two columns from 1060px, one from 740px, and under the printer when narrower.

## Elevation & Depth

Depth comes from material and one light: a single source above the screen, a little to the left. A body's edge, its contact shadow and the walls of a well or window are in the sprites, not in box shadows. Engravings carry a lit lower lip and a shaded upper edge. Paper and sheets lie on the mat with soft, close shadows.

### Shadow Vocabulary
- **Engraving** (`--pk-engr-shadow`): a lit lip under the cut and a shade on its top edge.
- **Legend strip edge** (`--pk-strip-edge`): the strip inlaid flush into the plate.
- **Slip** (`--pk-slip-shadow`): three close drop shadows under a slip.
- **Thumb** (`--pk-thumb-shadow`): the same at thumbnail scale.
- **Record sheet** (`--pk-sheet-shadow`): four soft layers, with a corner that lifts.

### Named Rules
**The One Light Rule.** All light comes from above, a little to the left. A gradient on a part models that light on its material and is never decoration.

**The Soft Shadow Rule.** Shadows are soft and close. Hard offset shadows are not part of this world.

**The Sprite Rule.** A part that has depth gets a sprite rendered in the kit's light, with its generator embedded. Do not draw a new part with CSS gradients.

## Shapes

Corners are machined. A body has 12px corners and a rolled edge. Wells, windows and leather insets are 4px; the Leica key is 5px; the thumbwheel slot 3px; the counter window 2.5px; screens and fields 2px; the legend strip and a stamp 1.5px. The LED, its collar and the shutter are the only circles. Plates join at a seam: a dark gap and the lower plate a hair down. Ruled rows have an engraved line between them. Slips have straight slit sides and torn ends; a slip's bottom tear is the same line as the top tear of the next newer slip.

## Components

### Key well (buttons)
Tape-deck keys in one well cut through the plate.
- **Shape:** a black legend strip (20px) above one well; the keys stand in it 2px apart. A key is 88px by 45.84px; the print key is 104px.
- **Default:** the cap is a 3-slice sprite. The legend prints on the strip above the key, not on the cap.
- **Hover / Active:** hover lowers the cap 0.5px. Press, a latched key (`aria-pressed`) and a key held by state (`.is-down`) show the down sprite. Focus is a 2px ring round the key and its legend.
- **Print key:** the red key, last in the well, only on the key that commits a print.
- **Compact:** the same well at 72% for row actions; the legend keeps its printed size. **Fill:** on phones the keys share the well's width.
- **Disabled:** the cap goes matte and the legend takes the worn ink.
- **Destructive keys** (Remove, Revoke, Delete) are plain keys. They are never red.

### Leica key
One satin key (black paint in dark) in its own slot, its name engraved on it, 81px by 31px; the wide key (96px) is Sign out. Press shows the down sprite and moves the engraving down 1.2px. The hit area grows to 44px.

### Counter window and thumbwheel
Digit drums behind a window in the plate, with a knurled wheel beside it in its own slot. The drums curve away top and bottom; the next and last values show squashed above and below. The wheel steps: its top half up, its bottom half down, or scroll, or arrow keys. A click on the window opens the list. It never drags. A counter alone (no wheel) shows a reading: last seen, waiting jobs, slip counts, take times.

### Slide switch
A ribbed cap in a slot cut through the plate, with its two ends engraved beside it. A mode switch (Template/Data, Edit/Preview) has a plain floor. An on/off switch paints the orange ON mark under the cap's OFF place, so it shows only at ON. The cap moves in 0.12s ease-out and gives 1px to 4px under the finger. Target height 44px.

### Slider (fader)
A short slot (150px) with a ribbed cap and a white index line, engraved end marks, and a centre mark when the value is centred. A native range input.

### Shutter
The Capture release: a 56px soft release on a stepped collar, with a red dot on its cap. Disabled shows it locked (matte, the dot dull), not faded.

### LED and lamp
A 3 mm diffused LED, 13px in a 23px black collar. Off is dark epoxy; lime is online only; red is printing, a failure or live audio. The lamp is the LED and its engraved state together, at the right of a head plate.

### Body and plates (cards)
One body per page. The head plate holds the engraved page name (the h1) and the lamp. Plates below join with a seam. A plate may have a number and name ("01 Printers") with an engraved rule after it. Number plates 01, 02, 03 in reading order.

### Screens and fields (inputs)
A window cut through the plate with a display behind it: e-ink in light, the dark screen in dark; the Photo LCD is always dark. A field is an engraved name over a small screen in a thin recess, no black bezel. Text is mono 16px with a red caret. Focus is a 2px outline 3px out round the window. A wrong value gets a 2px red underline on the screen. A select has a drawn chevron 13px from the right.

### Printer block and platen
The printer block is the terminal printer's front edge (a 3-slice sprite, 340px by 70px for a 320px slip); the slip feeds out under its tear bar. The platen is a slot in a plate (352px, 21px tall) with the rubber roller and a steel tear bar; the slip stands up out of it, torn at the top, and the body's layout does not move. Home's printer and the Studio teleprinter use the platen.

### Paper
An 80 mm slip is 320px with the 576-dot print at 288px (exact on 2x screens), with grain over the print and torn ends. A thumbnail is the same paper at 84px (68px on phones), torn at both ends, cut at 112px.

### Record sheet
A log sheet of uncoated stock on the mat for History: a printed band with its number and label, typed entries with printed dashed rules between, and a corner that lifts a little. Each sheet lies a little differently. A whole entry is the target.

### Navigation (nav unit)
A body on the track. The top plate has DOCKET and the version engraved. The key bank is one well of long cream lever keys (dark grey in dark), 166px on a 45px pitch, each with a flag window in the plate at its left: a black drum, red for the current page. The current key is held down: its far end dips into the well and its legend tilts with it. Hover rests a finger on the key. Each state is a sprite (`public/hardware/nav/`). After a seam, the foot plate has the printer lamp and name, the Dark switch and Sign out. On the narrow strip the keys dip at their front edge and the flags sit above them.

### Rubber stamp
Big Shoulders in a 1.5px border, turned -3deg, with uneven ink, on a caption or a record: Printed, Canceled (lighter ink), Failed (red).

## Do's and Don'ts

### Do:
- **Do** build a page as one body from the `pk-` parts and `components/hardware/kit/` before you write new CSS.
- **Do** put every theme value in a custom property on `:root` and override it under `html[data-theme="dark"]`.
- **Do** engrave names and legends; show typed and reported values on a screen, a drum or paper.
- **Do** put the keys of a body in one well, with the red print key last.
- **Do** step a counter with its thumbwheel, scroll or arrow keys.
- **Do** show receipts at real size: a 320px slip, the print at 288px.
- **Do** give every control a 44px hit area.
- **Do** remove masks and blends under `forced-colors: active`, and stop transitions and the rollers under `prefers-reduced-motion: reduce`.

### Don't:
- **Don't** put loose cards, bars or separate panels on the mat; a page is one machine.
- **Don't** use stat cards, pills, chips or a sidebar of icon links. A count reads through a counter window.
- **Don't** make a counter drag.
- **Don't** use hard offset shadows or gradients that do not model the kit's light.
- **Don't** make a key red unless it commits a print, and don't make On red.
- **Don't** use fades or springs; motion is short mechanical travel.
- **Don't** add a button that repeats the default action of an object that is already clickable.
- **Don't** set engraved capitals below 10.5px or reading text below 14px.
