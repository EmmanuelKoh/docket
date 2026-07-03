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
| `STORE_DRIVER` | `json` | Storage backend: `json` (local files) or `redis` (Upstash + Blob) |
| `OWNER_ID` | `default` | Owner stamped on every stored record |
| `DEVICE_TOKEN` | `dev-token` | Shared secret for the device endpoints (`/next`, `/ack`, `/nack`) |
| `LEASE_SECONDS` | `120` | Redis driver: seconds before an unacked inflight job is requeued |
| `HEARTBEAT_SECONDS` | `30` | Seconds between `/tick` POSTs from `agent/heartbeat.js` |
| `POLL_INTERVAL` | `30` | Printer agent: ms between `/next` polls (legacy name) |
| `WATCH_TEAMS` | *(empty = all)* | Seeds the espn-worldcup plugin's `watchTeams` config on first registration |

All settings live in `config.js` and fall back to the defaults above when the
env var is unset. The redis driver additionally needs `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*` names the Vercel Marketplace
integration sets), and `BLOB_READ_WRITE_TOKEN` — see `.env.example`.

## Storage

All state lives behind three store interfaces — `lib/store.js` (templates),
`lib/job-store.js` (job queue), `lib/state-store.js` (poller state). Nothing
outside `lib/` touches files, Redis, or Blob directly. `STORE_DRIVER` selects
one of two interchangeable implementations:

- **`json`** (default) — everything in local files under `data/`. Zero setup,
  works offline; this is the dev fallback. No lease handling: an inflight job
  stays inflight until acked or nacked.
- **`redis`** — small live state (job queue, job records, templates, poller
  state) in Upstash Redis; heavy artifacts (each job's preview PNG and ESC/POS
  bytes) in Vercel Blob, referenced by URL from the job record. This is what
  lets the server half deploy to Vercel while the local printer agent and
  poller reach the same state.

**Queue semantics (redis driver):** claiming a job (`GET /next`) is a single
atomic Lua script, so two concurrent polls can never receive the same job. A
claimed job holds a lease for `LEASE_SECONDS` (default 120); if the printer
dies silently without acking, the lease expires and the job returns to the
front of the queue on the next claim — no print is ever lost. `/nack` requeues
immediately without waiting for the lease.

**Device token:** `/next`, `/ack`, and `/nack` require
`Authorization: Bearer <DEVICE_TOKEN>` and return 401 without it. The printer
agent sends it automatically; both sides read the same `.env` locally (default
`dev-token`). Set a long random value on any deployment reachable from outside.

**Multi-user-ready, not multi-user:** every record carries an `ownerId`
(hardcoded to `OWNER_ID`) and all Redis keys are namespaced by owner
(`rp:{owner}:...`). There are no accounts or logins yet — the fields and the
token mechanism exist so they can be added without a storage rewrite.

**Migrating existing local data** into Redis/Blob (idempotent — existing
records are never overwritten, safe to re-run):

```
npm run migrate
```

## Dashboard

