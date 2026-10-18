# Docket: dashboard design spec

The source of truth for building the dashboard UI. It describes what is
built. Update it in the same change as the UI.

## Identity

The dashboard is the printer's own control deck. Each tool page is one
machine, with its controls built into the housing. Nothing is a loose
card on the mat. This is the units direction, approved on 2026-10-16
from the units labs: the parts kit, the nav unit on its track, Home,
Studio, Photo and History. The other pages (Slips and the slip pages,
Printer, Queue, Users, Tape, Login and Invite) use the same parts. A page
is made of these parts:

- the ground: warm grey graph paper in light, a dark cutting mat in
  dark;
- machine bodies: Leica satin silver in light, black paint in dark, with
  rolled edges and plates joined by seams. Names and legends are
  engraved and filled with paint;
- the nav unit: lever keys with red flag windows, on a slim track with
  two knurled rollers;
- tape-deck keys that stand in one well under a black legend strip, with
  the red print key last;
- counter windows with digit drums and a thumbwheel;
- slide switches with an orange ON mark, short sliders, the satin Leica
  push key, and the Capture release with its red dot;
- the lime LED in a black collar;
- screens and fields behind windows cut through the plate;
- receipts on white thermal paper at real size (a 320px slip, the print
  at 288px) that stand out of a platen, and record sheets of uncoated
  stock on the mat (History).

A part gets its depth from its material: the grain and tone of the body,
soft contact shadows, and sprites rendered offline in one light from
above and a little to the left (`public/hardware/kit/` and
`public/hardware/nav/`, each with its origin embedded). Do not use stat
cards, a sidebar of icon links, pills, chips, decorative gradients or
hard offset shadows.

Text on a body is engraved (`.pk-engr`, `.pk-name`): capitals by CSS,
with a little paint wear. Hints and details on a plate are printed in
sentence case (`.pk-note`). Text on the mat (Home's heading and
captions) is printed ink (`.hw-ink`) that multiplies into the stock.
Text on a record sheet is typed into the stock (`.pk-sheet-ink`).

Wordmark: DOCKET, engraved and filled with paint, in Big Shoulders 640.
It is 31px on the nav unit's top plate, 25px in the phone bar, and 42px
on Login and Invite.

## Type

Three faces, loaded with next/font in `app/layout.tsx`:

| Face | Token | Use |
|---|---|---|
| Big Shoulders, opsz 72 | --font-display | the wordmark (640), stamps (734) |
| Hanken Grotesk | --font-sans | body 16px; notes 14px (500); engraved legends 11.5px (600, 0.15em); page names 19px (600, 0.32em); key legends on the strip 10.5px (600, 0.14em); lever key legends 12px; row sub-lines 10.5px; drum digits 17px (600, tabular) |
| Martian Mono, 82% width | --font-mono | times, dates, codes, counts and values; plate numbers 11px; the version; field values 16px; the Studio code; status lines on screens |

- Body text is 16px. Notes and secondary text are 14px or larger.
- Engraved legends on hardware parts are 10.5px to 12px, in spaced
  capitals. Use these sizes only for legends on parts, not for
  sentences.
- Use mono for data only: times, dates, codes, counts and measured
  values. Do not set prose in mono.
- Capitals come from CSS, and only on hardware legends: engraved names,
  key legends, switch legends, stamps and row sub-lines. Write sentence
  case in the source, so accessible names read normally.
- Do not use icons on the parts. Legends are words.

## Color tokens: light and dark

`app/kit.css` holds the parts-kit tokens (`--pk-*`, and `--tk-*` for the
track): light on `:root`, dark under `html[data-theme="dark"]`. The
color tokens:

| Token            | Light    | Dark     | Use                                         |
|------------------|----------|----------|---------------------------------------------|
| --pk-face        | #dadad6  | #1c1c1c  | the body: satin silver, black paint         |
| --pk-fill        | #191918  | #e4e1d9  | engraving fill: names and legends           |
| --pk-fill-soft   | #3b3a37  | #b9b5ac  | the softer fill: states, sub-lines, notes   |
| --pk-red-fill    | #a8281b  | #e2604a  | red engraving and red notes (accent rules)  |
| --pk-focus       | #161616  | #ece9e2  | focus rings                                 |
| --pk-strip       | #161615  | #0c0c0c  | the legend strip above a key well           |
| --pk-strip-ink   | #ebe8e1  | #dedad2  | key legends on the strip                    |
| --pk-drum        | #1c1b19  | #161514  | counter drums                               |
| --pk-drum-ink    | #e9e5dc  | #e2ded5  | digits on the drums                         |
| --pk-nav-legend  | #2c2a26  | #dcd8cf  | legends on the lever keys                   |
| --pk-sheet-ink   | #1f1e1c  | #e0dcd3  | text typed on a record sheet                |
| --pk-eink        | #dcdad3  | dimmed   | the e-ink screen (light)                    |
| --pk-eink-ink    | #23221f  | dimmed   | ink on the e-ink screen                     |

The materials are tokens too (`--pk-key-up`, `--pk-well`, `--pk-platen`,
`--tk-track` and others). Each one points at the light or the dark
sprite. In dark, `--pk-eink-filter` dims an e-ink screen, and the editor
screens and the fields change to the dark screen.

`app/globals.css` keeps the base tokens of the earlier E design. The
pages read only these:

| Token            | Light    | Dark     | Use                                         |
|------------------|----------|----------|---------------------------------------------|
| --ground         | #e8e6e1  | #262522  | the mat, and the body color for overscroll  |
| --printed-ink    | #262420  | #e2ded4  | ink printed on the mat (`.hw-ink`)          |
| --paper          | #fefefe  | #fefefe  | receipt paper                               |
| --ink            | #161616  | #ece9e2  | the Tape pitch trace                        |
| --ink-muted      | #4a4741  | #b5b1a7  | the Tape playhead, Photo's levels plot      |
| --ink-faint      | #5d5a53  | #a29e94  | the Tape pitch trace                        |
| --red            | #b3261e  | #f27462  | the Tape trace, Home's Printing caption     |

Do not use the other base tokens (`--panel`, `--key`, `--plate` and
the rest) in new code.

Ground: `.hw-ground` in `app/hardware.css` draws it on every page. In
light it is graph paper printed on a warm grey stock. In dark it is a
cutting mat with a fine pebble and the same grid printed in light grey
ink.

Dark mode is the black edition of the same machines, under one dimmer,
warmer light from the top left. Its rules:

- Text on the mat is light ink that covers the mat. Stamps print in
  light pigment inks: white, grey for Canceled, light vermilion for
  Failed.
- Bodies are black paint with the same rolled edges. Engraving is filled
  with light paint.
- Keys are dark grey moulded plastic with pale legends. The print key
  stays matte red.
- Every sprite has a dark edition (`*-dark.png`). A lit LED throws a
  small pool of light onto the plate.
- Receipts and thumbnails stay white paper, a little dimmer than in
  light. The Studio preview keeps its exact dots. Photo's display keeps
  every dot and dims its white a little more. A stamp on a receipt
  keeps the light inks.
