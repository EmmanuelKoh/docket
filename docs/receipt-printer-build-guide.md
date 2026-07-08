# Standalone Receipt Printer: Build Guide

Rongta RP850 + an ESP32, over the serial port, no computer attached. The
ESP32 runs `firmware/docket-agent/docket-agent.ino`, which replaces both Mac
processes: it polls the DOCKET server for jobs, streams them to the printer,
acks, and heartbeats `/tick` so plugins run.

The order below is deliberate: each stage adds **one** new thing and proves it
before the next, so when something breaks, only one thing can be the cause.

---

## Parts

- Rongta RP850 printer (with its power brick) + 80mm thermal paper
- An ESP32 board: either a classic ESP32 DevKit (WROOM-32) or a Seeed XIAO
  ESP32-S3; pin numbers for both are given at each step
- MAX3232 board (RS232-to-TTL) **with a male DB9 plug**; it plugs straight
  into the printer's serial port
- Jumper wires (male and female ends), breadboard optional
- USB cable that carries **data** (not a charge-only cable), for flashing
- USB wall brick, the ESP32's permanent power. No battery: the printer is
  mains-powered, so a battery only adds failure modes (and a bare LiPo can't
  drive a devkit's 5V regulator anyway; see the note in Stage 2)

A laptop for flashing the board and running the dev server.

---

## A few words you can't avoid

- **Baud rate**: the speed two devices talk at. Both ends must use the same number, or you get blank or garbled output.
- **TX / RX**: TX is the "send" wire, RX is the "receive" wire. One device's TX connects to the other's RX (they cross over).
- **TTL vs RS232**: same idea, different voltages. The ESP32 is TTL (low voltage). The printer is RS232 (higher). The MAX3232 board converts between them; that is its only job.
- **ESC/POS**: the standard set of byte commands receipt printers understand. "Print this text," "cut the paper," "beep" are all short byte sequences.

---

## Stages at a glance

0. Printer self-test: is the printer alive, and what baud is it set to?
1. ESP32 serial loopback: is the board and your serial code working, on its own?
2. First print: wire ESP32 to printer, print "hello".
3. Status read: detect paper-out.
4. Real firmware vs your laptop: docket-agent against the local dev server.
5. Break it on purpose: prove no print is ever lost.
6. Cutover: point at production, retire the Mac processes.

Stages 0 and 1 prove the two halves separately. Stage 2 is the only step where
wiring and baud are tested, and by then both halves are already known-good.

---

## Stage 0: Printer self-test

No computer, no code. This confirms the printer works and tells you its baud rate.

Steps:
1. Load paper, printer off.
2. Hold down the FEED button.
3. While holding, switch the printer on.
4. Release FEED within ~5 seconds.

**Done when:** a test page prints. On it, find the line showing **baud rate**
and the **interface**.

**Then set the baud to 115200.** The RP850 selects serial speed with DIP
switches (bottom of the printer; see its manual for the combination). Our
receipts are ~23KB of raster data: at 9600 baud that's 24 seconds a receipt;
at 115200 it's about 2.5s. Set the switches with the printer OFF, power on,
run the self-test again, and confirm the page now says **115200**.

**If it fails:**
- Nothing prints → check paper is loaded the right way (thermal side up), check power.
- Prints but no baud listed → photograph the page; the baud is usually under "Serial" or "Interface".

---

## Stage 1: ESP32 serial loopback

Goal: prove the ESP32 and your serial code work, with no printer involved.
You connect the board's send wire to its own receive wire, so anything it sends
comes straight back.

Pick your board's pin pair now and use it everywhere below:

| Board | TX pin | RX pin | Board name in the IDE |
|---|---|---|---|
| ESP32 DevKit (WROOM-32) | GPIO **17** | GPIO **16** | "ESP32 Dev Module" |
| XIAO ESP32-S3 | GPIO **43** (D6) | GPIO **44** (D7) | "XIAO_ESP32S3" |

Setup:
1. Install the Arduino IDE (arduino.cc → Software).
2. Add the ESP32 boards: File → Preferences → paste this into "Additional Boards URLs":
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   then Tools → Board → Boards Manager → install "esp32".
3. Tools → Board → select your board from the table above.
4. Plug in the board over USB, Tools → Port → select the new port
   (macOS: it looks like `/dev/cu.usbserial-…` or `/dev/cu.usbmodem…`).
   **No port appears?** Two usual causes: a charge-only USB cable (swap it),
   or a missing USB-serial driver: devkits use a CP210x or CH340 chip;
   recent macOS includes drivers, but if the port never shows, install the
   Silicon Labs CP210x driver and reboot.
5. With a jumper wire, connect your TX pin to your RX pin (the board talks
   to itself).

Sketch, with the two pin numbers set from the table:
```cpp
// Loopback test: whatever we send out TX comes straight back in RX.
HardwareSerial Link(1);
const int PIN_TX = 17;  // DevKit: 17, XIAO: 43
const int PIN_RX = 16;  // DevKit: 16, XIAO: 44

void setup() {
  Serial.begin(115200);              // to the computer screen
  Link.begin(115200, SERIAL_8N1, PIN_RX, PIN_TX);
}

void loop() {
  Link.print("ping");
  delay(50);
  while (Link.available()) Serial.write(Link.read()); // print what came back
  Serial.println();
  delay(1000);
}
```

Open Tools → Serial Monitor (set it to 115200).

**Done when:** you see "ping" appear every second.

**If it fails:**
- Nothing at all → wrong Port selected, or board not installed. Re-check Tools → Port.
- No "ping" → the TX-RX jumper isn't on the pins you set in the sketch; reseat it.
- Garbled text → Serial Monitor speed isn't 115200.

When this passes, remove the jumper. Your board and serial code are proven.

---

## Stage 2: First print

Now wire the board to the printer. Only wiring and baud are new here.

Wire the ESP32 to the MAX3232 board's TTL side (4 wires):

| ESP32 pin              | MAX3232 board pin |
|------------------------|-------------------|
| 3V3                    | VCC               |
| GND                    | GND               |
| TX (DevKit 17 / XIAO 43) | RXD             |
| RX (DevKit 16 / XIAO 44) | TXD             |

Notes:
- Power VCC from **3V3**, not 5V nor a battery. (Aside: this is also why a
  bare LiPo can't power the board: a devkit's regulator needs ~4.4V+ in to
  make a stable 3.3V; a 3.7V cell browns out the chip the moment wifi
  transmits. Power the board from a wall brick.)
- **The TX/RX label trap (read this before wiring).** Serial convention says
  TX crosses to RXD, but cheap MAX3232 modules disagree about what their
  TTL labels mean. On some, `RXD` is the module's input (cross: ESP32 TX →
  RXD). On others (including the modules this build was done with) the
  labels mean "connect your MCU's pin of this name here," so `RXD` is
  actually the module's OUTPUT and the correct wiring is **straight-through:
  ESP32 TX → TXD, ESP32 RX → RXD**. Wire it one way; if you get random
  garble, dropped leading characters ("ello"), intermittent silence, or
  prints that only work sometimes (at every baud, on multiple modules),
  that is bus contention from the wrong choice: the module's output and the
  ESP32's TX are fighting over one wire. Swap the two data wires and it
  clears completely. (Diagnostic fingerprint: the module loopback test
  below *passes only when the module's VCC is disconnected*, because the
  unpowered output stops fighting.)
