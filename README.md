# receipt-printer

Thermal receipt system for a 576px-wide (80mm) ESC/POS printer. Templates are
authored as Liquid + flexbox HTML, rendered to a 1-bit dithered image entirely
in Node (no headless browser), and sent to the printer as raw ESC/POS raster
bytes over TCP.

Pipeline: **Liquid template + data -> HTML -> Satori (flexbox layout) -> SVG ->
resvg (PNG) -> Floyd-Steinberg dither -> hand-built ESC/POS GS v 0 bytes**

## Install

```
npm install
```

Requires DejaVu TTF fonts on the system. On Debian/Ubuntu:
```
sudo apt install fonts-dejavu
```
On macOS (via Homebrew):
```
brew install font-dejavu
```

## Configuration

Copy the example env file and fill in your values:

```
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PRINTER_IP` | `192.168.1.87` | Printer's IP address on your network |
| `PRINTER_PORT` | `9100` | Raw TCP port (9100 is standard) |
| `PRINT_WIDTH` | `576` | Pixel width (576 for 80mm, 384 for 58mm) |
| `FONT_DIR` | `/usr/share/fonts/truetype/dejavu` | Path to directory with DejaVu TTFs |
| `JOB_CAP` | `50` | Max stored jobs before oldest done jobs are trimmed |
| `POLL_INTERVAL` | `30` | ESPN poller: seconds between polls |
| `WATCH_TEAMS` | *(empty = all)* | ESPN poller: comma-separated team abbreviations (e.g. `USA,POR`) |

All settings live in `config.js` and fall back to the defaults above when the
env var is unset.

## Usage

### Render a receipt

```js
import { renderToEscpos } from './render/render-core.js';

const template = `
<div style="display:flex; flex-direction:column; padding:20px; font-family:Sans">
  <h1>{{ title }}</h1>
  <p>{{ body }}</p>
</div>`;

const { bytes, preview, width, height } = await renderToEscpos(template, {
  title: 'Hello',
  body: 'Printed from Node.',
});

// bytes   — Buffer of ESC/POS data, ready to send to the printer
// preview — Buffer of a PNG showing exactly what will print (1-bit)
```

### Send to the printer

```js
import { printToNetwork } from './transport/print-net.js';

await printToNetwork(bytes);           // uses PRINTER_IP and PRINTER_PORT from config
await printToNetwork(bytes, '10.0.0.5', 9100);  // or pass explicit host/port
```

### Design Studio

The hosted design studio previews templates with the **real render core** — the
exact same Liquid → Satori → resvg → Floyd-Steinberg pipeline that produces
print bytes. What you see is what prints.

```
npm start
```

Opens at `http://localhost:3000`. Select a starter template, edit the
HTML/Liquid and the JSON data, and see the 1-bit dithered preview update live.

- **Preview**: `POST /preview` runs the render core and returns the 1-bit PNG.
- **Print**: hit the Print button (or `Cmd+P`) to queue a job. The printer
  agent picks it up and sends it to the printer.
- **Storage**: templates are saved to `data/templates.json` locally, seeded from
  `reference/starter-templates.json` on first run.
- **Deploy to Vercel** (optional): `vercel`. The studio is read-only on hosted
  until a persistent store (Vercel KV/Blob) is added.
- The old offline approximation tool is archived at
  `reference/receipt-design-studio.html`.

### Print Queue

The studio uses a job queue to decouple "create a print job" from "send bytes to
the printer." This is the same contract the ESP32 firmware will use.

**Job lifecycle:**

```
Studio Print button
  -> POST /jobs { template, data }
  -> renderToEscpos (immediate, render-on-create)
  -> job stored: { id, template, data, png, bytes, status: queued }
  -> printer agent polls GET /next
  -> 200 + ESC/POS bytes + X-Job-Id header
  -> agent sends bytes to printer via printToNetwork
  -> POST /ack?job=ID -> status: done
     (or POST /nack?job=ID on failure -> status: queued, retry)
```

**Run the printer agent** (local "device" — your Mac standing in for the ESP32):

```
node agent/printer-agent.js
```

The agent polls the server every 3 seconds. When it finds a queued job, it sends
the bytes to the printer and acks. On send failure, it nacks and the job is
requeued. The studio's recent-jobs panel shows live status updates.

