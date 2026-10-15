---
name: DOCKET
description: The printer's own control deck. A dashboard for a home thermal receipt printer.
colors:
  ground: "#e8e6e1"
  panel: "#f0efeb"
  key: "#ebe7de"
  paper: "#fefefe"
  plate: "#262523"
  plate-ink: "#dedbd4"
  cutout: "#151311"
  printed-ink: "#262420"
  ink: "#161616"
  ink-muted: "#4a4741"
  ink-faint: "#5d5a53"
  hairline: "#d8d5ce"
  border: "#bdb9b0"
  dash: "#a9a69e"
  field: "#f8f7f4"
  field-edge: "#2a2926"
  legend-disabled: "#a29d92"
  red: "#b3261e"
  key-red: "#b5422f"
  flag: "#d8483a"
  led-green: "#9be41f"
  switch-on: "#cf6d2f"
typography:
  display:
    fontFamily: "Big Shoulders, Arial Narrow, sans-serif"
    fontSize: "64px"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "0.02em"
    fontVariation: "'opsz' 72"
  wordmark:
    fontFamily: "Big Shoulders, Arial Narrow, sans-serif"
    fontSize: "34px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.06em"
    fontVariation: "'opsz' 72"
  title:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  note:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  key-legend:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  plate:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 82"
  label:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 82"
  mono-data:
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
  stamp: "1.5px"
  part: "2px"
  housing: "4px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "16px"
  lg: "28px"
  xl: "40px"
  gutter: "48px"
components:
  push-key:
    backgroundColor: "{colors.key}"
    textColor: "{colors.ink}"
    typography: "{typography.key-legend}"
    rounded: "{rounded.part}"
    padding: "0 18px"
    height: "46px"
  push-key-compact:
    backgroundColor: "{colors.key}"
    textColor: "{colors.ink}"
    typography: "{typography.key-legend}"
    rounded: "{rounded.part}"
    padding: "0 14px"
    height: "38px"
  push-key-large:
    backgroundColor: "{colors.key}"
    textColor: "{colors.ink}"
    typography: "{typography.key-legend}"
    rounded: "{rounded.part}"
    padding: "0 34px"
    height: "60px"
  push-key-print:
    backgroundColor: "{colors.key-red}"
    textColor: "{colors.panel}"
    typography: "{typography.key-legend}"
    rounded: "{rounded.part}"
    padding: "0 18px"
    height: "46px"
  push-key-disabled:
    backgroundColor: "{colors.key}"
    textColor: "{colors.legend-disabled}"
  keys-cutout:
    backgroundColor: "{colors.cutout}"
    rounded: "{rounded.housing}"
    padding: "2px"
  lever-key:
    backgroundColor: "{colors.key}"
    textColor: "{colors.ink}"
    typography: "{typography.key-legend}"
    rounded: "{rounded.housing}"
    padding: "0 14px 0 16px"
    height: "50px"
  lever-key-flag-current:
    backgroundColor: "{colors.flag}"
    width: "5px"
    height: "16px"
  key-bank:
    backgroundColor: "{colors.plate}"
    rounded: "{rounded.housing}"
    padding: "8px 8px 8px 0"
  module:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.part}"
  module-plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    typography: "{typography.plate}"
    padding: "8px 14px"
  module-body-padded:
    padding: "18px 16px 20px"
  row:
    padding: "14px 16px"
  row-tight:
    padding: "6px 14px 6px 16px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.part}"
    padding: "0 12px"
    height: "46px"
  stamp:
    textColor: "{colors.printed-ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "2px 7px 1px"
  slide-switch:
    width: "52px"
    height: "22px"
  led:
    backgroundColor: "{colors.cutout}"
    size: "14px"
  thumbnail:
    backgroundColor: "{colors.paper}"
    padding: "4px"
  paper-slip:
    backgroundColor: "{colors.paper}"
    padding: "30px 24px 46px"
    width: "624px"
---

# Design System: DOCKET

This file holds the tokens and the components. `docs/design-spec.md` holds the behavior of each page, the shell and the voice. When the UI changes, update both files in the same change. The frontmatter values are the light theme; `.impeccable/design.json` holds the dark values and the shadows, motion and breakpoints.

