# Rendering the Slips feed module

The travelling printer on the Slips page is not drawn in CSS. Every part of it
is a Blender render, and the page moves those renders around. This document
covers how the scene is built, what gets rendered, how the page uses the
renders, the rules learned while making it, and how to change it.

The code lives in `scripts/render/` (the Blender scene and the tools that
turn renders into page assets) and `app/(dashboard)/slips/` (the page).
`docs/design-spec.md` describes what the module looks like and how it moves;
this document describes how it is made.

## The camera

The rest of the dashboard uses the kit's slanted view: a raised point at
height z is drawn `0.62 * z` higher on screen, wherever it is. That is what a
perspective camera gives you when the eye is infinitely far away.

The feed module uses a shift-lens camera instead. The eye is 550 mm above the
desk and 120 mm in front of the window's bottom edge, centred left to right,
and the camera's sensor is parallel to the desk. At 1 mm = 4 CSS px, in a
1440 x 900 window the eye is at window (720, 1380), 2200 px up.

- Anything flat on the desk (the slip, the deck) is drawn at real size
  anywhere in the window. A 320 px slip stays 320 px.
- A point z px above the desk is pushed away from the eye by
  `s(z) = z / (2200 - z)` of its distance from the eye. Raised parts lean
  with their place in the window: near the top the printer's front faces
  look taller, near the bottom they flatten.

`scripts/render/geo.py` holds the frames and the projection:

- Model frame, in CSS px: x from `.sl-mech`'s left edge, y toward the top of
  the page, z up from the desk.
- `HEAD`: where the head origin (the back edge of the printer's lid top, at
  z = 58.06) lands in the window. `MECH_TOP` and `MECH_H` place the module.
  `CROP` is the window rectangle rendered. All four can be set from the
  environment (`HEAD_X`, `HEAD_Y`, `MECH_TOP`, `MECH_H`, `CROP`).
- `proj(x, y, z)` takes a model point to window px through the shift lens.
  `plan(x, y)` is the same at z = 0.

## The scene

`scripts/render/build.py` builds the module from the shipped design's
numbers. Primitives, the machined-metal material and the room light come from
`scripts/render/parts.py`.

### Light

There is one lamp, one bounce card and the room. Nothing else lights the
scene, and nothing is painted on.

| Item | Numbers | Why |
|---|---|---|
| Lamp | 200 mm disc at (-120, -120, 400) mm from the window's top left, aimed at the window centre. Power set so a flat white surface at the window centre gets 2.16 (sun units) | The key light. Fixed to the window, so the printer's light changes as it moves down the page |
| Bounce card | 400 x 120 mm soft rectangle, 160 mm in front of the window's bottom edge and 130 mm up, aimed at the window centre, a tenth of the lamp's power, unseen by the camera | A photographer's white card. It lifts the front faces a little. It is close to the desk, so in practice it gives about 20% of the desk's light, and its long soft shadows show; that is real, not a bug |
| Invisible paper | A white 80 mm sheet (x 42-362) leaving the slot at z 2.4, drooping to the desk over 72 px, then flat. Unseen by the camera, casts no shadow | It bounces light into the printer and shows in the tear bar, as a real slip would. Hide it in anything that records the desk (see the rules) |
| Room | `env.npz`: an ambient map and a soft key per theme, from the old lab renderer | Fills the shadows and gives metal something to reflect. It cannot be regenerated; keep the file |
| Desk | A shadow catcher (it records only shadows) in the page's ground colour (`ground.json`) | The page draws the desk; the renders carry only the shadows on it |

### Materials