- Plug the board's male DB9 into the printer's serial port.

Sketch, with pins from your table row; baud is 115200 from Stage 0:
```cpp
HardwareSerial Printer(1);
const uint32_t BAUD = 115200;
const int PIN_TX = 17;  // DevKit: 17, XIAO: 43
const int PIN_RX = 16;  // DevKit: 16, XIAO: 44

void setup() {
  Printer.begin(BAUD, SERIAL_8N1, PIN_RX, PIN_TX);
  delay(500);
  Printer.print("hello\n\n\n");
  Printer.write(0x1D); Printer.write(0x56); Printer.write(0x00); // cut paper
}

void loop() {}
```

**Done when:** "hello" prints and the paper cuts when the board powers on.

**If it fails:**
- Nothing prints, or random garble / partial text / works-sometimes → swap
  the two data wires (see the label trap note above). This was the actual
  cause of every flaky symptom in the original build.
- Still nothing → on the DB9 some printers expect pins 2 and 3 reversed. If your board exposes them, swap pin 2 and pin 3.
- Garbled characters at a *consistent* rate → baud mismatch. Re-run the Stage 0 self-test and confirm both ends agree.
- A stray junk character at the very start of a print → normal: the ESP32's
  TX pin floats during reset and the printer hears one phantom byte. The
  `ESC @` at the start of the sketch (and of every real receipt) resets
  printer state; the stray char is cosmetic and only occurs at board reset.