## Overview

**Creative North Star: "The Printer's Own Control Deck"**

Each page is a set of hardware parts on a printed ground. The ground is warm grey graph paper in light and a dark cutting mat in dark. On it sit painted panels with black label plates, a bank of matte lever keys with a red flag window, matte push keys in a shared dark cutout, an LED in a black collar, a ribbed slide switch, rubber stamps, and the real receipts at true size under the printer's front edge.

The parts get their depth from their material: soft shadows, a hammer finish on panels, mottle and grain on keys, and sprites rendered offline for the switch, the LED collar and the printer edge (`public/hardware/`). Text printed on the ground multiplies into the stock and wears a little. Legends on hardware parts print in capitals. Motion is short mechanical travel: a key dips, a cap slides, and nothing fades or springs.

The kit is `app/hardware.css` (every class has the `hw-` prefix) and `components/hardware/paper.css` (printer edge, roll, slip, torn edges), with React parts in `components/hardware/`. The dark theme is the black edition of the same machine, set by `data-theme="dark"` on `<html>`.

**Key Characteristics:**
- A printed graph-paper ground, never a flat fill.
- Panels with black mono label plates, numbered 01, 02, 03 in page order.
- Receipts at true size (576px image) on white paper in both themes.
- Uppercase tracked legends on every hardware part.
- Three accents with fixed jobs: red, green, orange.

## Colors

A warm grey machine in ink and paper, with three small accents that each do one job.

### Primary
- **Register Red** (`red`): red text. Use it for the current state that needs attention: "Printing", failures, error text, waiting jobs.
- **Print Key Red** (`key-red`): the tone of the one print key on a screen.
- **Flag Red** (`flag`): the flag window of the held lever key, which marks the current page.

### Secondary
- **Lit LED Green** (`led-green`): the online LED and nothing else.

### Tertiary
- **Switch Orange** (`switch-on`): the ON mark painted on the floor of a slide switch slot. It shows only when the cap is at ON.

### Neutral
- **Graph Paper Stock** (`ground`): the page ground under the printed grid. The `page` alias in `app/globals.css` points at the same value.
- **Painted Panel** (`panel`): modules and the navigation panel. The `raised` alias points at the same value.
- **Matte Key** (`key`): lever keys and push keys.
- **Thermal Paper** (`paper`): receipts and thumbnails. It stays white in both themes.
- **Label Plate Black** (`plate`) with **Silkscreen** (`plate-ink`): module plates, the key bank housing and the skip link.
- **Cutout Black** (`cutout`): the dark recess that holds keys and the LED collar.
- **Printed Ink** (`printed-ink`): text printed on the ground (page titles, captions, dates).
- **Ink** (`ink`), **Muted Ink** (`ink-muted`), **Faint Ink** (`ink-faint`): primary, secondary and tertiary text on the panel. Faint ink also marks a row that is off.
- **Dashed Rule** (`dash`): the 1px dashed line under each row. `hairline` and `border` are lighter dividers.
- **Field White** (`field`) with **Field Edge** (`field-edge`): text inputs.
- **Worn Legend** (`legend-disabled`): the legend of a disabled key.

### Named Rules
**The Fixed Jobs Rule.** Red marks only the current page, printing, failures and errors, waiting jobs, the one print key, live audio in Tape and the Tape selection halo. Green is only the online LED. Orange is only the ON mark of a switch. The full list is in `docs/design-spec.md`, accent rules.

**The On Is Not Red Rule.** A slip that is on shows the switch position and its orange mark. A working slip is normal, not an alert.

**The White Paper Rule.** Paper, thumbnails and stamps pressed on paper keep the light values in both themes.

## Typography

**Display Font:** Big Shoulders at optical size 72 (with Arial Narrow)
**Body Font:** Hanken Grotesk (with Helvetica Neue, Arial)
**Label/Mono Font:** Martian Mono at width 80 to 82% (with ui-monospace, SF Mono, Menlo)