| Part | Finish |
|---|---|
| Carriage casting | Light theme: satin aluminium with bead-blast grain. Dark theme: black anodize |
| Bearing cover, motor strap | The opposite finish to the casting in each theme (black anodize in light, satin aluminium in dark) |
| Printer | Moulded near-black plastic (`#161513`), edge radius 0.7, a stipple texture and a little mottling |
| Rod | Ground steel, anisotropic along its length |
| Way | Lapped steel lands with lengthwise grain and a polished track where the shoe runs; a dark slot floor |
| Shoe tongue | White acetal |
| Flat cable | Amber polyimide, semi-gloss. The amber is the material's colour, not an accent |
| Drive | Polyurethane tyre with a worn band, steel boss, bronze bushings, steel shafts, a coupling |
| Screws | Black oxide socket screws, only at real joints (`meta_*.json` lists each joint). The roller boss and the coupling carry two set screws each, a quarter turn apart |
| Supports | The casting's finish |

Every edge is rounded by Cycles' Bevel shader node, not by geometry (geometric
bevels on boolean results collapse). The edges keep the part's own material,
so a chamfer catches light only where the lamp or the card reflects in it.
That is `BK_EDGE=face`, which the render scripts set. Without it the old
bright-cut edge band comes back (a shinier metal plus a white diffuse share on
every edge), which is not physical.

### The one departure from plain physics

A polished surface shows what it reflects, not where light lands, so a
shadow falling on the motor can or the rod barely shows. `compare.py` and
`post.py` darken metal reflections where the lamp is blocked (`KV` 0.85, from
a lamp-only visibility pair) and by ambient occlusion (`KA` 1.0). The tear
bar is exempt (object index 7): it sits in the printer's shadow and reflects
the room in front. This is deliberate; keep it.

## What gets rendered

Everything renders on the CPU (`Blender -b --factory-startup`); the Metal GPU
hangs in Blender 5.2. `render-all.sh` runs it all, both themes, in about 45
minutes; `render-head.sh` redoes only the head unit and the drive.

| Render | Switches | What it holds |
|---|---|---|
| Head unit column | `LAYERS=<window y,...> HEAD_X=928` | The carriage, printer, cable, crest, shoe and the rod's length inside the cap, at 11 heights (head origin at window y -370 to 880, every 125 px). Per height: colour (2x, the deck and desk cut out, the paper still lighting), a lamp-visibility pair, height (2x, z px above the desk) and shadow (1x, the head unit's shadow on a flat desk, the head unit unseen by the camera) |
| Drive | `ROLL=48 HEAD_X=928 HEAD_Y=260` | The tyre, boss, shafts, coupling and their set screws at 48 angles, at the hold height. Everything else is cut out but still lights and shades them |
| Rod and way strip | `HIDE_HEAD HIDE_SUP PAPER=0`, crop window y -40..1640 | The rod and the way the full height of a window, with the rod's shadow |
| Supports | `HIDE_HEAD ROD_HOLD PAPER=0` | The top support where it is seen (the page at its top, module top at window y 237) and the bottom one (the page at its end, module bottom at window y 801). The rod is cut out but still casts |
| Full render | no mode switch | The whole module at one position, for review: `python3 compare.py post <tag>` writes `out/render-<theme>-<tag>.png` |

`HEAD_X=928` puts the module 208 px right of the eye. Across window widths the
module sits 142 px (1180 wide) to 272 px (1440 wide) right of the eye
(`checks/measure.mjs`); the page's warp covers the difference.

The camera, lamp and card are fixed to the window; between heights only they
move, never the model.

## Turning renders into page assets

| Step | Does |
|---|---|
| `post.py <theme> col` | Each height: the reflection darkening, then colour as straight-alpha sRGB, height as u8 (255 = 128 px), shadow as the linear share of light lost |
| `deckpost.py strip supa supb` | The same darkening for the deck renders |
| `deck.py` | Cuts the rod and way strips and the supports. Converts shadow from a linear share to the alpha that darkens the page's ground by that share, feathers sprite sides, and makes each support carry only the shade the rod strip under it lacks |
| `pack.py` | Packs the column into atlases, writes the drive frames, the static fallback and `head.json` |

What ships in `public/hardware/feed/`:

