# Docket: dashboard design spec

The source of truth for building the dashboard UI. It describes what is
built. Update it in the same change as the UI.

## Identity

The dashboard is the printer's own control deck. This is direction E,
approved on 2026-10-15 from the Home-E and System-E boards (and their
dark editions). Each page is a set of hardware parts on a printed ground:

- the ground: warm grey graph paper in light, a dark cutting mat in dark;
- painted panels with black label plates (modules);
- a bank of matte lever keys with a red flag window (the navigation);
- matte push keys in a shared dark cutout, with one red print key;
- an LED in a black collar;
- a ribbed slide switch with an orange ON mark;
- receipts on white thermal paper at true size, under the printer's front
  edge.

A part gets its depth from its material: soft shadows with an offset, a
hammer finish on the panels, and sprites rendered offline for the switch,
the LED collar and the printer edge (`public/hardware/`, each with its
origin embedded). Do not use stat cards, a sidebar of icon links, pills,
chips, decorative gradients or hard offset shadows.

Text printed on the ground (page titles, captions, dates) uses `.hw-ink`:
it multiplies into the stock and wears a little. Text on a panel is
plain. Legends on hardware parts (keys, plates, switch legends, stamps)
print in capitals with a little wear.

Wordmark: DOCKET in Big Shoulders 900, 34px, 0.06em letter-spacing (48px
on Login and Invite, 30px in the phone header).

## Type

Three faces, loaded with next/font in `app/layout.tsx`:

| Face | Token | Use |
|---|---|---|
| Big Shoulders, opsz 72 | --font-display | page titles (900, 64px, 48px on phones), the wordmark, stamps (734) |
| Hanken Grotesk 400, 600, 700 | --font-sans | body 16px, secondary text 14px, row titles 600, key legends (13.5px, 600, 0.11em) |
| Martian Mono, 82% width | --font-mono | times, dates, codes, counts, values, plate legends, fields, row sub-lines |

- Body text is 16px. Secondary text is 14px or larger.
- Use 12px only for mono legends in capitals: plates, labels and switch
  legends.
- Use mono for data only: times, dates, codes, counts and measured
  values. Do not set prose in mono.
- Capitals come from CSS, and only on hardware legends: key legends,
  plates, labels, switch legends, stamps, row sub-lines and page titles.
  Write sentence case in the source, so accessible names read normally.
- Icons: lucide-react outline icons, on the Tape keys and as chevrons
  only.

## Color tokens: light and dark

`app/globals.css` holds the values. The old names keep their roles and
take the E materials.

| Token              | Light    | Dark     | Use                                   |
|--------------------|----------|----------|---------------------------------------|
| --page, --ground   | #e8e6e1  | #262522  | the ground                            |
| --raised, --panel  | #f0efeb  | #2f2e2b  | the painted panel: modules, nav panel |
| --hairline         | #d8d5ce  | #44433f  | faint rules                           |
| --border           | #bdb9b0  | #4f4d48  | borders                               |
| --dash             | #a9a69e  | #5a5854  | dashed row rules                      |
| --ink              | #161616  | #ece9e2  | primary text                          |
| --ink-muted        | #4a4741  | #b5b1a7  | secondary text                        |
| --ink-faint        | #5d5a53  | #a29e94  | tertiary text, off rows               |
| --red              | #b3261e  | #f27462  | red text (see the accent rules)       |
| --printed-ink      | #262420  | #e2ded4  | text printed on the ground            |
| --key              | #ebe7de  | #4b4a46  | lever keys and push keys              |
| --key-red          | #b5422f  | #a93f2d  | the print key                         |
| --plate            | #262523  | #151413  | label plates, the key bank            |
| --plate-ink        | #dedbd4  | #e2ded4  | legends on plates                     |
| --cutout           | #151311  | #090807  | the cutout under the keys             |
| --field            | #f8f7f4  | #1b1a18  | field windows                         |
| --field-edge       | #2a2926  | #0d0c0b  | field edges                           |
| --flag             | #d8483a  | #d6473a  | the flag of the current page          |
| --legend-disabled  | #a29d92  | #85817a  | legends on disabled keys              |
| --paper            | #fefefe  | #fefefe  | receipt paper                         |
| --led-green        | #9be41f  | #9be41f  | the online LED                        |
| --switch-on        | #cf6d2f  | #cf6d2f  | the ON mark of a slide switch         |

The kit's own tokens (`--hw-*`, in `app/hardware.css`) read these and
hold the material values: finishes, shadows, sprites and inks.

Ground: `.hw-ground` in `app/hardware.css` draws it on every page. In
light it is graph paper printed on a warm grey stock. In dark it is a
cutting mat with a fine pebble and the same grid printed in light grey
ink.

Dark mode is the black edition of the same machine, under one dimmer,
warmer light from the top-left. The approved boards are Home-E-dark and
System-E-dark. Its rules:

- Text on the ground is light ink that covers the mat. Stamps print in
  light pigment inks: white, grey for Canceled, light vermilion for
  Failed.
- Panels are dark painted metal with the same hammer finish. Plates are
  black with a lit top edge. Fields are dark recessed windows.
- Keys are dark grey moulded plastic with pale legends. The print key
  stays matte red. The flag of the current page glows a little.
- The switch slot and cap, the LED collar and the printer's front edge
  are sprites rendered for the dark panel (`public/hardware/*-dark.png`).
  A lit LED throws a small pool of light onto the panel.
- Receipts and thumbnails stay white paper, about 5 percent dimmer than
  in light. The Studio and Photo previews keep their exact pixels. A
  stamp on a receipt keeps the light inks.