**Character:** A condensed poster face for titles and stamps, a plain grotesk for reading, and a narrow mono for every legend, code, time and plate, like the print on a piece of equipment.

### Hierarchy
- **Display** (900, 64px, 0.9): the page title, uppercase, printed in ink on the ground. It drops to 48px at 640px and below.
- **Wordmark** (900, 34px, 0.06em): "DOCKET" at the top of the panel. 30px when the panel lies across the top.
- **Title** (700, 21px): the name of the main object in a module, such as the printer name.
- **Body** (400, 16px, 1.45): all reading text and field values.
- **Note** (400, 14px): secondary text. 14px is the minimum for text that is not a legend.
- **Key legend** (600, 13.5px, 0.12em, uppercase): lever key and push key legends.
- **Plate** (600, 12px mono, 0.08em, uppercase): module plates, with the plate number at the left and the name at the right.
- **Label** (400, 12px mono, 0.06em, uppercase): small printed labels and switch legends.
- **Mono data** (600, 14px mono): times in captions, codes, schedule lines under a row title.
- **Stamp** (734, 14px, 0.12em, uppercase): rubber stamps (Printed, Canceled, Failed).

### Named Rules
**The Capitals By CSS Rule.** Write legends, plates, titles and stamps in sentence case in the source. CSS sets the capitals. Unit symbols inside a legend keep their case ("2 h", "274 px").

**The 12px Floor Rule.** 12px is only for mono legends in capitals. All other text is 14px or larger.

## Layout

The navigation panel stands at the left, 236px to 268px wide, and stays in view while the page scrolls. The content column is beside it, left-aligned, at most 1180px wide, with 40px top, 48px side and 72px bottom padding above 875px, 32px sides from 640px, and 16px sides on phones. Studio and Tape use the full width.

At 875px and below the panel lies across the top: wordmark and Dark switch, then the lever keys in one row that scrolls sideways, then the printer line and Sign out. A short window (876px and wider, 720px or less tall) tightens the panel so its foot stays in view.

The page title row holds the title at the left and any mono aside and keys at the right, with 40px under it (28px on phones). On Home, the receipt roll column is 624px (576px image plus 24px paper margins) and the modules stack in a column of 300px or wider at the right.

Spacing steps: 6px between a field label, control and hint; 12px between items in a padded module body; 14px by 16px inside a row; 40px under a page title. Keys and switches are 44px or taller; compact keys in rows are 38px.

## Elevation & Depth

Depth comes from material and light, never from a floating card. Every part is lit from the top. Panels carry a soft multi-layer shadow and a faint hammer finish. Plates and cutouts are inset. Keys show depth through gradient edges that change with the press depth (`--d`, 0 to 1), not through a drop shadow. Paper carries a soft drop shadow and torn edges.

### Shadow Vocabulary
- **Module** (`--hw-module-shadow`): four soft layers for a painted module on the ground.
- **Panel edge** (`--hw-side-edge`, `1px 0 0 rgba(30, 28, 24, 0.18)`): the right edge of the navigation panel.
- **Plate** (`--hw-plate-shadow`, `inset 0 -1px 0 #0e0d0c`): the lower lip of a label plate.
- **Field** (`--hw-field-shadow`): an inset top line and a light lower lip.
- **Key cutout** (`--hw-keys-cutout-shadow`): the recess that holds push keys.
- **Paper** (`--hw-paper-shadow`): three soft drop shadows under a receipt.

### Named Rules
**The Lit From Above Rule.** All light falls from the top. A gradient on a part models that light on its material and is never decoration.

**The Soft Shadow Rule.** Shadows are soft and close. Hard offset shadows are not part of this world.

## Shapes

Corners are machined, not soft: 2px on modules, plates, fields and push keys; 4px on the key bank housing, the key cutout and the free end of a lever key; 1.5px on a stamp. The LED and its collar are the only circles. Rows are separated by a 1px dashed rule, and the last row of a module has none. Receipts have torn top and bottom edges. A stamp is rotated (-3deg, or -1.2deg on alternate rows).

## Components

