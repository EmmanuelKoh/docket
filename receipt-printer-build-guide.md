# Standalone Receipt Printer — Build Guide

Rongta RP850 + Seeed XIAO ESP32-S3, over the serial port, no computer attached.

The order below is deliberate: each stage adds **one** new thing and proves it
before the next. So when something breaks, only one thing can be the cause.

---

## Parts

Have:
- Rongta RP850 printer (with its power brick)
- Seeed XIAO ESP32-S3 board
- USB-C cable + charger (powers the ESP32)

Buy:
- MAX3232 board (RS232-to-TTL) **with a male DB9 plug** — plugs straight into the printer
- Jumper wires (get a pack with both male and female ends)
- 80mm thermal paper roll

A computer (for flashing the board and running a small test server) — any laptop.

---

## A few words you can't avoid

- **Baud rate** — the speed two devices talk at. Both ends must use the same number, or you get blank or garbled output.
- **TX / RX** — TX is the "send" wire, RX is the "receive" wire. One device's TX connects to the other's RX (they cross over).
- **TTL vs RS232** — same idea, different voltages. The ESP32 is TTL (low voltage). The printer is RS232 (higher). The MAX3232 board converts between them. That's its only job.
- **ESC/POS** — the standard set of byte commands receipt printers understand. "Print this text," "cut the paper," "beep" are all short byte sequences.

---

## Stages at a glance

0. Printer self-test — is the printer alive, and what baud is it set to?
1. ESP32 serial loopback — is the board and your serial code working, on its own?
2. First print — wire ESP32 to printer, print "hello".
3. Status read — detect paper-out.
4. Fetch and print — ESP32 pulls text from a server over wifi.
5. Reliable loop — never lose a print (retry on failure).
6. Real content — the server sends actual notes.

Stages 0 and 1 prove the two halves separately. Stage 2 is the only step where
wiring and baud are tested, and by then both halves are already known-good.

---

## Stage 0 — Printer self-test

No computer, no code. This confirms the printer works and tells you its baud rate.

Steps:
1. Load paper, printer off.
2. Hold down the FEED button.
3. While holding, switch the printer on.
4. Release FEED within ~5 seconds.

**Done when:** a test page prints. On it, find the line showing **baud rate**
(often 19200 or 9600) and the **interface**. Write the baud number down — you
need it in Stage 2.

**If it fails:**
- Nothing prints → check paper is loaded the right way (thermal side up), check power.
- Prints but no baud listed → photograph the page; the baud is usually under "Serial" or "Interface".

---

## Stage 1 — ESP32 serial loopback

Goal: prove the ESP32 and your serial code work, with no printer involved.
You connect the board's send wire to its own receive wire, so anything it sends
comes straight back.

Setup:
1. Install the Arduino IDE.
2. Add the ESP32 boards: File → Preferences → paste this into "Additional Boards URLs":
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   then Tools → Board → Boards Manager → install "esp32".
3. Tools → Board → select **XIAO_ESP32S3**.
4. Plug in the board, Tools → Port → select the new port.
5. With a jumper wire, connect pin **D6** to pin **D7** on the board (TX to RX).

Sketch:
```cpp
// Loopback test: whatever we send out D6 comes back in D7.
HardwareSerial Link(1);

void setup() {
  Serial.begin(115200);              // to the computer screen
  Link.begin(9600, SERIAL_8N1, 44, 43); // RX=D7/GPIO44, TX=D6/GPIO43
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
- "ping" only with the D6–D7 jumper removed → wiring of the jumper; reseat it.
- Garbled text → Serial Monitor speed isn't 115200.

When this passes, remove the D6–D7 jumper. Your board and serial code are proven.

---

## Stage 2 — First print

Now wire the board to the printer. Only wiring and baud are new here.

Wiring — ESP32 to the MAX3232 board's TTL side (4 wires):

| ESP32 pin        | MAX3232 board pin |
|------------------|-------------------|
| 3V3              | VCC               |
| GND              | GND               |
| D6 (GPIO43, TX)  | RXD               |
| D7 (GPIO44, RX)  | TXD               |

Notes:
- Power VCC from **3V3**, not 5V. This keeps the board's logic at 3.3V, which is safe for the ESP32.
- TX goes to RXD, RX goes to TXD — they cross. (Board RXD = "data into the printer". Board TXD = "data the printer sends back".)
- Plug the board's male DB9 into the printer's serial port.

Sketch — set `BAUD` to the number from Stage 0:
```cpp
HardwareSerial Printer(1);
const uint32_t BAUD = 19200; // <-- from the Stage 0 self-test page

