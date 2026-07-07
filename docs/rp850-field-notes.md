# RP850 Field Notes

Measured behavior of *this project's* Rongta RP850 unit: things the
datasheet doesn't cover, measured on real prints. If you're building the project
with different hardware, treat these as examples of what to measure, not as
facts about your printer. The general bring-up process lives in
`receipt-printer-build-guide.md`.

## Print geometry (80mm stock)

- Printable width: 576 dots (72mm), sitting inside **~3mm unprintable
  margins each side** (varies ~2.5-3.5mm with how the roll is loaded).
- The cutter leaves **~1.5mm between blade and the nearest printable dot**.
- The print head sits **~2cm upstream of the cutter**, so every slip starts
  with that much blank leader (mechanical, not a template choice). No
  reverse feed: probed `ESC K`, `ESC j`, `ESC e`; all silently ignored.

How the system compensates: photo jobs print full-bleed 576 wide (the
hardware supplies the 3mm sides), dithered jobs print **rotated 180° with a
flush cut** (+12 dots ≈ 1.5mm, for a measured ~3mm visual top margin after
flipping the slip, with the leader becoming bottom margin), and the dashboard /
studio previews draw the unprintable strips so screens show the slip.

## Serial

- Reliable at **115200 baud** (`8N1`, DIP switches). Earlier "baud ceiling"
  symptoms were actually MAX3232 TX/RX label confusion (see the guide).
- Serial delivers ~11.5KB/s; the head consumes dense raster ~8x faster.
  Hence the memorize-then-print encoding for photos (see below).

## Status probes (DLE EOT)

Calibrated reference values:

| State | EOT 1 (printer) | EOT 2 (offline cause) | EOT 4 (paper) |
|---|---|---|---|
| Healthy | `0x16` | `0x12` | `0x12` |
| Lid open | `0x1E` (bit3 = offline) | `0x36` (cover open) | `0x72` (paper out) |
| Paper low | `0x16` | `0x12` | `0x1E` (near-end, still prints) |

**Mute quirk:** the status transmitter goes silent after hearing reset
glitches, and every ESP32 firmware upload glitches the TX line. Symptom:
jobs fetch but nack with `EOT1=-1 EOT4=-1`. Fix: power-cycle the printer
after a flashing session. Printing still works while mute; only the status
probes fail, and the firmware refuses jobs without them (it can't verify
paper).

## Memorize-then-print (GS * / GS /)

- Supported, **column-major data**, and the spec's ~12KB size cap does
  not hold on this unit: probed accepting **100 blocks = 800 rows ≈ 58KB**
  in one definition. `CHUNK_BLOCKS` in `render/render-core.js` encodes this.
- `ESC 3 0` (zero line spacing) makes consecutive printed chunks butt
  together seamlessly.

## Tone / dot gain

Prints run darker than the dither: mildly in highlights, severely in
shadows (dark grays fuse to black), even on the "light" density DIP
setting. Compensated by the tone curve in `views/photo.liquid`
(keep-in-sync copy in `scripts/print-calibration.js`), calibrated over four
print iterations with `node scripts/print-calibration.js`. Re-run that
script against any new printer or paper stock.