- Prints once then never again → that's normal; this sketch only prints at power-on. Press reset to repeat.

**The module loopback test:** when you can't tell whether the module or
the printer is the problem, test the module alone: unplug it from the
printer, bridge DB9 **pins 2 and 3** (second and third from the left in the
five-pin row, viewed facing the male pins), and run a sketch that sends
`ping N` out the printer serial and echoes what returns to the Serial
Monitor. Clean counting pings = module and wiring proven, suspect the
printer side. Silence or garble = module side. (Dupont female sockets sit
loosely on fat DB9 pins; press them firmly while watching the monitor.)

When this passes, the hardware is fully proven; everything after this point
is software.

---

## Stage 3: Status read (paper-out detection)

The printer can answer a "how are you?" question. You send 3 bytes and read 1 back.

Add this function and call it before printing:
```cpp
// Returns true if paper is present.
bool paperOK() {
  while (Printer.available()) Printer.read();   // clear old data
  Printer.write(0x10); Printer.write(0x04); Printer.write(0x04); // ask
  uint32_t t0 = millis();
  while (!Printer.available() && millis() - t0 < 300) delay(2);
  if (!Printer.available()) return true;        // no answer -> assume ok
  uint8_t s = Printer.read();
  return (s & 0x0C) == 0;                        // these bits set = paper low/out
}
```

Test: print only when `paperOK()` is true. Pull the paper roll out and run it;
it should refuse. Reload; it should print.

**Done when:** the board prints with paper in, and skips when paper is out.

**If it fails:**
- All probes silent → **power-cycle the printer** with the module correctly
  wired and plugged in. The printer's serial state can latch confused after
  a session of miswired (contention) traffic and stay mute until a clean
  boot. This looked exactly like a hardware fault and wasn't.
- Always says "out" → your printer reports status differently; log the raw
  status byte in each state (paper in / lid open / paper low) and adjust the
  bit mask. Reference values for this project's RP850 are in
  `rp850-field-notes.md`.
- Never detects out → the printer's TXD-back wire (to the ESP32 RX pin) isn't connected; recheck that wire.

---

## Stage 4: The real firmware, against your laptop

Everything below the wire is proven; now run the real thing. The firmware
is `firmware/docket-agent/docket-agent.ino`, the ESP32 version of the two
Mac processes. This stage points it at the dev server on your laptop so
mistakes stay off production.

1. On the laptop: `npm run dev` in the docket repo. Note the laptop's LAN IP
   (System Settings → Wi-Fi → Details, e.g. `192.168.1.20`).
2. **Stop the Mac's printer agent if it's pointed anywhere.** During this
   test only the ESP32 should be printing.
3. In `firmware/docket-agent/`, copy `secrets.h.example` to `secrets.h` and
   fill it in (**never** put credentials in the .ino: the repo is public;
   secrets.h is gitignored):
   - wifi name/password (must be a **2.4GHz** network)
   - server URL = `http://<laptop-ip>:3000`
   - device token = the `DEVICE_TOKEN` value from the repo's `.env`
   Then open `docket-agent.ino` in the Arduino IDE (it picks up secrets.h
   automatically from the same folder) and check `PIN_TX` / `PIN_RX` match
   your board.
4. Upload. Open the Serial Monitor (115200): you should see it join wifi,
   then `tick: ok` every 30s; that heartbeat is now running the plugins.
5. Open the local studio (`http://localhost:3000/studio`), hit **Print**.

**Done when:** the receipt prints from the ESP32 with no Mac process
involved, the Serial Monitor shows `job job-N: printed` then `ack`, and the
dashboard's job goes queued → printing → done.

