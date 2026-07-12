# docket

A thermal-receipt platform for an 80mm (576px) ESC/POS printer: a hosted
server renders Liquid+HTML templates into printer bytes; an ESP32 appliance
polls for jobs and prints them. Plugins print autonomously on schedules
(live sports goals, a daily morning brief) or on push (SMS/RCS messages
classified into task receipts by Gemini); a multi-user dashboard
(invite-only accounts, each with their own templates, plugins, history,
and paired printer) manages it all. Templates are
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
| `DATABASE_URL` | *(unset = PGlite)* | Postgres connection (Neon hosted; unset = embedded PGlite in `data/pg`) |
| `BETTER_AUTH_SECRET` | *(required hosted)* | Signs account session cookies |
| `BETTER_AUTH_URL` | *(unset = inferred)* | Canonical origin in production |
| `OWNER_ID` | `default` | Which owner the local-dev `DEVICE_TOKEN` resolves to |
| `DEVICE_TOKEN` | `dev-token` (local only) | Lets the laptop agents into the device endpoints; no default hosted |
| `LEASE_SECONDS` | `120` | Redis driver: seconds before an unacked inflight job is requeued |
| `HEARTBEAT_SECONDS` | `30` | Seconds between `/tick` POSTs from `agent/heartbeat.js` |
| `POLL_INTERVAL` | `30` | Printer agent: ms between `/next` polls (legacy name) |
| `WATCH_TEAMS` | *(empty = all)* | Seeds the espn-worldcup plugin's `watchTeams` config on first registration |
| `GEMINI_API_KEY` | *(unset = ingest off)* | Google AI Studio key for task classification |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Gemini model for the classifier (also editable per-plugin) |
| `INGEST_TIMEZONE` | `America/New_York` | "Received at" timezone on task receipts |

All settings live in `config.js` and fall back to the defaults above when the
env var is unset. The redis driver additionally needs `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*` names the Vercel Marketplace
integration sets), and `BLOB_READ_WRITE_TOKEN` (see `.env.example`).

## Storage