- Focus rings are a light line (#d6d2c8) that shows on the mat, the
  panels and the keys. Selected text shows dark on a light block.
  Native scroll bars and menus use the dark scheme.

Theme: the Dark switch in the panel (see Shell); the choice persists in
localStorage.

### Accent rules (strict)

Three accents, each with fixed jobs. Everything else is the ink, the
panel and the paper.

Red appears ONLY as (the red rules):
1. the current page: the red flag of the held key in the panel;
2. printing: the red LED and the word "Printing";
3. failures and error text, and the FAILED stamp;
4. waiting jobs: "2 waiting" on Home and Printer, "Waiting" in the
   Studio's recent prints;
5. the print key: the one red push key on a screen, on the key that
   commits its print (Print test, the Studio's Print, Photo's Print,
   Reprint, Tape's Print take);
6. live audio that is running: the Tape tool's REC word, the lit LED on
   its Stop key while the mic records, and the lit LED on its held Play
   key and its playhead while a clip plays (hardware that runs, the same
   family as "printing");
7. the Tape tool's selection halo, the one contour around the glyph you
   edit (only one glyph is selected at a time).

Green is the online LED and nothing else. Orange is the ON mark of a
slide switch and nothing else. On is the position of the switch and its
orange mark, never red: a working slip is normal, not an alert. Done is
the PRINTED stamp. A key that does not print is never red, and that
includes destructive keys: Remove, Revoke and Delete are matte keys
that take two presses.

## Layout and spacing

- Content column: beside the panel, left-aligned, content at most 1180px
  wide. Padding is 40px top, 48px sides and 72px bottom above 875px; 32px
  sides from 640px; 16px sides on phones. The Studio (/studio) and the
  Tape tool (/tape) use the full width.
- Page title row: the title, then any mono aside and keys at the right;
  40px under it (28px on phones).
- Modules: a module is a panel with a label plate. A padded body is
  18px 16px 20px with 12px between its items. A flush body holds rows
  edge to edge.
- Rows: 14px 16px with a 1px dashed rule under each row except the last.
  A row that holds a 44px control is 6px 14px 6px 16px. Rows with a
  thumbnail top-align all their content to the thumbnail; only
  single-line rows centre vertically.
- Targets: keys and switches are 44px or taller. Compact keys in rows
  are 38px.
- Phones (640px and below): gutters are 16px, page titles are 48px, list
  rows put their stamp, time and keys under the text, and thumbnails get
  smaller. At 875px and below the panel lies across the top (see Shell).
  The Photo tool goes to one column at 720px and below. The pages use
  the same components and wrap more; there is no separate phone design.

## Components

The kit is in `components/hardware/` (one file per part, no barrel file)
and `app/hardware.css`. The paper parts are in
`components/hardware/paper.css`, which only the pages that show paper
load. Every kit class starts with `hw-`. Pages add layout around the
parts. A new look for a part goes into the kit, not into page CSS.

- Module (`module.tsx`): a `<section>` with an `<h2>` label plate. The
  plate shows the number (if any) at the left and the title at the
  right, both in 12px mono capitals. Screen readers get only the title.
- Page title (`page-title.tsx`): the h1, printed in ink, with an optional
  mono aside and keys.
- Row and RowText (`row.tsx`): the title (600) over a 14px mono sub-line
  in capitals. An off row prints in the tertiary ink.
- Note, Label and ErrorText (`text.tsx`): 14px secondary text, a 12px
  mono label, and a 14px 600 red line for a failure. Links (`.hw-link`)
  are 600 and underlined; the underline gets thicker on hover.
- Field (`field.tsx`): a visible label above a 46px inset window in 16px
  mono. A textarea is 96px tall; a select has a drawn chevron. A hint
  and an error go under the window and are tied to it with
  aria-describedby. A read-only field shows a darker readout window.
  Focus: a 2px ink outline 2px out, and the window turns white.
- Push keys (`push-key.tsx`): matte keys in a shared dark cutout
  (KeyGroup). They are 46px tall, compact keys 38px, and the one large
  key 60px (Stop while Tape records). A pressed key sinks straight down;
  `down` holds it down (the current choice, or a toggle that is on). The
  red print key is the only red key. A legend can hold an icon. An LED
  sits at the left of the legend. A disabled key keeps its material and
  shows a faded legend. A KeyGroup with a legend is a fieldset: the
  legend is a field label above the cutout, or is for screen readers
  only. A key never repeats the default action of an object that is
  already clickable.
- Lever keys (`key-bank.tsx`): the navigation only (see Shell).
- Slide switch (`slide-switch.tsx`): a switch role with OFF and ON
  printed beside the slot. The position of the cap is the state, and the
  orange mark shows only at ON. It moves at once and waits for the
  server; if the save fails, the cap goes back.
- LED (`led.tsx`): 14px, in a black collar. Lit green: online. Lit red:
  printing, an error, or live audio. Unlit: offline. A red LED that is
  off (Tape's Record) shows dark red epoxy, not green.
- Fader (`fader.tsx`): a range input. It is a slot cut into the panel
  with the ribbed cap of the switch (17 × 22px, with a white centre
  line) and printed ticks at both ends of the travel. A centred fader
  (zero in the middle) also has a longer tick at the middle. The focus
  ring goes around the cap. A disabled fader shows a faded cap.
- Stamp (`stamp.tsx`): PRINTED and CANCELED in ink, FAILED in red, in
  Big Shoulders capitals with thin, uneven ink and a slight rotation.
  `alt` gives a second angle for alternate rows. `paper` keeps the light
  inks for a stamp on a receipt.
- Paper (`paper.tsx`): the printer's front edge, the roll and the slip
  (see Receipts at true size, under Shell). Torn edges: new, old, solo,
  and a sideways tear (`--hw-tear-right`) for the Tape strip.
- Thumbnails (`.hw-thumb`): a small receipt on white paper in both
  themes, 112px wide in rows (72px to 88px on phones, 64px in the
  Studio's recent prints) and cut off at 150px when the receipt is long.
  Thumbnails help you recognize a job; History shows the receipt at true
  size.
- Two-press actions: Remove, Leave, Revoke and Delete show Keep and the
  named action ("Remove printer") after the first press.

Motion: short mechanical travel, 0.06 to 0.12 s, ease-out. Keys sink,
lever keys dip, the switch cap slides and chevrons turn. There are no
fades, no springs and no pulsing skeletons. Reduced motion turns the
travel off.

Focus: every control shows a 2px ring in --hw-focus (ink in light,
#d6d2c8 in dark): 4px out on keys, around the track on a switch and
around the cap on a fader.

## Shell

The app is a Next.js React app. A panel holds the main navigation. There
is no header bar. The identity, type, tokens, accent rules, layout and
components above apply throughout. Shell rules:

- Panel (`components/app-sidebar.tsx`): a `<nav aria-label="Main">` on
  the painted panel finish. From the top:
  - the DOCKET wordmark (Big Shoulders 900, 34px, 0.06em) and the app
    version in 12px mono tertiary ink ("v0.1.0");
  - the key bank: lever keys in a black plate, one per page: Home,
    Slips, Studio, Photo, Tape, History, Printer, and Users for admins.
    No icons, no Queue key. The key for the current page stays down: its
    far end dips and its flag window in the plate shows red. Home is
    current only on "/"; the other keys are current on their path and
    the pages under it;
  - the foot: a "Dark" legend with a slide switch, a "Sign out" link
    (44px target), then the printer line.
- Printer line: an LED and "{printer name} · {state}", 14px. Online is a
  green LED. Printing (an online printer that holds a job) is a red LED
  and the word in red. Offline is an unlit LED. No printer: an unlit LED
  and "No printer". The line streams in after the page and is empty
  until then; a failed read leaves it empty. It shows the state at the
  last full page load or refresh.
- Above 875px the panel is a column 236px to 268px wide at the left. It
  stays in view while the page scrolls, and scrolls on its own when the
  window is too short for it.
- At 875px and below the panel lies across the top, on the panel finish
  with a 1px lower edge, in three rows: the wordmark (30px) and the Dark
  switch; the keys in one row that scrolls sideways; the printer line
  and Sign out. The keys all have one width, set so that a whole number
  of keys fills the plate (three on a small phone, four at 390px, all of
  them at 768px). The row snaps to whole keys, so no legend is
  ever cut, and the plate's end walls shade the keys that run under
  them. When all the keys fit they share the spare width. The flag
  windows sit in the plate above the keys. The held key dips at its lower end.
  The current key scrolls into view on each page. The version hides
  below 400px.
- Skip link: "Skip to content" is the first focusable item. It shows as
  a black label plate at the top left when it has focus, and moves focus
  to the content column, the only `<main>`.
- Content column per the spacing system.
- Modules: each label plate shows a number at the left ("01", "02") and
  the title at the right. The numbers count the modules on the page in
  reading order (on a two-column page, the first column, then the
  second). Screen readers get only the title.
- Loading: while a page's data loads, the panel stays and the content
  column shows a still skeleton (no pulse, no red): a faint block where
  the title prints, then a module with a blank label plate and three
  rows on dashed rules. Each row has a white paper thumbnail, a name bar
  and a shorter bar. Only a screen reader gets the word "Loading".
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
- Receipts at true size (`components/hardware/paper.tsx`): Home, the slip
  pages, the Studio, Photo and History's open record show a receipt as an
  80 mm slip, 624px wide, with the image at its true 576px. On Home, the
  slip pages, the Studio and Photo the slip feeds out from under the
  printer's front edge (a matte black bar with a tear bar); History's
  record is a torn slip with no edge. Below 624px of column width the
  whole slip scales down together, never the image alone. On Home, the
  slip pages and History the slip has the paper look (grain, head
  streaks and torn edges, plus a slight tilt on Home and the slip pages).
  The Studio's and Photo's
  slips are exact: no filter, grain, streaks or tilt on the image, so
  their pixels are the printer's. Small thumbnails in list rows
  (`.hw-thumb`, see Components) keep their row sizes.

## Pages

Every page lives in the panel shell above. The specs below describe
each page's content zone.

### Home
Title "Today" printed in ink, with today's date at the right in mono
capitals ("THU 15 OCT 2026", the viewer's time zone). Below it, two
columns that wrap on a narrow screen (the receipts first):
1. Today's prints: the printer's front edge, then today's receipts at
   true size, newest first. The newest slip is still in the printer
   (shaded where it leaves the bar, torn at the bottom); older slips are
   torn at both ends and lie at alternate slight tilts. A receipt taller
   than 1100px is torn off there. At most three slips show; more show as
   a "N more today" link to History. Each slip has a caption printed in
   ink: the time it printed (mono), the source ("Text messages",
   "Studio", "Reprint", "Test print") and a PRINTED stamp. A job a
   printer holds now has a red LED and "Printing" in red instead of the
   stamp. Nothing today: "Nothing printed today." under the edge.
2. The Printer module: the printer's name (21px bold), its LED and state
   (Online, Printing in red, Offline), "Last seen 12 s ago" with the
   number in mono, and "N waiting" as a red link to the Queue when jobs
   wait. No printer: "No printer yet" and an "Add a printer" link.
3. The Slips module: one row per set-up slip with its name, a mono line
   (its next run, "Tomorrow 06:30", or what makes it print, "Each text")
   and its slide switch; a slip that is off prints in the tertiary ink.
   Then an "All slips" link. An account that has not opened Slips yet
   sees "No slips set up yet."
The page does not poll. It reads one bounded job listing (the 20 newest
printed and printing jobs), the printer (shared with the panel) and the
slip list.

### Slips
Everything the printer can produce, grouped by category. One page that
replaces the earlier Templates and Plugins pages.

Index: title "Slips" with a "New template" push key at the right that
opens the Studio blank. Then one module per category (Daily, Messages,
Sports, Templates; a plugin with no category goes under Other). Each slip
is a row on a dashed rule, top-aligned: a small receipt thumbnail on
white (it links to the slip too, for a pointer only), the name as an
underlined link to the slip's page, and for a plugin's slip its mono
next-run line, its description (two lines at most) and its slide switch
at the right, outside the link. A plugin's slip that is off prints in
the tertiary ink. A template slip shows its name and a mono line that
says when it was last saved ("Edited yesterday", "Edited Tue 13 Oct"),
beside a shorter thumbnail (84px at most: the top of its receipt).

Slip page: a "Back" link (to wherever you came from; Slips when there is
no history), the slip's title printed in ink, and its description. A
template slip has a two-step Delete at the right of the title (a matte
key: Delete, then Keep and Delete template). Delete refuses a template a
plugin or the Photo tool prints with, and the refusal shows in red under
the keys ("This template is used by Photo"). Below, two columns that wrap
on a narrow screen:
- Left: the printer's front edge and the slip's receipt at true size
  (its primary template with its sample data), then the red Print test
  key with its status beside it ("Sent to the printer.", or the error in
  red). No template: a blank slip that says "No template to preview
  yet."
- Right, for a plugin's slip: the Schedule module (the switch row with
  the next-run line, the last run as a note, or in red when it failed,
  then a "Print time" field and a full-width "Print time zone" field
  for a slip with a daily time,
  or "Check every" in seconds for a watcher; a slip that prints when a
  message arrives has no schedule fields), the Settings module (one
  labelled field per config key, from the config's shape; lists are one
  item per line; numbers and booleans are checked against the plugin's
  defaults), then one Save key under both. Save also works out the next
  run. Invalid input saves nothing and shows a red line beside the key
  that names the field by its label. The switch acts at once. Then the
  Templates module: each template with an "Open in Studio" key.
- Right, for a template slip: the Template module, "Edit this template in
  Studio." and an "Open in Studio" key.

### Studio
Full-width workbench at /studio, with a "Back" link and the title. The
toolbar: the "Template" select, the New, Save and Delete keys in one
cutout, the shortcut hint at the right, and the red Print key. Below,
the Code module beside the stage from 1200px up (stacked below that):
- Code: the Template and Data keys (the current one held down) over the
  editor, an inset field window. The highlighted source sits under a
  transparent textarea; both use Martian Mono at 82% width and 13px, so
  the caret stays on the text. Token colours: tags in ink, Liquid in
  umber, strings in olive, numbers in slate blue, comments in the
  tertiary ink, never red. A data error shows in red under the window.
- Stage: an LED and the mono size line ("576 × 400 px · 1-bit"; on a
  failed preview the LED is red and the line is the error in red), then
  the printer's front edge with the preview feeding out of it at true
  size with exact pixels. The stage column is 648px, so the image is
  576px wherever the window allows; below that the slip scales down.
  From 1200px up the stage scrolls under the edge.
- Recent prints module: the 10 newest jobs as rows with a thumbnail,
  name and mono size, then a stamp for an ended job (PRINTED, CANCELED,
  FAILED), a red LED and "Printing" for a job a printer holds, or red
  "Waiting", and the age. The list refreshes on the Queue's cadence
  (every 3s while you are active, every 30s after two idle minutes,
  paused after thirty, never in a hidden tab); any pointer or key
  interaction resumes it.
Toasts are a small panel at the top centre, announced to screen readers.
New template opens a dialog: the New template module with a Name field
and Cancel and Create keys. Delete refuses a template a plugin or the
Photo tool prints with; the toast names it. Keyboard: Cmd/Ctrl+S save,
+P print.

### Photo
A print tool at /photo, not a plugin: you print a photo when you want
one. The engine (`components/photo-engine.js`) is carried over verbatim.
Title "Photo" printed in ink. From 721px up, two columns: the controls at
the left and the stage at the right. The stage column is 648px, so the
preview is at its true 576px when the window allows; below that the slip
scales down.

The controls are numbered modules, because the numbers give the order of
the work:
1. 01 Photo: a drop tray ("Choose a photo", "or drop one here") and a
   Take a photo key. The tray is pressed into the panel: the panel's
   paint and hammer finish, a little darker, with the inset edges of a
   field and four worn corner marks printed on its floor. The marks
   darken when you point at the tray; a file held over it lights the
   floor. With a photo in, the tray gets short, its marks get small, and
   it shows the file name. Take a photo opens the
   camera in the page, on desktops and phones (phones use the rear
   camera, not mirrored). The key stays down while the camera is live.
2. 02 Edit, once a photo is in: the photo on a canvas with a crop
   rectangle that you drag or resize (a white border and corner handles
   over a 55% dim). Then the crop keys Full, 1:1, 4:3 and 3:2 in one
   cutout, the current one held down (a ratio follows the photo's
   orientation), and a Rotate key (90° clockwise). Under a dashed rule is
   the Adjustments row. It is closed at first, shows "Adjusted" when a
   control is not at its default, and has a drawn chevron that turns down
   when the row is open. Open, it holds:
   - Levels, an Auto key (held down while it is on) and the mono "black ·
     white" readout;
   - a 40px histogram of the cropped photo in a readout window, with the
     clipped tones dimmed;
   - the slot of the kit fader with a black cap and a white cap for the
     black and white points (the white cap is light in both themes).
     Dragging a cap turns Auto off;
   - the faders (the kit Fader) Midtone, Shadows, Brightness, Contrast
     and Sharpen, each with its value in mono at the right. The four that
     go from -100 to 100 are centred faders, with a tick at their zero.
   Double-click the name of a control to reset it. Adjustments change the
   preview only: the crop canvas keeps the untouched photo.
3. 03 Caption, once a photo is in: the Text field, then Size (S, M, L for
   28, 36 and 48px) and Weight (Regular, Bold), each a key group with the
   current key held down.

The stage: the status at the left, printed in ink ("Rendering…",
"Queued", a failure in red), and the red Print key at the right. Print is
disabled until a preview exists and reads "Queuing…" while it sends. Under
them, the printer's front edge with the preview slip feeding out of it.
The slip is exact: the real /preview render of the "Photo Print" template
at true size, with no filter, grain or tilt. Before a photo the slip is
blank and says "Choose a photo to see the print preview." The stage stays
in view while the controls scroll, and a long slip scrolls under the
edge.

Camera: the live viewfinder shows on the slip, where the print will be. A
Web Worker dithers each frame at the print's 576-dot width, so the
framing already looks like the print. Capture and Cancel keys take the
place of Print, and the Edit and Caption modules hide. Capture keeps the
full-resolution colour frame as the source for edits, and the crop canvas
shows it dithered.

Phones (720px and below): the slip first (at most 58% of the screen
height; a longer slip scrolls inside), then one tool at a time, then a
row of keys that scrolls sideways (Photo, Crop, Levels, Midtone, Shadows,
Brightness, Contrast, Sharpen; the current one held down), then the
Caption module, then the status and the Print key. The Crop tool hides
the slip, so the crop canvas gets the room. In camera mode only the
viewfinder slip and its keys show. Before a photo: the Photo module, the
blank slip and the Print key.

### Tape

Full-width workbench at /tape, like the Studio. The title "Tape" is
printed in ink. Below it is the stage: the paper strip and the keys
under it. From 1200px up, the project column (340px) is at the right of
the stage. Below 1200px the column comes after the stage, and its
modules share the width in columns of 320px or more.

The page shows ONE of three MODES and only the controls of that mode.
No mode shows the controls of another mode grayed out.
- EMPTY (nothing on deck): a short blank paper strip (176px) with a note
  in fixed ink: "Nothing on tape yet." and "Press Record, open a saved
  take, or load the demo phrase." The demo action is an underlined button
  in the note. The column shows the session keys and the Takes module
  only.
- RECORDING: the paper hides. Only the real transcription writes the
  tape; it is never sketched. The raw pitch trace is the screen: 320px
  tall, linear time, plotted on the ground, and it follows the newest
  sound. Above it is the line "REC 0:12.40": REC in red mono, the
  counter in ink. Below it are the status line, one large Stop key (60px)
  with a lit red LED, and an underlined "Discard" (stop without
  transcribing). The column hides. A screen wake lock (best effort) keeps
  the display of a phone, and its mic stream, alive through a take.
- LOADED: the full bench, described below.
The strip keeps its place in every mode. Only the controls around it
change.

Notation glyphs (treble clef, key signature, accidentals, breath commas)
are engraved shapes rasterized from Bravura (SIL OFL), sized to the
staff; the take opens with bare paper, then the clef and key signature
before the first note. The canvases track the width of the roll through
a ResizeObserver (the window can change size) and stay mounted in every
mode (CSS hides them; the controller holds their refs). Monophonic
transcription: while the mic is live, only the raw pitch trace draws.
Live notation was dropped on purpose: the sketch was discarded on Stop
anyway, and live guesses that differ from the final tape make the tape
harder to trust. When the take ends (Stop or Load audio), a neural model
(Basic Pitch, bundled, in the browser) transcribes the recording, and the
decoder turns it into main notes, rearticulation splits, slide
connectors (a thin diagonal between pitches; a dip scoop for a
same-pitch slide), and ornament marks (a small backwards "c", a
procedurally drawn arc that opens toward the earlier tape, above the
staff at the attack of every ornamented main note). Ornaments never
render as small notes on the staff; the arc is painted OVER the
preceding tape rather than inserting rows, so main notes stay close
together. The preview canvas shows the exact raster rows the printer
would receive, in reading orientation (staff horizontal, time flowing
left to right, new tape entering at the right; the strip follows the
newest rows unless the user scrolls back). A take past the width cap of
the preview (about 14 minutes of sounding tape) still prints whole; a
note above the strip says "The preview stops here. The print includes
the whole take." The stage has no live-note readout and no event log.

The paper strip. The paper canvas shows the exact rows: 576 dots across
at 0.75px a dot, so it is 432px tall. The paper look comes from a sheet
BEHIND the canvases, never from their pixels: white paper (--paper, the
same in both themes) with the paper shadow of the kit, an 18px margin
above and below the printed rows (the 24 dots of unprinted paper), and a
torn right end (the tear of the kit, turned on its side) in a 16px strip
that the roll does not cover. The sheet has the finish of every slip,
turned a quarter: its long top and bottom edges shade in over the
margins. The blank strip also has the paper grain and the faint bands
along its length; a loaded strip has neither, like the exact slips in
Studio and Photo. The page loads the paper tokens from
components/hardware/paper.css. The roll is the scroll container. Do not
put padding or a border on it, and do not put width, height, transform,
filter or zoom on it or on the canvases: the seek and selection math
reads the canvas rect. The roll holds the two canvases and the playhead
only; the empty note sits outside it. Above the strip, a line printed in
ink names the open take: the name (21px bold; "Unsaved take" before a
save) and, with phrases, a mono suffix ("2 phrases", or "Phrase 2 of 3"
in focus).

The pitch trace shares the x-axis and the scroll of the tape: it sits
under the paper inside the same roll, plotted on the graph-paper ground
32px below the paper canvas, one column per tape row. So the raw pitch
that made a note bar sits directly below that bar at any scroll position.
Its ink comes from --ink, --ink-faint and --red on <html> (tape-view.js
reads them once at mount), so it needs a surface that follows the theme;
on the white paper, the light ink of dark mode would not show. Ink dots
weighted by detector confidence, a thin --ink-faint line for the
committed note, and faint full-width reference rows at A3/A4/A5 (the
duduk-in-A anchors). Like the tape, its x-axis is sounding time: silence
compresses. The View settings can hide it; the sheet then wraps the
whole roll.

The keys under the strip are compact push keys in dark cutouts, on the
ground:
- Transport: one cutout with Back 5 s, Play, Forward 5 s and Stop as
  icon keys (Lucide icons). While audio plays, Play stays down and shows
  a lit red LED and the Pause icon. Then "Speed" with a select (0.25×
  to 1×), then the readout "0:01.24 / 0:09.02" in mono, the duration in
  the secondary ink. Under them is the keyboard hint on fine pointers
  ("Drag the tape to seek · Space play · ⇧< ⇧> 5 s · ← → note · ↑ ↓
  pitch · 0–9 phrase"), or "Tap the tape to seek. Tap a note to edit
  it." on coarse pointers.
- Inspector: Previous note and Next note keys, the selected note in mono
  ("A♯4 · 0:00.07–0:02.23"), and Undo (with the edit count) and Redo at
  the right. With a note selected, a second cutout holds Pitch down,
  Pitch up, Ornament, Slide, Split, Join, Cut before and Remove.
  Ornament, Slide and Cut before are toggles: a toggle that is on stays
  down, never red. On a narrow stage the edit keys wrap, and each row
  fills the cutout. With no selection the line says "Pick a note on the
  tape to edit it." ("Switch to Full notation to edit." in the Main notes
  view). The tooltips of the keys give their shortcuts.
- Bottom row, under a dashed rule: the status line at the left (the text
  of the controller; CSS capitalizes its first letter), and at the right
  "Print phrases (N)" (a matte key, when phrases exist) and the red print
  key "Print take" ("Print phrase" in focus, "Queuing…" while in
  flight). In the empty and recording modes the status line shows under
  the strip when it has text, so a mic that fails to start is never
  silent.

The project column:
- The session keys at the top, in one cutout across the column: Record,
  with an unlit red LED (dark red epoxy, not the green of the online
  LED), and Load audio (a key that opens a hidden file input). Both start
  a NEW take. Record keeps its place in every mode. There is no separate
  New take key, and the demo phrase is not a main key.
- 01 Takes. Once a take exists: the "Take name" field (placeholder
  "Take", the default name), then Save take (Save and Save as new for a
  tied take) in one cutout, and an underlined "Download WAV". Then the
  takes list: rows on dashed rules, each with the name (600) over a mono
  line with its duration ("Open · 0:09.02" for the open take). Select a
  row to open its take. The open take (or the unsaved session, "Unsaved
  take") expands to its PHRASE LIST, indented on a dashed left rule. Each
  saved take has a Delete key; Delete shows Keep and Delete take, so a
  delete takes two presses. Deletes are SOFT: the take is hidden for 30
  days before its files are purged (on list loads), the status line says
  so, and the line "Deleted “name”." with an underlined Undo restores it.
  With no takes: "No saved takes yet."
- 02 Key (loaded mode), the one setting that is always visible: the
  "System" select (Western major and minor, or Mugham modes). Western
  shows the "Key" select, which names every signature with its relative
  minor ("G major / E minor · 1♯"). Mugham shows the "Mode" and "Tonic"
  selects side by side: the seven principal modes (Rast, Shur, Segah,
  Shushtar, Chahargah, Bayati-Shiraz, Humayun) on a chosen tonic. Each
  pick derives the best-fit printed signature (most shared pitches, ties
  to fewer accidentals then flats), and a note states it ("Segah on A
  prints as F major / D minor · 1♭."). Neutral quarter-tone degrees
  round to the nearest semitone for now, so the paper shows plain
  accidentals and the player adds the intonation; the interval rows are
  data in tape-renderer.js (MUGHAM_MODES), one line per mode.
- 03 Settings (loaded mode): three collapsible sections on dashed rules,
  closed by default, each with a chevron. Detection (with "Phrase N"
  under the title when the take has phrases): the Melody floor fader,
  read out as "230 Hz / A♯3", a note name, not bare Hz. View: the
  Notation select (Full notation, Main notes only) and the Pitch trace
  select (Hidden, Aligned under the tape, Linear time), with the Trace
  stretch fader in Linear time only. Layout: the Time per row, Staff gap,
  Note width, Glyph size and Breath gap faders.
- Faders: the kit Fader, with the label and the mono readout above the
  slot. A disabled fader shows a faded cap and refuses the pointer.
Status during a decode: "transcribing… N%", then the line clears; no
note or ornament counts, ever. While the decode runs, the session, clip
and transport controls disable rather than race it.

Red on this page (red rules 5 to 7): the REC word, the lit LED on Stop
and on Play while audio runs, the playhead while audio runs, the
selection halo, and the print key. The REC word is a red use of the Tape
tool only.

The player: a playhead crosses both the tape and the trace. It is a
1.5px DOM overlay that spans the roll (never drawn into the canvases;
the tape canvas holds exact print bytes), --ink-muted while paused and
--red while audio runs. The tape is not linear in time (silence
compresses to a breath mark, glyphs occupy timeless rows), so the
playhead follows the time-to-row timeline of the renderer: it sweeps
steadily through notes and skips across breath marks, matching the ear.
Both panes are the scrub surface (crosshair cursor): a mouse drag pauses
and seeks, and the release resumes playback if it was playing. TOUCH is
different: a phone has no scrollbar, so the drag gesture belongs to
navigation. Touch drags PAN the roll natively (touch-action: pan-x) and
only a TAP seeks (and selects, with a slack of about 24px toward the
nearest note; note bars can be 2px wide). While playing, the roll
scrolls to keep the playhead in view.

Editing: once a take is decoded, a click on a note selects it; the same
click still seeks. The selection is a red contour that TRACES the exact
shape of the selected glyph, its inner edge flush against the ink (no
air, no rounding the shape does not have): a sharp rectangle on the bar
of a note (2.25px --red stroke), and on an ornament arc the true
crescent outline (1.5px; the finer glyph takes the finer line), derived
by dilating the reconstructed ink of the arc; red rule 7. It is painted
over the preview repaint only, never into the offscreen print bytes, so
exports and prints stay pristine. Split is enabled while the playhead
rests inside the note; edits keep the playback position. Ornament arcs
are selectable too, BOTH kinds the same way, so no arc ever behaves
differently: standalone time-anchored marks and the arc that the
Ornament flag of a note draws. The small box of an arc hit-tests on both
axes and wins over the note band under it. A selected arc shows
"Ornament · 0:01.42" with only Remove, a normal undoable edit (removing
a flag arc turns the ornament of the owner note off). Keyboard (skipped
while a form control has focus): Space play/pause, ⇧< / ⇧> seek ±5 s
(also the Back and Forward keys), ←/→ walk the notes (scrolling the
selection into view), ↑/↓ nudge the pitch of the selected note, 1-9 open
a phrase and 0 the Song overview, O toggles the ornament, J joins next,
S splits at the playhead, C cuts a phrase before the note, Esc
deselects, Cmd/Ctrl-Z and Shift-Cmd-Z undo/redo, Backspace/Delete
removes the selected note.
Every edit renders the whole tape again from the edited timeline, so the
preview and the print bytes remain the same rows, and the roll keeps its
scroll position (a new render never moves the view; only live recording
follows the paper). Freeze-on-edit: while a take has edits, the Melody
floor fader disables, a note says "Editing pauses detection. Start over
detects the recording again.", and a Start over key appears. Start over
reads the recording again and keeps the edited tape as a snapshot;
undoing every edit unlocks the fader again. Background work (the trace
backfill finishing) never replaces an edited timeline.

Phrases: a song splits into phrases at CUTS, timestamps snapped to note
attacks. "Cut at breaths" in the phrase list seeds them (rests of 2× the
Breath gap or more), and the Cut before key of the inspector toggles one
per note. The Merge key of a phrase merges it into the phrase before it.
Cutting and merging PARTITION the tape as it stands: the visible
timeline, edits included, is sliced (or joined) unchanged; a cut only
adds the caesura. Halves of an edited phrase keep those edits and stay
frozen (fader locked, "Edited" on its line) until an explicit Start
over; the undo history resets at the cut, with the state before the cut
kept as a snapshot. Each phrase is a full take document of its own: its
own melody floor (the Detection section shows "Phrase N" and edits only
the ACTIVE phrase), its own edit log, undo/redo, versions and freeze
state. A phrase derives again as a standalone clip (boundary rules stop
at the cut) only on Start over or a floor change. The song is the
PROJECT and phrases are its pages, opened from the PHRASE LIST under the
open take: "Song" (All phrases), then one row per phrase ("Phrase 2"
over "0:05.38–0:09.02", with "Edited" when frozen). The selected row
prints its name in 600 ink, the others in the secondary ink. "Song" is
the overview: every phrase stitched in time order with a printed
CAESURA at each cut (two parallel strokes slanting up-time above the
staff, in place of the breath comma there); the preview stays identical
to the print, and a note selected there activates its phrase in place
for the Detection section and the inspector. A phrase row opens the OWN
tape of that phrase: its own strip exactly as it prints, its own
detection settings and undo history, playback confined to its span
(practice mode), and a print key that reads "Print phrase", so "prints
exactly as shown" stays true in every scope. Sessions and loaded
projects open on Song; a take with no cuts lists no phrase rows, only
the Cut at breaths key.

Print take queues the rendered rows verbatim through /api/tape/print
(source "tape"); the key reads "Queuing…" while in flight and the status
line answers in plain words ("sent to the print queue", never a raw job
id). Jobs carry the saved name of the take; a phrase prints as
'name · phrase 2 of 5', and "Print phrases (N)" queues every phrase as
its own standalone receipt (fresh clef and key signature each). The
jobs appear in Queue and History like any other, but they are raw jobs
(kind "raw": bytes, no template), so History shows no Reprint key for
them; print again from the tool.

Small screens and touch. Below 1200px the column comes after the stage
(strip, transport, inspector, print), so the phone is the recorder; the
empty and recording modes each fit one screen. The tab order follows the
same order. Coarse pointers (@media pointer: coarse) get 44px compact
keys and a 48px Speed select; the faders are 32px tall on every pointer.
The page pads its bottom with the safe-area inset. Lines of keys wrap
rather than overflow, and the keyboard hint changes to the touch hint
(see the transport above). Everything else (modes, the empty strip, the
full-height recording trace) is the same design on every width.

### Queue
Not in the key bank. The Printer modules on Home and on the Printer page
link to it while jobs wait or print. Title "Queue" printed in ink. At the
right: the poll state in mono ("Updates every 3 s" while the person is
active, "Updates every 30 s" after two idle minutes, "Paused" after
thirty) and a compact Refresh key. Refresh reads the queue at once and
starts the fast cadence again. Any pointer or key input also starts it
again.
Two modules, in print order:
1. Printing: the jobs a printer holds now.
2. Waiting: the jobs in the order they will print.

Each job is a row on a dashed rule, top-aligned: a small receipt
thumbnail on white, the job name, then a mono line with the time the job
was made (the viewer's time zone; "Yesterday 17:30" or "Tue 13 Oct
17:30" for an older job) and its source ("Text messages", "Studio"). A
printing job also shows a red LED, "Printing" in red and "Started 12 s
ago". A job that a printer handed back shows "N failed attempts" in red
("1 failed attempt" for one). At the right: a compact Requeue key for a
printing job, a compact Cancel key for a waiting job. Requeue puts a
stuck job back at the front of the queue. From there it prints again or
you can cancel it. If the server refuses an action, a red line shows in
the row. If a printer takes a job before Cancel arrives, the row says
"Not canceled: a printer took it first." On a phone the key goes under
the text.
From the third failed attempt of a job, each failure sends the job to
the back of the queue. The job then lists behind every job that was
queued before that failure and in front of all jobs queued after it.
That is where it will print.
Empty modules: "Nothing printing." and "Nothing else waiting." No jobs at
all: one Waiting module with "Nothing is waiting to print." and a "Back
to Home" link.
The list reads `/api/queue` again at the cadence that the poll state
shows, only while the tab is visible. The page load also reads the slip
list once, to name each job's source.

### History
Title "History" printed in ink, with the count at the right in mono
capitals ("12 RECEIPTS") and the filter keys in one cutout: All,
Printed, Failed, Canceled. The current filter key is held down. On a
phone the four keys share the width of the column.
Jobs are grouped by the day they printed (the time a printer took the
job; a job no printer took shows the time it was made), in the viewer's
time zone. Each day is one module: the plate shows the day's number,
counted from the newest day ("01"), and its label ("Today", "Yesterday",
"Tue 13 Oct"). A day that continues on the next page keeps its number.
Each job is a row on a dashed rule, top-aligned: a small receipt
thumbnail on white, the job name, the source in mono ("Text messages",
"Studio", "Reprint"), "N failed attempts" when a printer handed the job
back before it ended, and at the right its stamp (PRINTED, CANCELED, or
FAILED in red) and the time in mono. On a phone the stamp and the time go
under the name.
The whole row is a button that opens the job's record under it (the
chevron turns down). The record shows the receipt at true size, torn at
the bottom, with the job's stamp pressed on its foot. Beside it (under it
on a narrow screen) is the red Reprint key with its status ("Sent to the
printer.", or the error in red), then Template and Data keys (the current
one held down, as in the Studio) over a read-only mono window with the
template source or the data, both clipped. Reprint renders again from the
stored template and data; it never resends old bytes. A receipt a tool
printed (a Tape print: bytes the tool rendered, no template) has no
Reprint key and no inputs; it says "Print it again from Tape."
20 rows per page. Under the list: Newer and Older keys in one cutout (a
key that has no page is disabled) and the page count in mono ("1 / 3").
Empty: "Nothing printed yet.", "No failed jobs." or "No canceled jobs."
The page does not poll. It reads every ended job (with its failed
attempts) and the slip list, to name each job's source.

### Login
The printed ground with the DOCKET wordmark (Big Shoulders 900, 48px,
printed in ink) above one centered module, 400px wide at most: plate
"01 Sign in", then the Email and Password fields with visible labels and
a full-width matte Sign in key (not red: red is for printing). A refused
sign-in shows a red line under the key ("Invalid email or password.").
There is nothing else on the page. A signed-in visitor goes to Home.

### Invite (public, /invite/[token])
The same page as Login. Plate "01 Create account", then the Name, Email
and Password fields, the note "At least 8 characters" under the
password, and a full-width matte Create account key. The Email field is
read-only when the invite is for one address. A refused sign-up shows a
red line under the key. A dead link (unknown, used, expired or revoked)
shows plate "01 Invite" and one note in place of the form: "This invite
link does not work. It was used, it expired, or it was revoked. Ask an
admin for a new link."

### Printer
Title "Printer". Two columns that wrap on a narrow screen:
- The Status module: the printer the account prints to (the first
  listed), its name (21px bold), LED and state (Online, Printing in red,
  Offline) and "Last seen 12 s ago". While jobs wait or print: "N
  waiting" in red (when jobs wait) and a quiet "Queue" link. Then mono
  label pairs: Paper width (80 mm, 576
  dots) and Version. No printer: "No printer yet" and how to pair one. A
  member of a shared printer sees that printer's contact.
- The Printers module: one row per printer, its name over a mono line
  ("Paired 3 h ago", "Shared with you", or "Pairing" while it waits for
  its token), with compact keys at the right: Share and Remove for an
  owner, Leave for a member. Remove and Leave take two presses (Keep,
  then Remove printer or Leave printer). Share mints a code and shows it
  in a read-only field ("Works once, for 15 minutes."); an unexpired code
  shows again on reload. Under an owner's row with members: "Also prints
  for {email}" with a two-step Remove each. A refused action shows a red
  line in the row. While a printer is pairing the page refreshes every
  3s (visible tab only) until the printer collects its token. If the
  printer prints a new code after a code was entered but before it
  collected its token (it rebooted, or its 14-minute code rotation came
  round), that claim is void: enter the newly printed code. Empty: one
  note that covers both codes.
- The Add a printer module: a "Pairing code" field (mono capitals; the
  hint says a share code from another account works too), a "Name" field
  ("Kitchen printer" as the example) and a matte Pair key. Errors show in
  red over the key ("Code not recognized or expired."). A pairing code
  from a printer that another account still holds is refused with "This
  printer belongs to another account. Its owner can remove it on their
  Printer page."

### Users (admin only)
Title "Users" printed in ink. Two modules:
1. Accounts: one row per account, the name over the email (14px), and a
   mono ADMIN label at the right for an admin.
2. Invites: one row per open invite link, the email it is for or "Anyone
   with the link", over a mono line with the expiry date in the viewer's
   time zone ("Expires Thu 22 Oct"). At the right, compact keys: Copy
   link (it shows "Copied" for 1.5 s) and Revoke. Revoke takes two
   presses (Keep, then Revoke invite). If the browser does not let the
   page copy (a page that is not on https), the row shows the link in a
   read-only field. Under the rows: an "Email (optional)" field, a New
   invite key and the note "With an email, only that address can use the
   link. It works for 7 days." After a new invite, the note says "Invite
   made. Copy its link above." A refused action shows a red line.

Empty: "No accounts yet. Make an invite below." and "No open invites."
Other accounts see one module with "Only an admin can see accounts and
make invites." The panel shows the Users key to admins only, after
Printer.

## Voice

Sentence case in the source everywhere. The wordmark and the hardware
legends print in capitals by CSS (see Type). No exclamation marks, no em
dashes in sentences (a lone dash marks an empty value), no jargon or file
paths in page copy. Errors say what happened and when ("calendar 401 · 2d
ago").
Empty states are short and plain ("Nothing is waiting to print.",
"Nothing printed yet.").