**Device-facing endpoints** (firmware-compatible contract):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/next` | Oldest queued job as ESC/POS bytes + `X-Job-Id`, or 204 |
| `POST` | `/ack?job=ID` | Mark job done |
| `POST` | `/nack?job=ID` | Requeue job for retry |

**Storage**: jobs are stored in `data/jobs.json` with full debug records
(inputs + rendered outputs). Capped at 50 by default (`JOB_CAP` env var).
The hosted job queue requires Vercel KV/Blob — until that swap is built, the
job endpoints work only when running locally.

### World Cup Poller

A local long-running script that watches live FIFA World Cup matches via the
ESPN API and automatically prints receipts for three events:

| Event | Template | Trigger |
|-------|----------|---------|
| **Kickoff** | `WC Kickoff` | Match state changes from `pre` to `in` |
| **Goal** | `WC Goal` | A competitor's score increases |
| **Full-time** | `WC Full Time` | Match state changes from `in` to `post` |

**Run during a match** (three terminals):

```
npm start                       # server
node agent/printer-agent.js     # printer agent
node agent/espn-poller.js       # ESPN poller
```

Optionally filter to specific teams: `WATCH_TEAMS=USA,POR node agent/espn-poller.js`

**How goal detail works:** when a score increase is detected, the poller fetches
the ESPN summary endpoint to get the scorer and minute. Goals are extracted from
`summary.rosters[].roster[].plays[]` where `scoringPlay === true`, with the
scorer at `player.athlete.displayName` and minute at `play.clock.displayValue`.
Own goals are identified via `play.ownGoal`. These paths are confirmed against
live World Cup 2026 data (POR 5-0 UZB: 7 goals extracted correctly including
an own goal). If the summary
call fails or returns no new goal entries, the poller falls back to a score-diff
goal (scoreline only, no scorer/minute). A print is never blocked on the
summary enhancement.

**Dedup:** state is persisted to `data/espn-state.json` — each match tracks its
API state, scores, printed flags, and a list of printed goal keys (composed from
athlete ID + minute). Nothing is reprinted across polls or restarts. Score going
down (VAR reversal) updates stored state but prints nothing.

**Templates:** the three WC templates are seeded into the template store on
first run from `reference/wc-templates.json`. They're editable in the studio
like any other template.

**Why local:** live goals need 20-30s polling. Vercel cron runs at most once per
minute and is limited on the Hobby plan, so the poller runs as a local
long-running process, like the printer agent.

### Design templates (offline)

`reference/receipt-design-studio.html` can be opened directly in a browser for
quick offline sketching. It uses html2canvas + client-side dithering which only
approximates the print output — use the hosted studio above for accurate
previews.

## Project layout

```
config.js                  Environment config (reads .env)
server.js                  Local dev server for studio + print queue
vercel.json                Vercel routing config
render/
  render-core.js           Liquid -> Satori -> resvg -> dither -> ESC/POS
api/
  preview.js               POST /preview — render template to 1-bit PNG
  jobs.js                  GET/POST /jobs — create + list print jobs
  next.js                  GET /next — device endpoint, fetch queued job
  ack.js                   POST /ack — device endpoint, mark job done
  nack.js                  POST /nack — device endpoint, requeue job
  templates.js             GET/POST/DELETE /templates — template CRUD
lib/
  store.js                 Template storage (local JSON file / read-only on Vercel)
  job-store.js             Job queue storage (local JSON file)
agent/
  printer-agent.js         Local printer agent (polls /next, prints, acks)
  espn-poller.js           ESPN World Cup poller (kickoff/goal/full-time)
public/
  index.html               Design studio frontend (preview + print + jobs panel)
transport/
  print-net.js             TCP sender (printToNetwork)
firmware/
  rp850_endpoint.ino       ESP32 firmware (for later)
docs/
  receipt-printer-build-guide.md   Hardware build guide
  *.png                    Documentation images
reference/
  starter-templates.json   Starter templates (seeds the local store)
  wc-templates.json        World Cup templates (kickoff, goal, full-time)
  receipt-design-studio.html  Archived offline previewer (html2canvas-based)
  server.py                Python job-queue server (reference, superseded by api/)
  render.py                Python renderer (reference, superseded by render-core.js)
  mock_board.py            Fake ESP32 (reference, superseded by printer-agent.js)
  print_net.py             Python TCP sender (superseded by print-net.js)
  print_usb.py             Python USB sender (unused)
  html_to_png.py           Browser-based HTML renderer (superseded by Satori pipeline)
data/                      Runtime store: templates + jobs (gitignored)
jobs/                      Sample receipt PNGs for the print queue
```

## Notes

- **Flexbox**: every container with more than one child needs explicit
  `display:flex` (Satori requirement).
- **Borders**: `solid` and `dashed` only; `dotted` is not supported by Satori.
- The Python files in `reference/` are the original server loop and renderer.
  They work but are pending a full JS rewrite. Do not expand them.