| File | Holds |
|---|---|
| `head-<theme>-c.webp` | Colour atlas, 2 columns of 1000 x 880 cells (2x of a 500 x 440 crop) |
| `head-<theme>-a.webp` | 1x, lossless: R = height, G = shadow |
| `head-<theme>-{1x,2x}.png` | The hold-height render with its shadow, for reduced motion and no WebGL 2 |
| `roll-<theme>.png` | The drive's 48 frames side by side |
| `feed-rod-*`, `feed-way-*` | Window-height strips |
| `feed-support-{t,b}-*`, `feed-way-end-{t,b}-*` | The supports and the way's ends |
| `feed-slot-*` | The cable slot and its brushes (earlier sprites, kept by choice; flat, so the camera change does not show) |
| `head.json` | The manifest (below) |

`head.json`: `scale` (2), `anchor_y` (147.92), `eye_front` (480, px in front
of the window's bottom edge), and per theme: `atlas`, `cell`, `crop` (CSS px),
`zs` (height scale), `zmax`, `eye_h` (2200), `ground`, `roll` (`n`, frame
`size`, origin `o`, eye-relative anchor `e`, height `z`) and `cells`. Each cell
has its atlas origin `cell`, its crop origin `o` in head-unit px, and `e`, the
eye-relative position of its desk-level anchor.

## How the page uses them

The head unit's box (`.sl-head-unit`) is anchored at desk level: its origin is
147.92 px above where the printer's front meets the desk (model y -147.92).
Flat things stay put relative to it and raised parts lean, which is what the
camera does.

`slip-lens.ts` (one WebGL 2 canvas over the head unit):

1. Finds the head unit's place against the eye:
   `e = (left - innerWidth / 2, top + 147.92 - (innerHeight + 480))`.
2. Picks the two renders either side of `e.y` and the nearest one.
3. Warps the nearest render to this place. A point at height z moves by
   `D * s(z)` in head-unit px, `D` being `e` minus the render's `e`. The height
   comes from marching the line of sight down from `zmax` and taking the first
   surface (parallax occlusion), then bisecting, so edges stay whole.
4. Inside the outline, mixes the light from the two renders; the nearest one
   alone gives the outline.
5. Mixes the two renders' shadows and draws them as black at the alpha that
   darkens the ground by that share.
6. Draws the drive frame for the carriage's travel (`frame = travel / 12 px`
   as an angle, 48 frames a turn) over the drive, warped the same way.

It draws only when the head unit moves in the window, the carriage travels or
the window resizes, and reloads its textures on a theme switch.

`slip-feed.tsx` holds the motion constants and mechanisms (comments explain
each): `REST` 92, `HOLD` 260, `FOOT` 40, `GLIDE` 140 ms, `STEP` 83 ms with
`IN` 1/4 and `OUT` 1/8, `DWELL` 120 ms, `SPEED` 420 px/s, `ACCEL` 2600 px/s².
It sets `--sl-y` (the carriage's travel), `--sl-mx` (the module's left edge in
the window, for the window-fixed strips) and dispatches `sl-move` with the
travel. The printer can be grabbed and pushed along the rod.

`slips.css` places the deck sprites. The rod and way strips use
`background-attachment: fixed` positioned from `--sl-mx`, so they stay fixed
to the window while their boxes scroll with the page.

With reduced motion the carriage follows the scroll on a CSS scroll timeline
and the static render (`.sl-cast`) shows. Without WebGL 2 the static render
shows too.

## Motion

Each part moves like its real mechanism:

- The paper steps, like the printer's stepper motor: in by quarters, out by
  eighths, 12 steps a second.
- The carriage runs on its motor: it chases the hold line at a limited speed
  and acceleration, so a fast scroll leaves it behind and it catches up
  without overshooting.
- The drive turns smoothly with the travel; it is the only smooth rotation.
- Parts bolted to the deck stay still. Wheel steps glide.

## Rules