void setup() {
  Printer.begin(BAUD, SERIAL_8N1, 44, 43); // RX=D7, TX=D6
  delay(500);
  Printer.print("hello\n\n\n");
  Printer.write(0x1D); Printer.write(0x56); Printer.write(0x00); // cut paper
}

void loop() {}
```

**Done when:** "hello" prints and the paper cuts when the board powers on.

**If it fails:**
- Nothing prints → first suspect: TX/RX are not crossed. Swap the D6 and D7 wires.
- Still nothing → on the DB9 some printers expect pins 2 and 3 reversed. If your board exposes them, swap pin 2 and pin 3. (This is the classic serial gotcha.)
- Garbled characters → wrong baud. Re-check the Stage 0 number and update `BAUD`.
- Prints once then never again → that's normal; this sketch only prints at power-on. Press reset to repeat.

When this passes, the hardware is fully proven. Everything after is software.

---

## Stage 3 — Status read (paper-out detection)

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
- Always says "out" → your printer reports status differently; try reading after a longer delay, or treat any reply as "ok" for now and revisit later.
- Never detects out → the printer's TXD-back wire (D7/RX side) isn't connected; recheck that wire.

---

## Stage 4 — Fetch and print

The ESP32 joins wifi, asks a server for text, and prints it.

Tiny server (run on your laptop — needs Python):
```python
# server.py  —  run:  pip install flask  then  python server.py
from flask import Flask, Response
app = Flask(__name__)

@app.route("/next")
def next_job():
    return Response("hello from the server\n\n\n", mimetype="text/plain")

app.run(host="0.0.0.0", port=8080)
```
Find your laptop's local IP (e.g. 192.168.1.20) — you'll point the ESP32 at it.

ESP32 sketch (builds on Stage 2):
```cpp
#include <WiFi.h>
#include <HTTPClient.h>

HardwareSerial Printer(1);
const uint32_t BAUD = 19200;
const char* SSID = "your-wifi";
const char* PASS = "your-password";
const char* URL  = "http://192.168.1.20:8080/next"; // your laptop IP

void setup() {
  Printer.begin(BAUD, SERIAL_8N1, 44, 43);
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
}

void loop() {
  HTTPClient http;
  http.begin(URL);
  if (http.GET() == 200) {
    Printer.print(http.getString());
    Printer.write(0x1D); Printer.write(0x56); Printer.write(0x00); // cut
  }
  http.end();
  delay(15000); // ask again in 15s
}
```

**Done when:** the server's text prints by itself every 15 seconds.

**If it fails:**
- Never connects to wifi → check SSID/password; the ESP32 only joins 2.4GHz networks, not 5GHz.
- Connects but no print → wrong IP, or laptop firewall blocking port 8080. Open the URL in your phone's browser (same wifi) to confirm the server answers.

---

## Stage 5 — Reliable loop (never lose a print)

Goal: if a print fails, the server keeps it and tries again, instead of dropping it.

Server changes:
- Hold a job until the ESP32 confirms it printed.
- Add `/ack` (mark done) and `/nack` (put it back in the queue).

ESP32 changes:
- Before printing, call `paperOK()` from Stage 3. If not ok, call `/nack` and stop.
- After printing, call `/ack`.

Test the ugly cases on purpose:
- Printer switched off → job should still be waiting when it comes back on.
- Paper out → job re-queues, prints after you reload.
- Wifi dropped mid-print → job not marked done, prints on the next round.

**Done when:** in all three cases, the note eventually prints and is never lost.

This is the hardest stage. If you only want it working for yourself, it's fine to
stop at Stage 4 and come back to this later.

---

## Stage 6 — Real content

Now the server decides what to print: a to-do, a morning summary, a reminder.
Everything beneath is already proven, so from here you only change the server —
never the wiring or the board.

Pick the first real note before starting this stage; that decides what the
server needs to fetch and format.

---

## Quick wiring reference

```
 ESP32 (XIAO)        MAX3232 board          Printer
 -----------         -------------          -------
 3V3  ------------>  VCC
 GND  ------------>  GND
 D6 (TX) --------->  RXD
 D7 (RX) <--------   TXD
                     [ male DB9 ] --------> [ serial port ]
 Printer power: its own brick. ESP32 power: USB-C.
```

## Troubleshooting summary

| Symptom | First thing to check |
|---|---|
| Nothing prints (Stage 2) | TX/RX not crossed — swap D6 and D7 wires |
| Still nothing | Swap DB9 pins 2 and 3 |
| Garbled text | Wrong baud — match the Stage 0 self-test number |
| Loopback fails (Stage 1) | Wrong Port selected in Arduino IDE |
| Won't join wifi | Network is 5GHz; use a 2.4GHz one |
| Server unreachable | Wrong laptop IP, or firewall on port 8080 |
| Paper-out never detected | TXD-back wire (to D7) not connected |
```