- Focus rings are a light line (#ece9e2). Selected text shows dark on a
  light block. Native scroll bars and menus use the dark scheme.

Theme: the Dark switch on the nav unit (see Shell); the choice persists
in localStorage.

### Accent rules (strict)

Three accents, each with fixed jobs. Everything else is the body, the
engraving and the paper.

Red appears ONLY as (the red rules):
1. the current page: the red flag window of the held lever key on the
   nav unit;
2. printing: the red LED and "Printing" in the red fill;
3. failures and error text, and the FAILED stamp;
4. waiting jobs: the "N waiting" link on Home;
5. the print key: the one red key in a well, always last, on the key
   that commits a print (Print test, the Studio's Print, Photo's Print,
   History's Reprint, Tape's Print take);
6. the red dot on Photo's Capture release (a fixed part of that part);
7. live audio that is running: the Tape tool's REC word and the lit LED
   in its Record key's legend strip while the mic records, and its
   playhead while a clip plays (hardware that runs, the same family as
   "printing");
8. the Tape tool's selection halo, the one contour around the glyph you
   edit (only one glyph is selected at a time).

Green is the online LED and nothing else. Orange is the ON mark of a
slide switch and nothing else. On is the position of the switch and its
orange mark, never red: a working slip is normal, not an alert. Done is
the PRINTED stamp. A key that does not print is never red, and that
includes destructive keys: Remove, Revoke and Delete are matte keys that
take two presses.

## Layout and spacing

- Content column: beside the nav unit, left-aligned, content at most
  1180px wide. Padding is 40px top, 48px sides and 72px bottom above
  875px; 32px sides from 640px; 16px sides on phones. The Tape tool
  (/tape) uses the full width.
- A body's rolled edge reaches 26px outside its box (31.5px below). Keep
  that room round a body. The page gutters give it.
- Plates: the content is 30px in from the body's sides (16px at 639px
  and below), with 22px at the top and the bottom. A head plate is 58px
  or taller, with the engraved name at the left and the lamp at the
  right. A seam joins a plate to the plate above it.