### Buttons (push keys)
Matte keys that sink straight down.
- **Shape:** 2px corners, 46px tall, in a shared dark cutout with 2px gaps (`keys-cutout`).
- **Default:** key tone with mottle and grain, uppercase legend. An icon prints in line with the legend, 9px apart.
- **Hover / Active:** press depth 0.2 on hover and 1 on press: the key moves down 1px in 0.06s ease-out and its edge shading changes. A held key (`hw-push--down`) stays at depth 1. Focus is a 2px ink outline 4px out.
- **Print key:** the one red key on a screen, on the key that commits a print.
- **Compact:** 38px, for rows. **Large:** 60px, only for Stop while Tape records.
- **Disabled:** depth 0, worn legend.
- **Destructive keys** (Remove, Revoke, Delete) are matte keys that take two presses. They are never red.

### Lever keys (navigation)
A bank of long keys in a black plate, pivoting under the plate rim at the left. Each key has a flag window at the left that is dark, and red for the current page. The current key is held down: its free end dips into the cutout (rotateY up to 9deg, 0.09s ease-out) and stays down for the page. Hover gives depth 0.3.

### Modules (cards)
A painted panel with a black label plate as its heading (an `h2`).
- **Corner Style:** 2px.
- **Plate:** mono 12px uppercase, a plate number at the left (hidden from assistive tech) and the section name at the right. Number the modules of a page 01, 02, 03 in reading order.
- **Body:** padded (18px 16px 20px, 12px gaps) or flush for rows edge to edge.

### Rows
A line on the panel: title (600) with a mono uppercase sub-line in muted ink, and a control or stamp at the right. A row that holds a 44px control uses the tight padding. A row that is off prints in faint ink. Rows with a thumbnail top-align.

### Inputs / Fields
- **Style:** 46px, 1px field-edge stroke, 2px corners, mono 16px value, inset shadow.
- **Focus:** 2px ink outline 2px out, field turns white.
- **Error:** red border plus a 1px red ring, error text 14px 600 in red. **Disabled / read-only:** a darker fill.
- **Select:** a drawn chevron 13px from the right.

### Slide switch
A black ribbed cap in a slot cut into the panel, with OFF and ON printed in mono beside it. The cap position is the state; the orange mark shows only at ON. The cap moves in 0.12s ease-out and gives 1px to 4px under the finger. Target height 44px. Used for slips and the Dark theme.

### LED
A 3mm diffused LED, 14px with its black collar. Off: green-tinted epoxy. On: lime glow with no halo on the panel. A red LED marks printing and live audio.

### Rubber stamp
Big Shoulders in a 1.5px border, rotated, with uneven ink. Printed (ink), Canceled (lighter ink), Failed (red). A stamp on paper keeps the light inks.

### Paper and printer edge
The printer front edge (a 3-slice sprite, 56px tall) spans the roll column. Slips feed out under it at true size (576px image, 24px side margins). The newest slip is fed out and turned 0.25deg. Paper is white with grain and head streaks in both themes.

### Thumbnail
A small receipt on white paper with 4px padding and a 1px soft ring, cut off at the bottom when long.

## Do's and Don'ts

### Do:
- **Do** use the `hw-` kit classes and the `components/hardware/` parts before you write new CSS.
- **Do** put every theme-dependent value in a custom property on `:root` and override it under `html[data-theme="dark"]`.
- **Do** print text on the ground with the ink treatment and text on a panel plain.
- **Do** number module plates 01, 02, 03 in page order and set hardware legends in uppercase tracked type.
- **Do** keep receipt images at 576px wide and pixel-exact.
- **Do** keep keys and switches 44px or taller.
- **Do** remove masks and blends under `forced-colors: active`, and remove transitions under `prefers-reduced-motion: reduce`.

### Don't:
- **Don't** use stat cards, a sidebar of icon links, pills or chips in the interface.
- **Don't** use hard offset shadows or gradients that do not model light on a material.
- **Don't** make a key red unless it commits a print, and don't make On red.
- **Don't** use fades or springs; motion is short mechanical travel.
- **Don't** add a button that repeats the default action of an object that is already clickable.
- **Don't** set text that is not a mono legend below 14px.