Three stores, split by what each is good at. Nothing outside `lib/` and
`db/` touches Postgres, Redis, Blob, or files directly, and every store
call takes an explicit `ownerId` (derived from the session, or from the
device's pairing token).

- **Postgres** is the system of record: accounts, sessions, invites,
  paired devices, templates, job records, tape-take metadata, and plugin
  config. Neon when `DATABASE_URL` is set; without it, local dev runs
  PGlite (an embedded Postgres in `data/pg`) with no cloud account,
  auto-migrating on first use. Schema is Drizzle (`db/schema.js`,
  migrations in `db/migrations/`).
- **Redis** (`STORE_DRIVER=redis`, Upstash) keeps the hot path only: the
  print queue and its lease, the plugin due-index and runtime state, and
  the device-token mirror. `STORE_DRIVER=json` (default) swaps these for
  local equivalents (no lease; artifacts inline).
- **Vercel Blob** holds artifacts (job PNG/bytes under `jobs/{owner}/`,
  tape documents and WAVs under `tape/{owner}/`) plus the tiny per-owner
  queue/tick flags that let idle device polls skip Redis entirely.

The device endpoints never touch Postgres on their polling cadence, so
Neon scales to zero; `docs/store-costs.md` has the cost math and the
quota rules for adding anything polled.

**Queue semantics (redis driver):** claiming a job (`GET /next`) is a single
atomic Lua script, so two concurrent polls can never receive the same job. A
claimed job holds a lease for `LEASE_SECONDS` (default 120); if the printer
dies silently without acking, the lease expires and the job returns to the
front of the queue on the next claim, so the job is not lost. `/nack` requeues
immediately without waiting for the lease.

**Device auth:** `/next`, `/ack`, `/nack`, and `/tick` require a Bearer
token and return 401 without one. Real printers get a per-device token
from pairing: an unpaired device POSTs `/pair`, prints a short code on
its own paper, and the owner claims the code on the dashboard's Printer
page. Tokens are stored hashed; verification runs on a memory cache and
a Redis mirror so polling never queries Postgres. A printer can be
shared with other accounts: the owner mints a single-use share code in
the dashboard and the other person enters it on their own Printer page;
the device then serves every member's queue and scheduled plugins while
each keeps a fully separate docket. Locally, the laptop agents use the
shared `DEVICE_TOKEN` (default `dev-token`), which resolves to the
`OWNER_ID` owner and has no default when hosted.

## Dashboard

The dashboard is a Next.js app (React, Tailwind, and a small shadcn-style
component kit) styled per `docs/design-spec.md` (monochrome + register red,
light "paper" and dark "darkroom" themes; the moon/sun toggle in the header
persists via localStorage). A collapsible sidebar holds the pages below.

**Authentication.** Accounts are email + password (Better Auth on
Postgres) and signup is invite-only: admins mint invite links on the
Users page, one link creates one account. Create the first admin with
`node scripts/create-user.js "Name" email` (it prompts for the password).
Session checks are served from a signed cookie cache, so a page view
costs zero database reads. The dashboard pages, the Studio, and the JSON
routes (`/api/*`, plus `/templates`, `/preview`, `/jobs`) all require the
session, and every read and write is scoped to the signed-in owner. The
device endpoints (`/next`, `/ack`, `/nack`, `/tick`) never use the
cookie; they authenticate with per-device pairing tokens, because the
ESP32 can't log in.

**Pages → stores:**

| Page | Backed by |
|------|-----------|
| Overview | counts from all three stores + device last-contact (state store) |
| Slips | plugin registry + template store, unified: each slip shows a preview, its schedule and per-field config with an explicit Save, and a Print test. Templates are edited in the Studio |
| Photo | print tool: upload or shoot a picture, live dithered preview via `/preview`, prints the seeded "Photo Print" template with an optional caption |
| Queue | job store queued/inflight; Cancel a queued job, or Requeue an inflight one whose claim is stuck |
| History | job store done/failed/canceled; expand shows the debug record; Reprint re-renders from stored template + data |
| Tape | live instrument transcription (mic to printed tape); saved takes with editing, phrases, and per-phrase printing |
| Printer | device status, configuration, pairing, and sharing (a printed code claims a device; a share code from its owner joins it; Share/Leave/Revoke per row) |
| Users | admin only: accounts and invite links |

**Polling.** The Queue page re-fetches `/api/queue` every 3 seconds while
the tab is visible, so status changes from the printer appear without
websockets. Hidden tabs do not poll (see `docs/store-costs.md`).

The Studio (the template editor) lives at `/studio` and is reached from a
slip's "Open in Studio" link. Old `/dashboard` URLs redirect to `/`.

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

The hosted design studio previews templates with the real render core: the
same Liquid → Satori → resvg → Floyd-Steinberg pipeline that produces the
print bytes, so the preview matches the printed output.

```
npm run dev
```

Opens at `http://localhost:3000`. Sign in and open `/studio` (or any
slip's Open in Studio link on the Slips page). Select a starter
template, edit the HTML/Liquid and the JSON data, and see the 1-bit
dithered preview update live.

- **Preview**: `POST /preview` runs the render core and returns the 1-bit PNG.
- **Print**: hit the Print button (or `Cmd+P`) to queue a job. The printer
  agent picks it up and sends it to the printer.
- **Storage**: templates are saved through `lib/store.js` into Postgres,
  one set per owner, seeded from `reference/starter-templates.json` on an
  owner's first template read. `docs/template-authoring.md` is the
  constraint sheet for writing them (hand it to an LLM and it should
  produce working templates first try).
- **Deploy to Vercel** (optional): `vercel` with `STORE_DRIVER=redis`, the
  Upstash/Blob env vars, and the Neon integration for `DATABASE_URL`.
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

**Run the printer agent** (local "device", your Mac standing in for the ESP32):

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

All four require a Bearer token: a pairing token on real devices, or the
local-dev `DEVICE_TOKEN` that the agents send automatically.

**Storage**: jobs are full debug records (inputs + rendered outputs), capped
at 50 by default (`JOB_CAP` env var), stored through `lib/job-store.js`;
see the Storage section for the json/redis drivers and lease semantics. With
the redis driver the hosted job queue works on Vercel.

### Plugins & /tick

Nothing in the system polls on its own timer. Plugins do one unit of work when
asked; a heartbeat (your Mac now, an ESP32 later) POSTs `/tick`, and the
server runs whichever registered plugins are enabled and due.

**What a plugin is:** a module in `plugins/` exporting three things:

```js
export const id = 'my-plugin';
// schedule: { every: seconds } for watchers, or
// { at: 'HH:MM', timezone: 'America/New_York' } for once-a-day plugins.
// Push-driven plugins export `passive: true` and no schedule.
export const defaults = { schedule: { every: 60 }, config: {} };
export async function run({ config, state, ctx }) {
  // one unit of work; return the new state
  return { state };
}
```

Plugins never touch Redis, files, or HTTP routes directly; they go through
`ctx`:

- `ctx.createJob({ template, data })`: queue a print job (renders via the
  job store / render-core)
- `ctx.getTemplate(name)`: fetch a template record from the template store
- `ctx.log(msg)`: prefixed console logging

Installed plugins are listed explicitly in `plugins/index.js`.

**How /tick decides what runs.** Each plugin's record carries its
`schedule` and a derived `nextDueAt`, kept in a sorted due-index by the
store layer (`lib/plugin-registry.js` and `lib/schedule.js`). A tick makes
one atomic claim of everything due, so an idle tick is a single store
command regardless of plugin count. The claim leases what it returns:
concurrent ticks can't double-run a plugin, and a crashed run becomes due
again after about 90 seconds. A failed run records `lastError` on the
record (shown in red on its card) and retries at the lease cadence. On
success the next due time is computed from now, so a printer that was off
past a due time runs the plugin once, late, without a backlog.

**Toggling and configuring.** The dashboard's Slips page has the
enable/disable toggle, the schedule (`every Ns` or `at HH:MM` plus
timezone), and per-field config, saved with a Save button. Registration, record
migration, and plugin-template seeding happen on the Slips page view
(never on ticks): a new owner's plugins activate on their first visit.

### Morning brief plugin (`morning-brief`)

Prints the `Daily Brief` template once each morning: today's meetings
merged from one or more calendar iCal feeds, the day's weather
(Open-Meteo, no API key), and a focus line. Registers **disabled**;
configure it from its Slips page, then flip the toggle.

| Config | Meaning |
|--------|---------|
| `icsUrls` | Array of secret iCal addresses (Google Calendar: Settings → [calendar] → "Secret address in iCal format"). One per calendar; treat them as secrets. |
| `latitude` / `longitude` | Coordinates for the forecast |
| `timezone` | IANA zone defining "today" for the calendar (usually matches the schedule's timezone) |
| `temperatureUnit` | `fahrenheit` (default) or `celsius` |
| `focus` | Focus-bar text; empty hides the bar |

Behavior: scheduled `at 06:30` (edit the time/timezone on its card); prints
once per local day (a printer offline at print time prints late the same
day; it does not print twice or print the previous day's brief). Recurring events are expanded; all-day
items are ignored; the same event on two calendars is deduped. If any
calendar feed fails the run errors visibly on the plugin card and
retries next interval rather than printing an incomplete brief; a
weather failure just degrades that stat to "—".

### World Cup plugin (`espn-worldcup`)

The first registry entry. It watches live FIFA World Cup matches via the
ESPN API and prints receipts for three events. One `run()` = one poll cycle
(default every 60s). It replaces the retired `agent/espn-poller.js`; the
detection logic was ported as-is.

| Event | Template | Trigger |
|-------|----------|---------|
| **Kickoff** | `WC Kickoff` | Match state changes from `pre` to `in` |
| **Goal** | `WC Goal` | A competitor's score increases |
| **Full-time** | `WC Full Time` | Match state changes from `in` to `post` |

**Run during a match** (three terminals; the heartbeat replaces the old
poller process):

```
npm run dev                     # server
node agent/printer-agent.js     # printer agent
node agent/heartbeat.js         # heartbeat -> POST /tick
```

On the first Slips page view the plugin registers itself (importing any
existing poller state so nothing reprints, and `WATCH_TEAMS` from the env
as its `watchTeams` config) and the three WC templates are seeded into
the template store if missing. After that, team filtering is controlled by `config.watchTeams` on
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

**Templates:** the three WC templates are seeded into the template store
from `reference/wc-templates.json` if missing. They're editable
in the studio like any other template.

**Why a local heartbeat:** live goals need sub-minute cadence. Vercel cron
runs at most once per minute and is limited on the Hobby plan, so the pulse
comes from a local process (later the ESP32 itself), but the decision of
what to run lives server-side in `/tick`, so the heartbeat carries no
scheduling logic.

### SMS/RCS task capture (`message-ingest`)

Forward incoming texts to `POST /ingest`. Gemini extracts the tasks in each
message and prints a "Task" slip for each. Related actions or items are
grouped onto one slip as a list (a shopping list, or the steps of a
routine, numbered when they must be done in order); unrelated tasks each
get their own slip. So "Get milk and eggs, and wish your dad happy
birthday" prints two slips: a grocery checklist and a "Wish Dad happy
birthday" task. Titles and items are worded from the recipient's
perspective and due dates are resolved from phrases like "by friday". A
message starting with `task:` always prints, regardless of the classifier.
The plugin is *passive* (push-driven, never run on a timer) but appears on
the Slips page with an enable toggle and config for min confidence,
timezone, and Gemini model.

The endpoint is authenticated by the per-owner token shown on the
message-ingest Slips page (Bearer header or `?token=`), which also routes
the message to that owner. It accepts
`{ text, sender, source?, receivedAt? }`, so anything that can
POST JSON can feed it. For phones, `android-forwarder/` in this repo is a
small Android app that reads both SMS and RCS from the telephony provider
(including while the conversation is open on screen, which
notification-based forwarders miss), resolves sender numbers to contact
names, and retries failed sends. See `android-forwarder/README.md` for
build and setup.

### Design templates (offline)

`reference/receipt-design-studio.html` can be opened directly in a browser for
quick offline sketching. It uses html2canvas + client-side dithering which only
approximates the print output; use the hosted studio above for accurate
previews.

## Project layout

```
config.js                  Environment config (reads .env)
next.config.mjs            Next.js config (externals, file tracing, redirects)
middleware.ts              Optimistic login redirect for dashboard pages
render/
  render-core.js           Liquid -> Satori -> resvg -> dither -> ESC/POS
db/
  schema.js                Drizzle schema (every Postgres table)
  migrations/              Generated SQL (npm run db:generate / db:migrate)
app/                       The Next.js app (dashboard pages + all endpoints)
  (dashboard)/             Overview, Slips, Photo, Tape, Queue, History,
                           Printer, Users pages
  (dashboard)/studio/      Template editor (React, highlight-overlay editors)
  login/ invite/ logout/   Account pages (sign in, invite acceptance)
  api/auth/                Better Auth endpoints (catch-all)
  next/ ack/ nack/ tick/   Device endpoints (Bearer pairing token)
  pair/                    Unauthenticated pairing endpoint (printed code)
  ingest/                  POST /ingest: classify forwarded messages, print tasks
  templates/ preview/ jobs/  Studio-facing JSON APIs (session)
  api/                     Dashboard JSON routes (queue poll, job actions,
                           slips, devices, invites, tape takes)
components/                React components (shadcn kit in ui/, tape/ island)
plugins/
  index.js                 Explicit list of installed plugin modules
  espn-worldcup.js         World Cup plugin (kickoff/goal/full-time)
  morning-brief.js         Daily brief at a scheduled time (calendar + weather)
  message-ingest.js        Passive plugin: forwarded messages -> task receipts
lib/
  db.js                    Postgres client (Neon, or embedded PGlite locally)
  auth-server.js           Better Auth instance (accounts, invites gate)
  auth-client.ts           Browser-side auth client
  devices.js               Printer pairing + per-device token verification
  store.js                 Templates (Postgres, seeded per owner)
  job-store.js             Job records (Postgres) + queue (Redis or local)
  tape-store.js            Tape takes (Postgres meta; Blob or local payloads)
  plugin-registry.js       Plugin registry facade (+ Postgres config truth)
  state-store.js           Small runtime state facade (json/redis driver)
  schedule.js              Plugin schedule math (every/at, timezone-aware)
  plugin-setup.js          Plugin registration, migration, template seeding
  change-signal.js         Blob-backed queue + tick flags (idle polls skip Redis)
  device-presence.js       Throttled "printer online" bookkeeping
  task-classifier.js       Gemini call: does this message contain a task?
  redis.js                 Upstash Redis client + owner-namespaced keys
  blob.js                  Vercel Blob helpers
  stores/
    plugins-json.js        Plugin registry: data/plugins.json
    plugins-redis.js       Plugin registry: Upstash Redis (+ sorted due-index)
    state-json.js          State: data/ files
    state-redis.js         State: Upstash Redis
agent/
  printer-agent.js         Local printer agent (polls /next, prints, acks)
  heartbeat.js             Local heartbeat (POSTs /tick, drives plugins)
public/
  dither-worker.js         Web Worker: live dither for the Photo viewfinder
  pcm-worklet.js pitch-worker.js  Tape tool audio capture + pitch detection
transport/
  print-net.js             TCP sender (printToNetwork)
firmware/
  docket-agent/            ESP32 sketch: pairing, polls /next, POSTs /tick
android-forwarder/         Android app: SMS/RCS -> POST /ingest
scripts/
  create-user.js           Bootstrap an account (hidden password prompt)
  print-calibration.js     Grayscale wedges through the real pipeline
  show-plugin.js toggle-plugin.js  Terminal plugin helpers
  tape-eval/               Tape transcription scorer (fixtures are the
                           maintainer's recordings, gitignored; the harness
                           and truth-file format are public, so bring your
                           own clips to work on detection)
  test-tape-doc.mjs        Tape document logic tests (npm run tape:doc)
docs/
  design-spec.md           Dashboard visual source of truth
  template-authoring.md    Constraint sheet for writing templates
  rp850-field-notes.md     Measured RP850 printer behavior
  receipt-printer-build-guide.md   Hardware build guide
  store-costs.md           Per-path store costs + quota-math rules
  tape-transcription-v2.md Tape detection pipeline design
  *.png                    Documentation images
reference/
  starter-templates.json   Starter templates (seeds the local store)
  wc-templates.json        World Cup templates (kickoff, goal, full-time)
  receipt-design-studio.html  Archived offline previewer (html2canvas-based)
  espn-poller.js           Retired standalone poller (superseded by plugins/espn-worldcup.js + /tick)
  server.py                Python job-queue server (reference, superseded by the Next.js app)
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

## License

MIT. See [LICENSE](LICENSE). Contributions are welcome, see
[CONTRIBUTING.md](CONTRIBUTING.md).