**Measure your printer.** Every unit has physical quirks the datasheet
won't tell you: unprintable side margins, blade-to-data distance, the blank
leader between print head and cutter, status-byte values, real command
limits. This project's measured values, and the compensations built on
them, are collected in `rp850-field-notes.md`; use it as a checklist of
what to measure on your own hardware. One universal from it worth knowing
during bring-up: if status probes go silent after flashing the ESP32
(`EOT... = -1`), **power-cycle the printer**: reset glitches on the TX
line can mute its transmitter.

**If it fails:**
- Jobs fetch but nack with `EOT... = -1` → power-cycle the printer (see quirk above).
- Never joins wifi → 5GHz-only network name, or typo'd password.
- `tick: 401` / `next: 401` → `DEVICE_TOKEN` doesn't match the `.env`.
- Fetches but prints garbage → baud mismatch (Stage 0 vs `PRINTER_BAUD`).
- Prints a partial receipt then nacks → flow-control stall; enable XON/XOFF
  in the printer's serial settings if available, or drop the baud one step.

---

## Stage 5: Break it on purpose (never lose a print)

The server already guarantees a job is never lost (atomic claim + lease); this stage
proves the device cooperates. Queue a job for each drill and watch:

- **Printer switched off** → device nacks (pre-print probe fails), retries
  every 15s, prints when the printer comes back.
- **Paper out** → same, via the paper probe. Reload paper; it prints.
- **Wifi off mid-print** (kill the router/AP briefly) → the stream stalls,
  the device nacks or the lease expires; either way the job reprints
  complete. A torn half-receipt in the bin is expected; the complete one
  follows.
- **Server unreachable after printing** (stop `npm run dev` right as it
  prints) → Serial Monitor shows `ack failed — will retry`; restart the
  server; the ack lands before any new job is fetched. No double print.

**Done when:** all four drills end with exactly one complete printed
receipt and a clean queue.

---

## Stage 6: Cutover to production

1. In the sketch config, change `SERVER_URL` to the production Vercel URL
   and `DEVICE_TOKEN` to the production token. Re-upload.
2. Watch the Serial Monitor: `tick: ok` against production, then leave the
   ESP32 on its wall brick next to the printer.
3. On the Mac: stop `printer-agent.js` and `heartbeat.js` for good.
4. Confirm from the hosted dashboard: Home shows recent device contact, and
   a test print from the studio comes out of the printer.

The Mac is now out of the system: plugins run and receipts print with the
laptop closed.

---

## Quick wiring reference

```
 ESP32                 MAX3232 board          Printer
 -----                 -------------          -------
 3V3  -------------->  VCC
 GND  -------------->  GND
 TX (17 / 43) ------>  RXD
 RX (16 / 44) <-----   TXD
                       [ male DB9 ] -------> [ serial port ]
 Printer power: its own brick. ESP32 power: USB wall brick.
 Pins: DevKit TX=17 RX=16 · XIAO TX=43 RX=44. Baud: 115200 (DIP switches).
```

## Troubleshooting summary

| Symptom | First thing to check |
|---|---|
| Nothing prints (Stage 2) | Swap the two data wires (module label conventions vary) |
| Random garble / "ello" / works-sometimes, any baud | Bus contention; swap the two data wires |
| Loopback passes only with module VCC unplugged | Same cause (wrong TX/RX choice); swap the data wires |
| Still nothing | Swap DB9 pins 2 and 3 |
| Garbled text, consistently | Baud mismatch; self-test page must say 115200 |
| One junk char at print start | Reset-glitch phantom byte; cosmetic, ESC @ handles it |
| Loopback fails (Stage 1) | Wrong Port selected in Arduino IDE |
| No Port at all | Charge-only USB cable, or missing CP210x/CH340 driver |
| Won't join wifi | Network is 5GHz; use a 2.4GHz one |
| `401` in Serial Monitor | DEVICE_TOKEN doesn't match the server's |
| Partial print then nack | Flow-control stall; enable XON/XOFF on the printer |
| Paper-out never detected | Printer's TXD-back wire (to the RX pin) not connected |