- Numbered plates: the number is engraved in mono before the name ("01
  Waiting"). The numbers count the plates of the page in reading order.
  Screen readers get only the name.
- Rows: 48px or taller. Ruled rows have 12px of padding and an engraved
  line between rows. Rows with a thumbnail top-align their content to
  the thumbnail. Only single-line rows centre vertically.
- Keys: 46px tall and 88px wide (the print key 104px). A compact well
  for the actions of a row is the same well at 72%. At 639px and below
  a well of more than one key runs the width of the body.
- Phones: at 875px and below the nav unit is a bar across the top (see
  Shell). At 639px and below the gutters are 16px, list rows put their
  stamp, time and keys under the text, and thumbnails are 68px wide. The
  Studio, Photo and Tape dock their main keys in a bar at the bottom of
  the screen, made of the body's metal. The pages use the same parts and
  wrap more. There is no separate phone design.

## Components

The parts kit is the one kit for every page. Its components are in
`components/hardware/kit/` (one file per group, no barrel file) and its
classes (all `pk-`, and `tk-` for the track) in `app/kit.css`. The paper
slip and the thumbnails are in `components/hardware/kit/slip.css`, which
loads with the Slip and Thumb components. Pages add layout around the
parts. A new look for a part goes into the kit, not into page CSS. The
key sprites are one set for every page: do not add page copies.

- Body, Plate, PlateTitle (`body.tsx`): one machine body, its plates
  (`head` for the 58px head plate, `seam` for a joint with the plate
  above), and a plate's name with its engraved number.
- Engraved, PageName, Note (`engraved.tsx`): engraved text (`soft` and
  `red` fills), the engraved page name (the h1), and a note printed on
  the plate in sentence case (`red` for an error line).
- Led, Lamp (`led.tsx`): the LED (online lime, printing and error red,
  offline unlit; a red lens that is off shows dark red) and the lamp, an
  LED with its state engraved beside it.
- KeyWell, Key (`keys.tsx`): tape-deck keys in one well, with the legend
  strip above the keys. The legend is inside the button, so it is the
  accessible name. `print` makes the red key, last in the well. `down`
  holds a key down by state; `pressed` latches it (`aria-pressed`). A key
  with `href` is a link. `compact` is the well at 72%; `fill` shares the
  width between the keys. A disabled key keeps its material and shows a
  dim legend. A key never repeats the default action of an object that
  is already clickable.
- CounterWindow, Drum (`counter-window.tsx`): a window with one digit
  drum for each character, the next digits turning away above and below.
  Display only.
- Counter (`counter.tsx`): a counter window with a thumbwheel, to pick
  from a list. The wheel's top half steps back and its bottom half steps
  on. The mouse wheel and the arrow keys step it too. A click on the
  window opens the native select, which is also what assistive tech
  reads. There is no drag.
- Switch (`switch.tsx`): a switch role. `onoff` prints OFF and ON and
  paints the orange mark at ON; `mode` prints two mode names (Template
  and Data). The position of the cap is the state. With `onToggle` it
  moves at once, waits for the server, and goes back if the save fails.
- Fader, LeicaKey, Shutter (`controls.tsx`): the short slider (a slot,
  a ribbed cap with a white index line, end ticks, and a centre tick
  when it is centred); the satin Leica push key (Sign out, Back); the
  Capture release with its red dot (locked, matte, when it cannot act).
- Screen, Leather, Platen, PrinterBlock (`screen.tsx`): a screen behind
  a window in the plate (`eink`, `dark`, `lcd`, or `editor`, which is
  e-ink in light and the dark screen in dark), leatherette, the
  teleprinter platen that a slip stands out of, and the printer's front
  edge.
- Slip, Thumb (`slip.tsx`): the slip at real size (320px, the print at
  288px) with torn ends (`new`, `old`, `solo`, `top`), and `exact` for
  the Studio and Photo previews (no grain). A thumbnail is a small slip
  torn at both ends, 84px wide (68px on phones), cut at 112px (96px).
- Field (`field.tsx`): an engraved label over a window cut through the
  plate. The value is typed on the screen in 16px mono (e-ink in light,
  the dark screen in dark). A hint and an error print on the plate under
  it and are tied to it with aria-describedby. An error underlines the
  screen in red. A read-only value dims. A textarea is 96px tall and a
  select has a drawn chevron.
- Sheet, SheetRows, SheetRow, Rows, Row, RowText (`sheet.tsx`): a record
  sheet of uncoated stock on the mat, with a printed band (its number at
  the left, its name at the right) and dashed printed rules between
  entries; and rows on a plate (`ruled` for an engraved line between
  rows), with an engraved name over a softer sub-line.
- Stamp (`components/hardware/stamp.tsx`): PRINTED and CANCELED in ink,
  FAILED in red, in Big Shoulders capitals with thin, uneven ink and a
  slight rotation. `paper` keeps the light inks for a stamp on a
  receipt.
- Two-press actions: Remove, Leave, Revoke and Delete show Keep and the
  named action ("Remove printer") after the first press.

From the earlier E kit only these remain, in `app/hardware.css`: the
ground (`.hw-ground`), the content column (`.hw-main`), the skip link
(`.hw-skip`), printed ink on the mat (`.hw-ink`, `.hw-caption`,
`.hw-link`) and the Stamp.

Motion: short mechanical travel, 0.06 to 0.12 s, ease-out. Keys sink
into the well, the current lever key dips lengthwise, the switch cap
slides, the thumbwheel turns one frame for each step, and the track
rollers turn as the page scrolls. There are no fades, no springs and no
pulsing skeletons. Reduced motion turns the travel off and holds the
rollers still. The one exception is the Slips feed module, where each
part moves like its real mechanism (the paper in steps, the carriage on
its motor, the roller turning with it), described under Slips.

Focus: every control shows a 2px ring in --pk-focus (ink in light, a
light line in dark). The ring goes round a key and its legend strip;
3px out round a switch, a counter window, a field window and a Leica
key; round the cap of a slider; and inside the lever keys of the nav
unit.

## Shell

The app is a Next.js React app. The nav unit holds the main navigation.
There is no header bar. The identity, type, tokens, accent rules, layout
and components above apply throughout. Shell rules:

- Nav unit (`components/app-sidebar.tsx`, classes in `app/kit.css`): a
  `<nav aria-label="Main">` made as one parts-kit body. From the top:
  - the top plate: DOCKET engraved and filled with paint, and the app
    version engraved small in mono ("v0.1.0");
  - the key bank: long lever keys in one well, one key for each page:
    Home, Slips, Studio, Photo, Tape, History, Printer, and Users for
    admins. There are no icons and no Queue key. Each key has a flag
    window in the plate at its left. The key for the current page stays
    down: its far end dips into the well and its flag window shows red.
    Home is current only on "/". The other keys are current on their
    path and the pages under it;
  - a seam, then the foot plate: the printer line, the Dark switch (OFF
    and ON engraved, the orange mark at ON) and Sign out (the wide Leica
    key, a plain link).
- Printer line: an LED and the printer name engraved, with the state
  engraved under it in the softer fill. Online is the lime LED. Printing
  (an online printer that holds a job) is a red LED and the state in the
  red fill. Offline is an unlit LED. No printer: an unlit LED and "No
  printer". The line streams in after the page and is empty until then.
  A failed read leaves it empty. It shows the state at the last full
  page load or refresh.
- Above 875px the unit is a column 222px wide at the left (the dock is
  284px). It stays in view while the page scrolls, and scrolls on its
  own when the window is too short for it. It rides a slim satin track
  that is screwed to the mat and runs the full height of the page, so
  the track scrolls with the page. Two small knurled rollers in the
  track's slot, one above and one below the unit, turn as the page
  scrolls (scroll-driven CSS). With reduced motion they stay still.
  Contact shadows mark where the unit sits on the track.
- At 875px and below the unit is the phone bar: a body across the top,
  16px from the screen edges, in three rows. The rows are DOCKET and the
  version with the printer line at the right; the keys in one strip that
  scrolls sideways under the plate; and the Dark switch and Sign out.
  There is no track. The strip snaps to whole keys and always shows part
  of the next key at its end (4.3 keys at 390px; all of them from 700px
  of strip). The flag windows sit in the plate above the keys. The
  current key moves to the start of the strip on each page. A key that
  gets the focus slides fully into the strip.
- Skip link: "Skip to content" is the first focusable item. It shows as
  a black label at the top left when it has focus, and moves focus to
  the content column, the only `<main>`.
- Content column per the spacing system.
- Loading: while a page's data loads, the nav unit stays and the content
  column shows a still skeleton (no pulse, no red): one body with a
  blank head plate (a faint bar where the name is engraved), then a
  plate with three ruled rows. Each row has a blank white paper
  thumbnail, a name bar and a shorter bar. Only a screen reader gets the
  word "Loading".
- Theme: data-theme on <html>, persisted under the localStorage key
  docket-theme, with a no-flash bootstrap so the first paint matches. The
  Dark switch shows the stored position after the page loads.
- Times: the server formats dates and clock times in the viewer's time
  zone, from the "tz" cookie that the browser sets on the first visit
  (the page refreshes once then). A slip's next run shows in the slip's
  own time zone.
- Tab title: "{Page} · DOCKET" ("DOCKET" alone where a page sets none).
  Favicon: a black plate with one light key and a red flag
  (`app/icon.svg`).
- Receipts at real size (`components/hardware/kit/slip.tsx`): a receipt
  shows as a 320px slip with the print at 288px (the 576 dots at half a
  pixel each). On Home, the slip pages and the Studio it stands out of a
  platen. On Home the platen is in the top edge of the printer body.
  History's open record lies on the day's sheet, torn at both ends.
  Photo shows its print on the camera's display at the same size. These
  slips have the paper look: grain, torn ends and a soft shadow, with a
  slight tilt on Home and History. The Studio's slip and Photo's display
  are exact: no grain, filter or tilt on the image, so the dots are the
  printer's. Thumbnails (see Slip, Thumb) are on Queue and History. The
  Slips index shows the top of each receipt in a window cut through the
  plate. The Tape strip shows the 576 dots at 0.75px each (see Tape).

## Pages

Every page lives in the shell above, beside the nav unit. The specs
below describe each page's content.

### Home
One desk on the mat: a heading, the printer as one machine body, and
today's slips at real size (a 320px slip, the print at 288px).
1. Heading: "Today" inked on the mat (19px, 600, spaced capitals, the
   same letters as an engraved page name). Today's date is at the right
   in mono capitals ("FRI 16 OCT 2026", the viewer's time zone).
2. The printer body (`.hm-unit`, 384px): the platen is in its top edge
   and the newest slip of today rises out of it, torn at the top. The
   slip's caption is printed on the body under the platen. The top of
   the newest slip is level with the tops of the slips on the mat. Then
   the printer plate: the printer's name engraved (it is the h2; a long
   name engraves on two lines) and its lamp (LED and state: Online,
   Printing in red, Offline). Under it, LAST SEEN, a counter window with
   two digit drums, and the unit engraved after it (SEC, MIN, HR, DAY;
   99 at most). "Not seen yet" when the printer never called. "N
   waiting" is a red link to the Queue at the right of that line when
   jobs wait. No printer: "No printer yet" engraved and an "Add a
   printer" link. Then a seam and the slips plate: one row per set-up
   slip, its name engraved, its next run or what makes it print under
   it ("Daily 06:30", "Each text"), and its slide switch (OFF and ON,
   the orange mark at ON). An account that has not opened Slips yet
   sees "No slips set up yet."
3. The slips on the mat: the slips torn off earlier, newest first,
   across then down. Each lies at a small tilt with a soft curl shadow.
   Each slip's bottom edge is the same tear as the top edge of the next
   newer slip (`home-tears.css`). Each caption is printed in ink: the
   time it printed (mono), the source ("Text messages", "Studio",
   "Reprint", "Test print") and a PRINTED stamp. A job a printer holds
   now has a red LED and "Printing" in red instead of the stamp. A
   receipt taller than 1100 dots is torn off there.
4. At most four slips show: one in the printer and three on the mat.
   More show as a "N more today" link to History. Nothing today: the
   platen is empty and the body says "Nothing printed today."
One lamp lights the desk from the top left. The far corner is a little
darker.
Widths (by the width of the content column, a container query): 1092px
and wider, two columns of slips and the printer at the right; 740px and
wider, one column of slips beside the printer; narrower, one column with
the printer and its slip first, then the slips on the mat. Nothing on
the mat: the printer is under the heading.
The page does not poll. It reads one bounded job listing (the 20 newest
printed and printing jobs), the printer (shared with the nav) and the
slip list. A switch refreshes the page.

### Slips
Everything the printer can produce, grouped by category. One page that
replaces the earlier Templates and Plugins pages.

Index: one machine body. The head plate has SLIPS engraved at the left
and the printer's lamp at the right (the LED and the state engraved
beside it; no lamp when the account has no printer). The deck plate
under it has two counters at the left: the number of slips, with SLIPS
engraved after the drums, and the number of slips that are on, with ON.
One key well is at the right with the New template key, which opens the
Studio blank. It is not red: it does not print.

Then one numbered plate for each category, in reading order ("01
Sports", "02 Daily", "03 Messages", "04 Templates"; a plugin with no
category goes under Other). Each slip is a row with an engraved rule
between rows:
- a window cut through the plate, with the top of the slip's receipt
  behind it (112 x 80px; 76 x 58px on a phone);