Each of these was learned by getting it wrong.

1. No painted light. No emission sheens, no colour by facing, no extra
   lamp for one part, no separate edge material. If something needs to read
   better, change the real light or the part.
2. Shadows are shares of light. The renders give the fraction of light
   lost, in linear light. Before the browser composites a shadow as black
   over the page, convert it against the page's ground:
   `A = 1 - srgb(lin(g) * (1 - a)) / g`. Skipping this makes shadows about
   2.4 times too dark.
3. Light on something uniform belongs to the window. The rod and the way
   look the same all along, so the lamp's highlight on them depends on the
   window position, not the page position. Draw them as window-fixed strips.
   A page-attached tile freezes one window height's light (averaging rows
   also wipes out the grain).
4. Never stack two soft shadows from different sprites. Their alphas
   multiply and every box edge shows as a line. Where a sprite sits over a
   strip, it carries only the shade the strip lacks:
   `(1 - A_sprite)(1 - A_strip) = 1 - A_render`. Mind which rows the strip's
   box covers; one row off draws a line.
5. The invisible paper lights the printer, nothing else. A shadow catcher
   sees it through bounce rays and prints a paper-shaped shadow. Hide it for
   the shadow pass, the deck renders and the lamp-visibility pair.
6. Parts seen through an opening belong to the layer that owns the
   opening. The rod inside the cap is part of the head unit's render, so the
   cap shades it in the drive's window; the deck strip draws the rod outside.
7. The lamp-visibility pair is the lamp alone. Hide the card and the
   paper for it, or metal shadows weaken.
8. Cut-outs still light the scene. Deck parts are holdouts in the head
   unit's colour render: where one is in front of the head unit it leaves a
   transparent hole (the page's deck sprite shows there), and it still casts
   shadows and bounces light.
9. Render on the CPU, bevel with the shader node, and keep the environment
   rotation fix in `parts.py`.
10. Judge renders against a full render and check cast shadows. Do not
    pass on a summary of a render you have not looked at.

## Recipes

Re-render after any scene change and look before shipping:

```
cd scripts/render
BK_EDGE=face Blender -b --factory-startup --python build.py -- light 32 2 look
python3 compare.py post look light       # out/render-light-look.png
./render-all.sh                          # or ./render-head.sh
```

Then check the page with the sandbox running (`npm run sandbox`):
`node scripts/render/checks/shots.mjs <outdir>` (both themes at three
scrolls), `motion.mjs` (frames and frame times during a catch-up), `rm.mjs`
(reduced motion), `drag.mjs` (grab and push).

- To change a material or the light, edit `build.py` (`make_all_mats`,
  `setup_card`, `LAMP_*`) or `parts.py`, then `render-all.sh`.
- To change the carriage, printer, cable or drive, edit `build_carriage`,
  `build_printer`, `build_cable` or `build_drive`, then `render-head.sh`.
  Anything built there rides with the carriage and appears in the column.
  A part that turns with the drive also goes in `run_roll`'s list and inside
  the drive crop (x -1 to 42).
- To add a deck part, build it in `build_deck` (it gets object index 3). If it
  is the same along its length, cut it from the strip render in `deck.py` and
  give it a window-fixed box in `slips.css`. If it is a single object, render
  it where it is usually seen (like the supports) and, if it sits over a
  strip, use `over_strip`.
- To move where the printer rests or holds, change `REST` and `HOLD` in
  `slip-feed.tsx` and the head unit's `margin-top` in `slips.css`. `REST` is
  the carriage's back face (52 px behind the box origin at desk level) meeting
  the top support's front face (module y 40): 40 + 52.
- To use this camera elsewhere, measure where the new module sits at several
  window sizes (`checks/measure.mjs`), set `HEAD_X`, `CROP` and the column's
  heights in a new run script, and keep the lamp, card and room as they are,
  so the new parts match these. The page side is `slip-lens.ts` with a new
  manifest.