`/dashboard` is the DOCKET management UI — server-rendered LiquidJS pages
with [htmx](https://htmx.org) for in-place updates, styled per
`docs/design-spec.md` (monochrome + register red, light "paper" and dark
"darkroom" themes; the moon/sun toggle in the nav persists via localStorage).

**The password door.** Set two env vars (see `.env.example`):
`DASHBOARD_PASSWORD` (what you type at `/login`) and `SESSION_SECRET`
(signs the session cookie). The cookie is stateless — an HMAC-signed,
httpOnly cookie valid for 30 days — so it works across serverless
invocations with no session storage. `/logout` clears it. The dashboard
pages, the studio, and the JSON APIs (`/templates`, `/jobs`, `/preview`)
all require it. The device endpoints (`/next`, `/ack`, `/nack`, `/tick`)
do NOT — they keep Bearer `DEVICE_TOKEN` auth only, because the ESP32
can't log in.

**Sections → stores:**

| Section | Backed by |
|---------|-----------|
| Home | counts from all three stores + device last-contact (state store) |
| Templates | template store (`lib/store.js`); Open/New load the studio at `/studio` |
| Plugins | plugin registry (`lib/plugin-registry.js`): toggle, interval, config JSON |
| Queue | job store queued/inflight; Cancel only while still queued (atomic) |
| History | job store done/failed/canceled; expand shows the debug record; Reprint re-renders from stored template + data |

**htmx polling.** The Queue list fragment re-fetches itself every 3 seconds
(`hx-trigger="every 3s"` swapping `/dashboard/fragments/queue`), which is
how status changes from the printer agent appear without websockets. The
job count in the title updates out-of-band in the same response. Everything
else swaps on demand: plugin toggles and config edits swap the card,
template deletes swap the list, history rows fetch their detail panel on
first click.

The old studio at `/` now redirects to `/dashboard`; the studio itself
lives at `/studio` (same editor, restyled to the DOCKET system) and is the
Templates section's editor.

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

Opens at `http://localhost:3000` — sign in and open `/studio` (or any
template's Open button in the dashboard's Templates section). Select a
starter template, edit the HTML/Liquid and the JSON data, and see the 1-bit
dithered preview update live.

- **Preview**: `POST /preview` runs the render core and returns the 1-bit PNG.
- **Print**: hit the Print button (or `Cmd+P`) to queue a job. The printer
  agent picks it up and sends it to the printer.
- **Storage**: templates are saved through `lib/store.js` — `data/templates.json`
  with the json driver, Upstash Redis with the redis driver; seeded from
  `reference/starter-templates.json` on first run either way.
- **Deploy to Vercel** (optional): `vercel` with `STORE_DRIVER=redis` and the
  Upstash/Blob env vars for a fully writable hosted studio. With the json
  driver the hosted studio is read-only (serverless filesystems don't persist).
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
| `POST` | `/tick` | Run registered plugins that are enabled and due |

All four require `Authorization: Bearer <DEVICE_TOKEN>` (the agents send it
automatically).

**Storage**: jobs are full debug records (inputs + rendered outputs), capped
at 50 by default (`JOB_CAP` env var), stored through `lib/job-store.js` —
see the Storage section for the json/redis drivers and lease semantics. With
the redis driver the hosted job queue works on Vercel.

### Plugins & /tick

Nothing in the system polls on its own timer. Plugins do one unit of work when
asked; a heartbeat (your Mac now, an ESP32 later) POSTs `/tick`, and the
server runs whichever registered plugins are enabled and due.

**What a plugin is** — a module in `plugins/` exporting three things:

```js
export const id = 'my-plugin';
export const defaults = { intervalSeconds: 60, config: {} };
export async function run({ config, state, ctx }) {
  // one unit of work; return the new state
  return { state };
}
```

Plugins never touch Redis, files, or HTTP routes directly — only `ctx`:

- `ctx.createJob({ template, data })` — queue a print job (renders via the
  job store / render-core)
- `ctx.getTemplate(name)` — fetch a template record from the template store
- `ctx.log(msg)` — prefixed console logging

Installed plugins are listed explicitly in `plugins/index.js`.

**How /tick decides what runs** — for each plugin, sequentially:

1. Ensure a registry record exists (`{ id, ownerId, enabled, intervalSeconds,
   lastRunAt, config, state }`, stored via `lib/plugin-registry.js` in
   `data/plugins.json` or Redis per `STORE_DRIVER`).
2. Skip if `enabled` is false, or if `now - lastRunAt < intervalSeconds`
   (not due). The heartbeat can tick every 30s while a plugin runs every 60s.
3. Take a short expiring run lock (same lease pattern as the job queue) — if
   a previous run is still going, skip instead of running twice concurrently.
4. Call `run()`, persist the returned `state` and `lastRunAt`. An error is
   recorded on the record (`lastError`, `lastErrorAt`) and the remaining
   plugins still run; `lastRunAt` advances either way, so a broken plugin
   retries at its own interval, not at heartbeat rate.

**Toggling a plugin today** — flip `enabled` on its registry record: edit
`data/plugins.json` (json driver) or the `rp:{owner}:plugin:{id}` key in the
Upstash console (redis driver). No UI yet.

### Morning brief plugin (`morning-brief`)

Prints the `Daily Brief` template once each morning: today's meetings
merged from one or more calendar iCal feeds, the day's weather
(Open-Meteo, no API key), and a focus line. Registers **disabled** —
configure it from the Plugins page, then flip the toggle.

| Config | Meaning |
|--------|---------|
| `icsUrls` | Array of secret iCal addresses — Google Calendar: Settings → [calendar] → "Secret address in iCal format". One per calendar; treat them as secrets. |
| `latitude` / `longitude` | Coordinates for the forecast |
| `timezone` | IANA zone defining "today" and `printAt` (e.g. `America/Los_Angeles`) |
| `printAt` | `"HH:MM"` local time after which the brief prints (default `06:30`) |
| `temperatureUnit` | `fahrenheit` (default) or `celsius` |
| `focus` | Focus-bar text; empty hides the bar |

Behavior: runs every 5 minutes but prints once per local day, on the
first tick at/after `printAt` (a late heartbeat prints late, same day —
never twice, never yesterday's). Recurring events are expanded; all-day
items are ignored; the same event on two calendars is deduped. If any
calendar feed fails the run errors visibly on the plugin card and
retries next interval rather than printing an incomplete brief; a
weather failure just degrades that stat to "—".

### World Cup plugin (`espn-worldcup`)

The first registry entry — it watches live FIFA World Cup matches via the
ESPN API and prints receipts for three events. One `run()` = one poll cycle
(default every 60s). It replaces the retired `agent/espn-poller.js`; the
detection logic was ported as-is.

| Event | Template | Trigger |
|-------|----------|---------|
| **Kickoff** | `WC Kickoff` | Match state changes from `pre` to `in` |
| **Goal** | `WC Goal` | A competitor's score increases |
| **Full-time** | `WC Full Time` | Match state changes from `in` to `post` |

**Run during a match** (three terminals — the heartbeat replaces the old
poller process):

```
npm start                       # server
node agent/printer-agent.js     # printer agent
node agent/heartbeat.js         # heartbeat -> POST /tick
```

On the first tick the plugin registers itself (importing any existing poller
state so nothing reprints, and `WATCH_TEAMS` from the env as its `watchTeams`
config) and the three WC templates are seeded into the template store if
missing. After that, team filtering is controlled by `config.watchTeams` on
the registry record.

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

**Dedup:** match state lives on the plugin's registry record (`state` field).
Each match tracks its API state, scores, printed flags, and per-team printed
goal counts. Nothing is reprinted across ticks or restarts. Score going down
(VAR reversal) updates stored state but prints nothing.

**Templates:** the three WC templates are seeded into the template store on
the first tick from `reference/wc-templates.json` if missing. They're editable
in the studio like any other template.

**Why a local heartbeat:** live goals need sub-minute cadence. Vercel cron
runs at most once per minute and is limited on the Hobby plan, so the pulse
comes from a local process (later the ESP32 itself) — but the decision of
what to run lives server-side in `/tick`, so the heartbeat stays dumb.

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
  tick.js                  POST /tick — run enabled + due plugins
  templates.js             GET/POST/DELETE /templates — template CRUD
plugins/
  index.js                 Explicit list of installed plugin modules
  espn-worldcup.js         World Cup plugin (kickoff/goal/full-time)
lib/
  store.js                 Template storage facade (json/redis driver)
  job-store.js             Job queue storage facade (json/redis driver)
  plugin-registry.js       Plugin registry facade (json/redis driver)
  state-store.js           Legacy poller state facade (json/redis driver)
  auth.js                  Device token check for /next, /ack, /nack
  redis.js                 Upstash Redis client + owner-namespaced keys
  blob.js                  Vercel Blob helpers (job png + bytes)
  stores/
    templates-json.js      Templates: data/templates.json
    templates-redis.js     Templates: Upstash Redis
    jobs-json.js           Jobs: data/jobs.json (no lease semantics)
    jobs-redis.js          Jobs: Redis queue (atomic claim + lease) + Blob
    plugins-json.js        Plugin registry: data/plugins.json
    plugins-redis.js       Plugin registry: Upstash Redis (+ run lock)
    state-json.js          State: data/{name}-state.json
    state-redis.js         State: Upstash Redis
scripts/
  migrate-json-to-redis.js One-time import of local JSON state into Redis/Blob
agent/
  printer-agent.js         Local printer agent (polls /next, prints, acks)
  heartbeat.js             Local heartbeat (POSTs /tick, drives plugins)
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
  espn-poller.js           Retired standalone poller (superseded by plugins/espn-worldcup.js + /tick)
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