- the slip's name, engraved, and a softer engraved line under it: what
  makes a plugin's slip print ("Each goal", "Daily 06:30") or when a
  template was last saved ("Edited today", "Edited Tue 13 Oct");
- for a plugin's slip, its full description (it wraps) and its
  slide switch at the right.
The name is the link to the slip's page. Its target covers the whole
row, and the switch sits above it, outside the link. Hover underlines
the name; keyboard focus rings the row. On a phone the switch goes
under the text. With no slips, the body says "No slips yet. Make a
template in Studio."

Feed module: when the window is 1180px or wider, the category plates
take the left column and a feed module takes a 428px column at the
right, joined to them by a seam and running the body's full height.
Narrower windows show the rows only.
- A travelling printer rides down the module. The carriage runs on a
  rod at the module's left edge and on a flush way at its right (a white
  shoe), driven by a friction roller on the rod and a small motor. A
  flat cable from the carriage folds down through a brush strip into a
  slot in the deck. The cable's amber is the polyimide's material
  colour, not an accent.
- The slip under the pointer (once the pointer has rested on a row for
  120 ms) or under keyboard focus hangs out of the printer at real size
  (the 320px slip) from under the tear bar.
- Changing slips is stop-motion, like the printer's stepper motor. The
  slip in the printer steps back into the slot in quarters, then the
  next steps out in eighths, about 12 steps a second. The last row the
  pointer rests on wins.
- While the page scrolls, the printer holds 260px below the window's
  top. A motor drives it along the module at up to 420 px/s, so a fast
  scroll leaves it behind and it catches up without overshooting. Wheel
  steps glide (a 140 ms ease) instead of jumping.
- The drive roller turns with the carriage's travel. It is the only part
  that turns smoothly. Parts bolted to the deck stay still.
- The parts are Blender renders through a shift-lens camera: the eye
  550 mm above the page and 120 mm in front of the window's bottom edge
  (1 mm = 4px), its sensor parallel to the page. Flat things (the slip,
  the deck) stay at real size everywhere. Raised parts show true
  perspective, so near the top of the window the printer's front faces
  look taller and near the bottom they flatten. The head unit is
  rendered at 11 heights. One WebGL 2 canvas warps the nearest render to
  the printer's place using its height map, and mixes the light from the
  two renders either side. Only the feed module uses this camera; the
  rest of the dashboard keeps the kit's slanted view (the same camera
  with the eye infinitely far away).
- Light: one lamp above the window's top left, a soft white bounce card
  in front of the window's bottom edge (a tenth of the lamp's power),
  and the slip's paper bouncing light into the printer. Nothing is
  painted on: no drawn highlights.
- Reduced motion: no motor, no glide and no stepped feed. The carriage
  follows the scroll exactly and a single static render shows. Without
  WebGL 2 the static render shows too.

Slip page: one machine body. Nothing sits loose on the mat.
- The head plate has the slip's title engraved at the left, the platen
  in the middle, and at the right the Back key (a Leica push key: it
  goes to wherever you came from, Slips when there is no history) and
  then the printer's lamp. The slip's receipt
  (its primary template with its sample data) stands out of the platen
  at real size (a 320px slip). Its height comes from the receipt, so the
  body sits lower for a long receipt. No template: a blank slip that
  says "No template to preview yet." When the body is narrower than
  960px the platen has its own row, and the title and the Back key with
  the lamp are under it. Below 520px of body width the Back key and the
  lamp have their own row and the title is under them.
- The front plate has the description at the left (for a template slip,
  "Edited today") and the key well at the right, the red Print test key
  last. A template slip's well also has Edit (opens it in the Studio)
  and Delete. The status line prints at the left of the well ("Sent to
  the printer.", or the error in red).
- Delete has two steps. Delete asks on the status line ("Delete this
  template? Press Delete again."). Keep then takes the place of Delete
  and gets the focus, and Delete moves one key along. The store refuses
  a template that a plugin or the Photo tool prints with, and the
  refusal prints on the status line in red.
- For a plugin's slip, three numbered plates follow. 01 Schedule: the
  switch row (PRINTS, with what makes it print), the last run as a note
  (red when it failed), then a "Print time" field and a "Print time
  zone" field for a slip with a daily time, or "Check every" in seconds
  for a watcher. A slip that prints when a message arrives has no
  schedule fields. 02 Settings: one labelled field per config key, from
  the config's shape; lists are one item per line; numbers and booleans
  are checked against the plugin's defaults. One Save key closes the
  last of these plates. Save also works out the next run. Invalid input
  saves nothing and prints a red line beside the key that names the
  field by its label. The switch acts at once. 03 Templates: each
  template with an "Open in Studio" key in a compact well.
- On a phone a well of more than one key runs the width of the body.

### Studio
A teleprinter at /studio: one machine body in the content column
(`components/studio-editor.tsx`, `app/(dashboard)/studio/studio.css`).
- Head plate: STUDIO engraved at the left (the h1), the platen in the
  middle, and the printer's lamp at the right (the LED and the state
  engraved: Online, Printing in red, Offline, or "No printer"). While a
  print sent from the Studio is in the printer, the lamp shows Printing
  in red.
- The preview stands out of the platen at real size: a 320px slip with
  the print at 288px. Its pixels are exact (no grain). A paper window
  runs from the top of the content column down to the platen. A receipt
  taller than the window scrolls in it, and the window takes keyboard
  focus. The first preview renders at once, the next ones 400ms after
  you stop typing. A failed preview keeps the last good slip.
- The editor: a window across the full width of the body, with the
  screen behind it (e-ink in light, the dark screen in dark). The line
  numbers stay at the left when a long line scrolls sideways. A thin
  shade at the right edge shows that lines run on. The window shows
  whole lines, 8 to 30 of them, from the height of the browser window.
  The code is Martian Mono at 82% width, 14px on a 23px line (11px on a
  19px line on phones). The highlighted source is under a transparent
  textarea with the same font, size, line height, padding, tab size and
  wrapping, so the caret stays on the text. Token colours: tags in ink,
  attribute names in dim ink, strings in slate, property names a little
  dimmer, Liquid in umber on a faint wash, comments in light grey. In the
  data: keys in ink, strings in slate, numbers and literals in umber.
  Never red.
- The status line under the code: at the left, the language and the
  line count ("Liquid · 31 lines", "JSON · 33 lines"), and "edited" when
  the template is not the same as its saved copy. In the centre, the
  size ("576 × 400 px · 1-bit"), or the error in red (a Liquid or layout
  error, or "Data:" and the JSON error). At the right, the shortcuts
  ("⌘S save · ⌘P print"; Ctrl on other systems).
- The front strip, one step down: the Template/Data slide switch at the
  left, then the template counter (two digit drums, the name drum and
  the thumbwheel), then the key well: New, Save, Delete and the red
  Print key last. The wheel's top half steps back and its bottom half
  steps on. The mouse wheel and the arrow keys step it too. A click on
  the window opens the list.
- Edits stay with their template when you step to another template and
  back, until you leave the page.
- Messages ("Saved Daily Brief", "Sent to the printer", "Printed",
  "Print failed", a refusal) show on a small plate above the key well
  for 2.5 seconds. Screen readers announce them.
- Delete takes two presses. Delete asks ("Delete Daily Brief? Press
  Delete again."). Keep then stands in the place of Delete and gets the
  focus, and Delete moves one key back, to the place of Save. Escape or
  any other action keeps the template. The store refuses a template that
  a plugin or the Photo tool prints with, and the message names it.
- New opens a modal dialog: a small body with NEW TEMPLATE engraved, a
  Name field, and a well with Cancel and Create. Enter creates. Escape
  cancels.
- Print sends the draft as a job. The page then reads the job list every
  3 seconds (every 30 seconds after two idle minutes, stopped after
  thirty, never in a hidden tab) until that job ends. There is no poll
  when no print is followed.
- Keyboard: Cmd/Ctrl+S saves and Cmd/Ctrl+P prints. In the editor, Tab
  adds two spaces; Escape and then Tab moves the focus on.
- /studio?template=Name opens that template. /studio?new=1 opens New
  template.
- Narrow bodies: at 980px or less, the front strip has two rows (the
  switch and the counter, then the keys at the right). At 720px or less,
  the platen has its own row, and the name and the lamp are under it.
- Phones (639px and below): long lines wrap at the edge of the window. A
  thin bracket in the number column marks the rows after the first row
  of a line. The switch and the counter each have their own row. The key
  well docks in a bar at the bottom of the screen, made of the body's
  metal.

### Photo
A camera at /photo: one machine body in the content column
(`components/photo-tool.tsx`, `app/(dashboard)/photo/photo-tool.css`).
It is a print tool, not a plugin. The engine
(`components/photo-engine.js`) is carried over verbatim. Do not edit it.
The kit controls drive the engine's own controls, and read their state
back from the classes the engine sets.
- Upper plate: PHOTO engraved at the left (the h1), and the printer's
  lamp at the right (the LED and the state engraved: Online, Printing in
  red, Offline, or "No printer").
- The screen: a black-paint bezel set into the plate (black paint in
  both themes), and the display behind its glass. The display shows the
  print at print size: the 576-dot line in 288px, on an 80 mm slip 320px
  wide. The white is a little dimmer than paper, as on a backlit screen.
  The dots are exact.
- The status line under the picture, in mono: at the left, the mode
  ("1-bit", "Crop 4:3", "Crop free", "Live") or the engine's status
  ("Rendering…", "Queued", a failure in red). At the right, the size of
  the print ("576 × 511 dots · 64 mm"; 8 dots to the millimetre).
- The Edit / Preview switch on the bezel's chin. Preview shows the real
  /preview render of the "Photo Print" template. Edit shows the crop
  canvas: the photo, a white crop frame and corner handles over a 55%
  dim. Drag the frame or its corners. While the camera runs, the display
  shows the live view instead. The display keeps the height of the
  preview in each mode, so the body does not move when the switch
  flips. A print taller than 560px scrolls in the display.
- Before a photo, the display says "Press Load or Camera, or drop a photo
  here." (touch screens show the first part only). A file held over the
  body shows "Drop to load" on the display. The whole body takes the
  drop.
- Levels, beside the screen: LEVELS engraved, the Auto switch at the
  right, and a small screen (e-ink in light, the dark screen in dark).
  The screen shows the histogram of the cropped photo as LCD dots, the
  baseline, and the black and white points under it (a filled mark and
  an open mark). Drag a point to move it. This turns Auto off. The bars
  of the clipped tones show lighter.
- The sliders: Midtone, Shadows and Brightness in the left column,
  Contrast and Sharpen in the right column. The four that go from -100
  to 100 have a centre mark. The position of the slider is the value
  (assistive tech reads the number). Double-click a name to reset it.
- Crop: a counter window with a thumbwheel (Full, 1:1, 4:3, 3:2; "Free"
  after a drag or a turn). A ratio follows the orientation of the photo.
  Then the Rotate key (90° clockwise) in its own well.
- The sliders, Crop, Rotate and the Edit / Preview switch are disabled
  until a photo is in, and while the camera runs.
- Lower plate, past the seam: Caption (typed on a small screen), Size (a
  counter: S, M and L for 28, 36 and 48px), Bold (an on/off switch), the
  Capture release, then one key well: Load, Camera and the red Print key
  last.
- Load opens the file picker. Camera turns on the camera in the page
  (phones use the rear camera, not mirrored) and stays down while it
  runs. Press it again to turn the camera off. A page without the camera
  API opens the phone's camera through the file picker. A Web Worker
  dithers each frame at the 576 dots of the print, so the live view
  looks like the print.
- Capture is locked (matte) until the camera runs. Capture keeps the
  colour frame at full resolution as the source for edits, and the crop
  canvas shows it dithered.
- Print is disabled until a preview exists, and reads "Queuing…" while
  it sends.
- Narrow bodies: below 1040px of content width the gaps and the sliders
  get smaller. Below 940px the screen has its own row, in the centre,
  with the controls in two columns under it and the key well at the
  right of the lower plate. Below 600px everything is in one column.
- Phones (640px and below): the Capture release and the key well dock
  in a bar at the bottom of the screen, made of the body's metal.

### Tape
A tape deck at /tape: one machine body in the content column
(`components/tape/tape-tool.tsx`, `app/(dashboard)/tape/tape-tool.css`).
The Tape tool is a full-width workbench (as the Studio is). The body takes
24px more at each side and 8px more at the top, so its edges are on the
same lines as the bodies of the other pages. The canvases, the
controller and the renderer are a contract. Do not edit
`components/tape/tape-view.js`, `controller.js`, `store.ts`,
`components/tape-renderer.js` or `/api/tape/print`.

The page shows ONE of three MODES and only the controls of that mode.
No mode shows the controls of another mode grayed out.
- EMPTY (nothing on the deck): the window shows a blank strip of paper
  at its real width (the 432px print and its 18px margins, as a loaded
  tape), with paper grain. A note is printed on it in mono, in fixed
  ink, at the start of the strip: "Nothing on tape yet." (bold,
  capitals) and "Press Record, open a saved take, or press Demo to load
  a sample phrase." Under the window: one well with Record, Load and
  Demo (Demo loads the demo phrase), the time counter at 0:00.00 at the
  right, then 01 Takes.
- RECORDING: the paper hides. Only the real transcription writes the
  tape. It is never sketched. The raw pitch trace fills the screen:
  320px tall, linear time, and it follows the newest sound. The status
  line of the screen says "REC 0:12.40" (REC in red). Under the window:
  Record held down with its LED lit, Stop, Discard (stop without
  transcribing), and the time counter. A screen wake lock (best effort)
  keeps the display of a phone, and its mic stream, on through a take.
- LOADED: the full deck, described below.
The window keeps its place in every mode. Only the controls under it
change.

The body, from the top:
- Head plate: TAPE engraved at the left (the h1), and the printer's lamp
  at the right (the LED and the state engraved: Online, Printing in red,
  Offline). The lamp streams in (Suspense) from the reads the nav's
  printer line makes, so the page waits on no store read.
- The window: a cut through the plate with the editor screen behind it
  (e-ink in light, the dark screen in dark). The paper strip runs
  through the window from edge to edge, 20px under its top edge. Under
  the paper is the pitch trace, on the screen. Under the trace is the
  status line of the screen, in mono: at the left, the name of the open
  take ("Unsaved take" before a save); at the right, the phrase ("2
  phrases", or "Phrase 2 of 3" in focus) and the length of the take.
- The deck plate: a well with Record and Load, a well with the
  transport (Rewind, Play, Forward, Stop), the time counter and the
  Speed counter. Record has a 3 mm LED set into the legend strip before
  its name: a dark red lens, lit red while the mic is live. Record and
  Load start a NEW take. Load opens a hidden file input. Rewind and
  Forward move 5 seconds. Play stays down while the clip plays; press it
  again to pause. The time counter shows the playhead on drums
  ("0:02.35"), a colon and a point printed on its window. Speed is a
  counter with a thumbwheel (0.25×, 0.5×, 0.75×, 1×).
- The editor plate (once a take is decoded): NOTE engraved over a small
  screen that shows the selected note in mono ("A♯4 · 0:00.07–0:02.23",
  or "Ornament · 0:01.42" for an arc). With no selection the screen says
  "Pick a note on the tape." ("Switch to Full notation to edit." in the
  Main notes view). Then Prev and Next, and Undo (with the edit count,
  "Undo 3") and Redo at the right. Under them, two wells: Pitch −,
  Pitch +, Ornament and Slide; Split, Join, Cut before and Remove. The
  keys stay in place and a key that cannot act is disabled. Ornament,
  Slide and Cut before latch: a key that is on stays down, never red.
  The tooltips give the shortcuts. Under the wells is the keyboard hint
  ("Drag the tape to seek · Space play · ⇧< ⇧> 5 s · ← → note · ↑ ↓
  pitch · 0–9 phrase"), or "Tap the tape to seek. Tap a note to edit
  it." on coarse pointers.
- The front plate: the Take name field (placeholder "Take", the default
  name), then a well with Save take (Save and Save as new for a saved
  take) and WAV (download the recording). At the right, the print well:
  "Print N phrases" (when the take has phrases) and the red print key
  last, "Print take" ("Print phrase" in focus, "Queuing…" while it
  sends). Under them is the status line (the text of the controller;
  CSS capitalizes its first letter). An empty status line takes no
  room. In the empty and recording modes the status line shows on the
  deck plate, so a mic that fails to start is never silent.
- 01 Takes: ruled rows. Each take starts with its length on a small
  counter window ("0:09.02" on drums), so the counters line up down the
  list. Then its name engraved ("Open" under it for the open take), and
  a compact well with Open and Delete. On a phone a long name wraps
  under its counter and the well goes under the row, at the right. The open take's Open stays down. Delete shows
  Keep and Delete take, so a delete takes two presses. Deletes are SOFT:
  the take is hidden for 30 days before its files are purged (on list
  loads), the status line says so, and "Deleted “name”." with an Undo
  key restores it. With no takes: "No saved takes yet." The open take
  (or the unsaved session, "Unsaved take") lists its phrases under it,
  indented on an engraved rule: Song (All phrases) and one row per
  phrase ("Phrase 2" over "0:05.38–0:09.02", with "Edited" when it is
  frozen), each with Open (down when it is the current view) and, from
  the second phrase, Merge before it. The last row has "Cut at
  breaths".
- The settings plate, in two columns on a wide body (one column below
  760px of body width): 02 Key, 03 Detection, 04 View, 05 Layout. Each
  setting is a row: the name engraved at the left, the control at the
  right. A slider row shows its reading in mono under its name ("230 Hz
  / A♯3", "20 ms").
  - 02 Key: System is a slide switch (Western, Mugham). Western shows the
    Key select, which names every signature with its relative minor ("G
    major / E minor · 1♯"). Mugham shows the Mode and Tonic counters:
    the seven principal modes (Rast, Shur, Segah, Shushtar, Chahargah,
    Bayati-Shiraz, Humayun) on a chosen tonic. Each pick derives the
    best-fit printed signature (most shared pitches, ties to fewer
    accidentals then flats), and a note states it ("Segah on A prints as
    F major / D minor · 1♭."). Neutral quarter-tone degrees round to the
    nearest semitone for now, so the paper shows plain accidentals and
    the player adds the intonation. The interval rows are data in
    tape-renderer.js (MUGHAM_MODES), one line per mode.
  - 03 Detection ("Phrase N" at the right when the take has phrases):
    the Melody floor slider, read as "230 Hz / A♯3" (a note name, not
    bare Hz).
  - 04 View: Notation is a slide switch (Full, Main notes). Pitch trace
    is a counter (Hidden, Aligned, Linear). Trace stretch (a slider)
    shows in Linear only.
  - 05 Layout: the Time per row, Staff gap, Note width, Glyph size and
    Breath gap sliders.
Status during a decode: "transcribing… N%", then the line clears. There
are no note or ornament counts. While the decode runs, the session,
clip and transport controls are disabled, so they do not race it.

The paper strip. The paper canvas shows the exact rows: 576 dots across
at 0.75px a dot, so it is 432px tall. The paper look comes from a sheet
BEHIND the canvases, never from their pixels: white paper (the same in
both themes, as the canvas is), an 18px margin above and below the
printed rows (the 24 dots of unprinted paper), the long edges shading in
over the margins, and a soft shadow on the screen. The blank strip also
has the paper grain and faint bands along its length. A loaded strip has
neither, as the exact slips in Studio and Photo do not. The screen's
medium and glass lie under the sheet, and the sheet lies under the roll.
The roll is the scroll container. Do not put padding or a border on it.
Do not put width, height, transform, filter or zoom on it or on the
canvases, or a transform, zoom or filter on a box round them: the seek
and selection math reads the canvas rect. The roll holds the two
canvases and the playhead only. The empty note sits outside it. A take
past the width cap of the preview (about 14 minutes of sounding tape)
still prints whole. A note under the window then says "The preview stops
here. The print includes the whole take."

Notation glyphs (treble clef, key signature, accidentals, breath commas)
are engraved shapes rasterized from Bravura (SIL OFL), sized to the
staff. The take opens with bare paper, then the clef and key signature
before the first note. The canvases track the width of the roll through
a ResizeObserver and stay mounted in every mode (CSS hides them; the
controller holds their refs). The transcription is monophonic. While the
mic is live, only the raw pitch trace draws. When the take ends (Stop or
Load), a neural model (Basic Pitch, bundled, in the browser) transcribes
the recording. The decoder turns it into main notes, rearticulation
splits, slide connectors (a thin diagonal between pitches; a dip scoop
for a same-pitch slide), and ornament marks (a small backwards "c", an
arc that opens toward the earlier tape, above the staff at the attack of
every ornamented main note). Ornaments never render as small notes on
the staff. The arc is painted OVER the preceding tape, so main notes
stay close together. The preview shows the exact raster rows the printer
gets, in reading orientation: the staff horizontal, time from left to
right, new tape entering at the right. The strip follows the newest rows
unless you scroll back.

The pitch trace shares the x-axis and the scroll of the tape: it sits
under the paper in the same roll, 32px below the paper canvas, one
column per tape row. So the raw pitch that made a note bar sits directly
below that bar at any scroll position. Its ink comes from --ink,
--ink-faint and --red on <html> (tape-view.js reads them once at mount),
which suit the screen of the same theme: dark ink on e-ink, light ink on
the dark screen. Ink dots weighted by detector confidence, a thin
--ink-faint line for the committed note, and faint full-width reference
rows at A3, A4 and A5 (the duduk-in-A anchors). Its x-axis is sounding
time, as the tape's is: silence compresses. The View settings can hide
it.

Red on this page (red rules 5, 7 and 8): the LED in Record's legend strip
and the REC word on the screen while the mic is live, the playhead while
audio runs, the selection halo, and the print key.

The player: a playhead crosses both the tape and the trace. It is a
1.5px DOM overlay that spans the roll (never drawn into the canvases;
the tape canvas holds exact print bytes). While paused it is a dark line
over the paper and --ink-muted over the screen. While audio runs it is
red. The tape is not linear in time (silence compresses to a breath
mark, glyphs take rows with no time), so the playhead follows the
time-to-row timeline of the renderer: it sweeps steadily through notes
and skips across breath marks, as the ear does. Both panes are the
scrub surface (crosshair cursor): a mouse drag pauses and seeks, and the
release resumes playback if it was playing. A phone has no scroll bar,
so the drag belongs to navigation: a touch drag PANS the roll
(touch-action: pan-x) and only a TAP seeks (and selects, with a slack of
about 24px toward the nearest note; note bars can be 2px wide). While
playing, the roll scrolls to keep the playhead in view.

Editing: once a take is decoded, a click on a note selects it, and the
same click seeks. The selection is a red contour that TRACES the exact
shape of the selected glyph, its inner edge flush against the ink: a
sharp rectangle on the bar of a note (2.25px --red stroke), and on an
ornament arc the true crescent outline (1.5px), from the dilated ink of
the arc (red rule 8). It is painted over the preview only, never into
the print bytes. Split is enabled while the playhead is inside the
note. Edits keep the playback position. Both kinds of ornament arc
select the same way: standalone marks and the arc of a note's Ornament
flag. The small box of an arc hit-tests on both axes and wins over the
note band under it. A selected arc shows "Ornament · 0:01.42" and only
Remove acts on it (removing a flag arc turns the ornament of its note
off). Keyboard (skipped while a form control has focus, or when a
control already took the key): Space play/pause, ⇧< and ⇧> seek 5 s
(also Rewind and Forward), ← and → walk the notes, ↑ and ↓ move the
pitch of the selected note, 1 to 9 open a phrase and 0 the Song, O
toggles the ornament, J joins the next note, S splits at the playhead, C
cuts a phrase before the note, Esc deselects, Cmd/Ctrl-Z and
Shift-Cmd-Z undo and redo, Backspace/Delete removes the selected note.
Every edit renders the whole tape again from the edited timeline, so the
preview and the print bytes stay the same rows, and the roll keeps its
scroll position (only live recording follows the paper). Freeze on
edit: while a take has edits, the Melody floor slider is disabled, a
note says "Editing pauses detection. Start over detects the recording
again.", and a Start over key shows. Start over reads the recording
again and keeps the edited tape as a snapshot. Undoing every edit
unlocks the slider. Background work (the trace backfill) never replaces
an edited timeline.

Phrases: a song splits into phrases at CUTS, snapped to note attacks.
"Cut at breaths" seeds them (rests of 2× the Breath gap or more), and
Cut before toggles one at a note. Merge joins a phrase to the phrase
before it. Cuts and merges PARTITION the tape as it stands: the visible
timeline, edits included, is sliced or joined unchanged; a cut only adds
the caesura. Halves of an edited phrase keep those edits and stay frozen
("Edited" on its row) until Start over. The undo history resets at the
cut, and the state before the cut is kept as a snapshot. Each phrase is
a full take document: its own melody floor (Detection edits only the
ACTIVE phrase), edit log, undo and redo, versions and freeze state. A
phrase derives again as a standalone clip only on Start over or a floor
change. The song is the PROJECT and phrases are its pages. Song is the
overview: every phrase in time order with a printed CAESURA at each cut
(two parallel strokes slanting up-time above the staff, in place of the
breath comma). A note selected there makes its phrase active in place.
A phrase opens its OWN tape: its strip exactly as it prints, its own
detection settings and undo history, playback in its span only
(practice mode), and a print key that reads "Print phrase". Sessions
and loaded takes open on Song. A take with no cuts lists no phrase rows,
only Cut at breaths.

Print take queues the rendered rows as they are through /api/tape/print
(source "tape"). The key reads "Queuing…" while it sends, and the status
line answers in plain words ("sent to the print queue", never a raw job
id). Jobs carry the saved name of the take. A phrase prints as
'name · phrase 2 of 5'. "Print N phrases" queues every phrase as its own
receipt (each with a new clef and key signature). The jobs show in Queue
and History as other jobs do, but they are raw jobs (kind "raw": bytes,
no template), so History keeps its Reprint key off for them. Print again
from the tool.

Narrow bodies and phones. Below 960px of body width the counters move
under the wells. Below 900px the note screen and the Take name field
take their own lines, with the keys under them. At 600px and less, each
well runs the width of the body. Phones (639px and below): the
transport docks in a bar at the foot of the screen, made of the body's
metal (as the Studio and Photo key wells do), so Play and Stop stay in
reach while the tape is in view; the page keeps that much room at its
end. Coarse pointers get the touch hint. The page pads its bottom with
the safe-area inset. The modes, the blank strip and the full-height
recording trace are the same on every width.

### Queue
Not in the nav. The Printer page has a Queue key that links to it, and
Home's printer links to it while jobs wait. The page is one machine body
(a deck):
- The head plate: QUEUE engraved. At the right, the poll state engraved
  in the softer fill: "Updates every 3 sec" while the person is active,
  "Updates every 30 sec" after two idle minutes, "Paused" after thirty.
- The deck plate: WAITING, a counter window with the number of jobs that
  wait ("03") and JOBS (JOB for one). At the right, a key well with the
  Refresh key. Refresh reads the queue at once and starts the fast
  cadence again. Any pointer or key input also starts it again.
- Two numbered plates, in print order. Each name has an engraved line
  that runs to the right edge of the plate:
  1. Printing: the jobs a printer holds now.
  2. Waiting: the jobs in the order they will print.

Each job is a row, top-aligned, with an engraved line between rows: a
small torn thumbnail of the receipt on white paper, the job name (15px,
sentence case), then an engraved line in capitals with the time the job
was made (the viewer's time zone; "Yesterday 17:30" or "Tue 13 Oct
17:30" for an older job) and its source ("Text messages", "Studio"). A
printing job also shows a red LED with PRINTING in the red fill and
"Started 12 sec ago". A job that a printer handed back shows "N failed
attempts" in red ("1 failed attempt" for one). At the right, a compact
key well: Requeue for a printing job, Cancel for a waiting job. Requeue
puts a stuck job back at the front of the queue. From there it prints
again or you can cancel it. If the server refuses an action, a red line
shows in the row. If a printer takes a job before Cancel arrives, the
row says "Not canceled: a printer took it first." On a phone the key
well goes under the text.
From the third failed attempt of a job, each failure sends the job to
the back of the queue. The job then lists behind every job that was
queued before that failure and in front of all jobs queued after it.
That is where it will print.
Empty plates: "Nothing printing." and "Nothing else waiting." No jobs at
all: one plate, 01 Waiting, with "Nothing is waiting to print." and no
key.
The list reads `/api/queue` again at the cadence that the poll state
shows, only while the tab is visible. The page load also reads the slip
list once, to name each job's source.

### History
The deck (one machine body) is at the top. A record sheet for each day
is under it.

The deck has two plates. The upper plate has HISTORY engraved at the
left and the printer's lamp at the right: the LED and the state
engraved beside it (Online, Printing, Offline or No printer). The lower
plate has the receipt counter at the left: three drums show the number
of jobs under the filter, with RECEIPTS engraved after them. One key
well is at the right: All, Printed, Failed, Canceled, then the red
Reprint key. The current filter key is held down. Reprint is live only
while a record that can print again is open, and it prints that record.
Its status prints on the plate at the left of the well ("Sent to the
printer.", or the error in red). On a phone the deck stacks: the name
and the lamp, the counter, then the five keys across the body, with the
status under them.

Jobs are grouped by the day they printed (the time a printer took the
job; a job no printer took shows the time it was made), in the viewer's
time zone. Each day is a record sheet of uncoated stock on the mat. Its
printed band shows the day's number, counted from the newest day
("01"), and its label ("Today", "Yesterday", "Tue 13 Oct"). A day that
continues on the next page keeps its number and its sheet. Each sheet
lies a little differently (angle, offset, stock tone and the corner that
lifts), from a fixed table by the day's number.

Each job is an entry typed on the sheet, with a printed dashed rule
between entries. It has the receipt laid on the sheet as a small slip
torn at both ends (84px wide, cut at 112px), the job name, the source in
mono capitals ("Text messages", "Studio", "Reprint"), "N failed
attempts" when a printer handed the job back before it ended, and at the
right its rubber stamp (PRINTED, CANCELED, or FAILED in red) and the
time in mono. Each slip and each stamp lands at its own small angle. On
a phone the time and the stamp go under the name.

The whole entry is a button. It opens the job's record in place: the
receipt at real size (the 320px slip with the print at 288px, torn at
both ends, a little askew) lies on the sheet where the small slip was,
with the job's stamp pressed on its foot. The entry stays beside it
(above it on a phone). Press the entry again to close the record. One
record is open at a time: when you open a record, the open one closes,
and the entry you pressed stays where it was on the screen. Reprint
renders again from the stored template and data; it never sends old
bytes again. A receipt that a tool printed (a Tape print: bytes the tool
rendered, no template) keeps Reprint off, and its record says "Print it
again from Tape."

20 entries per page. When there is more than one page, a pager body
under the sheets shows PAGE, a counter with the page number, OF and the
page count, and the Newer and Older keys in one well. A key that has no
page is off.
Empty: one sheet with the filter's name on its band and "Nothing
printed yet.", "No failed jobs." or "No canceled jobs."
The page does not poll. It reads every ended job (with its failed
attempts), the slip list (to name each job's source) and the printer for
the lamp (the same read as the nav unit's printer line).

### Login
One small unit on the mat, centered, 400px wide at most
(`components/auth-unit.tsx`). There is no nav. The unit is one parts-kit
body with three plates:
- the top plate: DOCKET engraved and paint-filled (the nav's wordmark,
  42px) at the left, and "Sign in" engraved at the right;
- a seam, then the Email and Password fields (engraved labels over the
  field windows);
- a seam, then the front plate: the Sign in key in its own well at the
  right (a matte key: red is for printing). The key stays down while the
  request runs. A refused sign-in shows a red line at the left of the
  front plate, beside the key ("Invalid email or password.").

There is nothing else on the page. A signed-in visitor goes to Home.

### Invite (public, /invite/[token])
The same unit as Login, with "Create account" engraved in the top plate.
The middle plate holds the Name, Email and Password fields, with the note
"At least 8 characters" under the password. The front plate holds the
matte Create account key. The Email field is read-only (its text dimmed)
when the invite is for one address. A refused sign-up shows a red line
beside the key. A dead link (unknown, used, expired or revoked) lights
the red LED beside "Invite" in the top plate (the word in the red fill)
and shows one note in place of the form: "This invite link does not
work. It was used, it expired, or it was revoked. Ask an admin for a new
link." There is no front plate then.

### Printer
The printer's own front panel: one machine body.
- The head plate: PRINTER engraved. At the right, the lamp: the LED and
  the state engraved (Online with the lime LED, Printing in the red
  fill with the red LED, Offline with the LED unlit). The state is for
  the printer the account prints to (the first listed). A member of a
  shared printer sees that printer's contact.
- The status plate, below a seam. Three columns on a wide screen; they
  stack on a narrow screen:
  1. The printer's name engraved (14px), and LAST SEEN with a counter
     window of two drums and the unit engraved after it (SEC, MIN, HR or
     DAY; 99 at most on the drums). "Not seen yet." when the printer has
     not called in. No printer: "No printer yet" engraved and a note
     that tells how to pair one.
  2. Data engraved in two rows that align with the name and the
     counter: PAPER 80 MM · 576 DOTS and VERSION, the values in mono.
  3. WAITING with a counter window of the jobs that wait and JOBS (JOB
     for one), then a key well with the Queue key, a link to the Queue.
- Plate 01 Printers: one row per printer, with an engraved line between
  rows. Its name is engraved over a softer line ("Paired 3 min ago",
  "Shared with you", or "Pairing" while it waits for its token). At the
  right, a compact key well: Share and Remove for an owner, Leave for a
  member. Remove and Leave take two presses: the first key turns into
  Keep (it keeps the focus) and a wider key with the action follows it
  (Remove printer, Leave printer). Share mints a code and shows it in a
  read-only Share code field (20px mono) with the note "Works once, for
  15 minutes. The other account enters it on its Printer page."; an
  unexpired code shows again on reload. Under an owner's row with
  members: "Also prints for {email}" with a two-step Remove (Keep, then
  Remove account). A refused action prints a red line in the row. While
  a printer is pairing the page refreshes every 3s (visible tab only)
  until the printer collects its token. If the printer prints a new code
  after a code was entered but before it collected its token (it
  rebooted, or its 14-minute code rotation came round), that claim is
  void: enter the newly printed code. Empty: one note that covers both
  codes.
- Plate 02 Add a printer: a Pairing code field (mono capitals; its hint
  says that a share code from another account also works), a Name field
  ("Kitchen printer" as the example) and a key well with the Pair key
  (not red: red is for print only). On a wide screen they are in one
  row, and the key well's legend strip lines up with the field labels.
  An error prints in red under the Pairing code field and underlines the
  code in red ("Code not recognized or expired."). A pairing code from a
  printer that another account still holds is refused with "This
  printer belongs to another account. Its owner can remove it on their
  Printer page."

### Users (admin only)
One parts-kit body. The top plate holds "Users" engraved (the h1) and
the printer's lamp at the right (as the nav shows it; none when the
account has no printer). Then three numbered plates joined by seams.
From 1180px each plate's number and name sit in a 176px label column at
the left, with its rows or fields at the right; below 1180px the name
sits above them.
1. Accounts: one row per account, with engraved rules between rows: the
   name engraved over the email (printed in sentence case, 14px), and
   "Admin" engraved in the softer fill at the right for an admin.
2. Invites: one row per open invite link: "Anyone with the link" or "For
   one address" engraved, over a printed line with the email (if any)
   and the expiry date in the viewer's time zone ("jordan@example.test ·
   Expires Thu 22 Oct"). At the right, a compact key well: Copy link (its
   legend shows "Copied" for 1.5 s) and Revoke. Revoke takes two presses:
   the well then holds Keep and Revoke invite, and Revoke invite stays
   down while the request runs. If the browser does not let the page copy
   (a page that is not on https), the row shows the link in a read-only
   field. On a phone the keys go under the text, at the right.
3. New invite: an "Email (optional)" field, the note "With an email,
   only that address can use the link. It works for 7 days." directly
   under the field, and the matte Make invite key in its own well at the
   right of the field. On a phone the key goes under the note, at the
   right. After a new invite, the note says "Invite made. Copy its link
   above."

A refused action shows a red line in its row or plate. Empty: "No
accounts yet. Make an invite below." and "No open invites." Other
accounts see the same body with plate "01 Accounts" and one note: "Only
an admin can see accounts and make invites." The nav shows the Users key
to admins only, after Printer.

## Voice

Sentence case in the source everywhere. The wordmark and the hardware
legends print in capitals by CSS (see Type). No exclamation marks, no em
dashes in sentences (a lone dash marks an empty value), no jargon or file
paths in page copy. Errors say what happened and when ("calendar 401 · 2d
ago").
Empty states are short and plain ("Nothing is waiting to print.",
"Nothing printed yet.").
