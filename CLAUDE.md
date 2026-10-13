# DOCKET

A thermal-receipt platform. A hosted Next.js server (Vercel) renders
Liquid + HTML templates into ESC/POS bytes. An ESP32 appliance polls for
jobs and prints them on a Rongta RP850 over serial. Plugins print on a
schedule (World Cup goals, a morning brief) or when a message arrives
(texts forwarded to `/ingest`). A multi-user dashboard (invite-only
accounts, each with its own templates, plugins, queue and history;
printers paired by a printed code) manages it all.
`docs/architecture.md` describes the contracts in full.

## Architecture in one line

`route/page/script -> operation (lib/ops/, with a Caller) -> store
(lib/)`. A job renders at creation (bytes stored, record in Postgres) ->
queue (Redis claim + 120s lease hosted, job rows locally) -> the ESP32
polls `/next` every 5s -> serial -> printer -> `/ack`. The ESP32 also
POSTs `/tick` every 30s, which runs its owners' due plugins. An idle
`/next` or `/tick` reads one Blob flag per owner (plus a real claim once
per safety window) and never Postgres. The only other timers are
dashboard pages polling while open: the Queue list and the Studio's
recent-jobs strip (`components/hooks/use-eased-poll.ts`: 3s while active,
30s after two idle minutes, stopped after thirty, never in a hidden tab),
and the Printer page every 3s while a pairing is pending.

## Code structure

- Operations: every product action is a `defineOperation` in
  `lib/ops/<area>.js` (name, description, Zod input, permission
  `public`/`owner`/`admin`, effects, optional `destructive`), called as
  `op(caller, input)`. Expected failures throw `OpError(code, message)`.
  Outputs are plain JSON. A new ops module also goes into
  `lib/ops/index.js`.
- Caller (`lib/ops/caller.js`): `{ ownerId, actor, role, grants }`;
  `ownerId` scopes every store call (owner-scoped store functions take it
  first). Built from the session (`app/_lib/caller.ts`), a device token or
  module credential (`lib/ops/identity.js`), or `systemCaller` in scripts.
- New code: logic goes in an op. A route is a thin adapter,
  `json(() => op(caller, input))` (`app/_lib/http.ts`). A page calls ops
  with `getCaller()`. A plugin reaches the world only through `ctx`.
  `CONTRIBUTING.md` has the recipes.
- Boundary lock (`biome.json`): `app/` and `components/` import only
  `lib/ops/` and `lib/auth-client`, never other `lib/` files, `db/`,
  `render/`, `plugins/` or driver SDKs, and never `require()`. Only
  `app/_lib/dashboard-session.ts`, the auth route and logout import
  `lib/auth-server.js`. `lib/`, `render/`, `plugins/` never import
  Next.js or React; `plugins/` never import `lib/` or `db/`. The `app/`
  rule is written twice; `tests/boundary-lock.test.ts` keeps them equal.
- Device endpoints (`app/{pair,next,ack,nack,tick}/route.ts`) call plain
  functions in `lib/ops/device-service.js`, not ops, so `/next` loads no
  Zod, plugins or renderer. They answer 401 only for a missing, unknown
  or revoked token: ten 401s in a row wipe the firmware's token. `/next`
  MUST send an explicit Content-Length: the ESP32 reads it via
  `http.getSize()` and nacks forever on a chunked response.

## Layout

- `app/`: Next.js App Router (TypeScript, Tailwind 4, the shadcn kit in
  `components/ui/`). Dashboard pages live in the `(dashboard)/` route group
  behind the session. `next.config.mjs` keeps the render/plugin deps in
  `serverExternalPackages` (Turbopack breaks node-ical and the resvg native
  module otherwise) and traces `reference/**` and `render/fonts/**` into the
  functions that read them.
- `render/render-core.js`: Liquid -> Satori -> resvg -> Floyd-Steinberg
  (serpentine + threshold jitter) -> ESC/POS. Dithered jobs (taller than
  160 rows with tone transitions > 0.2/px; text is ~0.01-0.12) are
  memorize-then-print chunks (`GS *`/`GS /`), rotated 180° with a flush
  cut so the printer's top leader becomes bottom margin. Text receipts
  are one raster, byte-stable. The framing is stored as the job's
  `encoding`. Loaded lazily, only by code that renders.
- `plugins/`: modules listed in `plugins/index.js`, with `run` on a
  schedule and/or `onMessage` for pushed messages (contract in
  `docs/architecture.md`). A schedule is `{ every: seconds }` or
  `{ at: 'HH:MM', timezone }` (`lib/schedule.js`); the tick runs only
  what is due. Generic code never branches on a module id. Registration
  and plugin template seeding run on Slips page views (`slips.register`),
  never on ticks, so a new owner's plugins activate on their first Slips
  visit.
- `components/photo-engine.js`: the Photo tool's imperative engine,
  carried VERBATIM from the pre-rewrite page because it is live-tested
  against the printer: the calibrated tone curve (keep-in-sync copy in
  `scripts/print-calibration.js`), the dither-worker viewfinder protocol
  (`public/dither-worker.js`), and the crop/levels pointer math. Its
  markup is `components/photo-tool.tsx` and its styles
  `app/(dashboard)/photo/photo-tool.css`; ids and class names are the
  contract between the three. Do not "modernize" the engine.
- The Tape tool (`/tape`, `components/tape/`): duduk transcription in the
  browser. While recording, the mic feeds `audio-io.js` (via
  `public/pcm-worklet.js`) and `analyzer.js` (`public/pitch-worker.js`),
  and only the raw pitch trace draws. On Stop or a loaded file, Basic
  Pitch (`decode.js`) transcribes and `doc.mjs` builds the take document
  with the passes `npm run tape:eval` scores (read
  `docs/tape-transcription-v2.md` before touching detection); `npm run
  tape:doc` checks `doc.mjs`. `components/tape-renderer.js` rows ARE the
  print bytes: the preview and `/api/tape/print` (a `raw` job, never
  reprinted) consume the same arrays; never add a second rendering path.
  Only the canvases are imperative (`tape-view.js`, driven by
  `controller.js`); controls are React over `store.ts`.
- Tape editing: click a note for the inspector strip; each edit
  re-renders the whole tape from the edited timeline. Detection freezes
  while edits exist; "Start over" re-derives, first snapshotting the
  edited tape into `doc.versions`. `song.mjs` splits a song at cuts into
  phrases, each its own doc (melody floor, edits, undo, freeze), shown
  stitched into one roll (a printed caesura at each cut) or one at a
  time, and each prints as its own receipt.
- Saved takes: `lib/tape-store.js` behind `/api/tape/takes*`. Meta in
  Postgres; the take document JSON and a lossless WAV are artifacts under
  `tape/{owner}/` (Blob hosted, `DATA_DIR` files locally). Hosted WAVs
  upload browser -> Blob with a client-upload token
  (`/api/tape/takes/upload`) because they exceed the ~4.5MB route cap.
- `firmware/docket-agent/`: the ESP32 sketch. Credentials in gitignored
  `secrets.h` (copy from `.example`). RP850 pins: DevKit TX=17/RX=16,
  115200 baud.
- `scripts/`: account, plugin and template tools, `print-calibration.js`
  (grayscale wedges through the real pipeline; signs in with
  `DOCKET_EMAIL`/`DOCKET_PASSWORD`), `tape-eval/` (`npm run tape:eval`
  scores every `data/clips/*.truth.json` fixture). `agent/` and
  `transport/` are laptop stand-ins for the ESP32.

## Storage

- Only `lib/` touches Postgres, Redis, Blob or data files (the Tape
  client upload aside). Postgres is the system of record: users,
  sessions, invites, devices, templates, job records, tape-take meta,
  plugin config truth. Neon when `DATABASE_URL` is set, else PGlite
  (embedded, in `PGLITE_DIR`), which applies migrations on first use.
  Drizzle schema in `db/schema.js`, generated SQL in `db/migrations/`.
- Redis (`STORE_DRIVER=redis`, Upstash) keeps the hot path: job queue,
  lease and attempt counts, plugin due-index and runtime records, the
  device-token and ingest-credential mirrors, duplicate-message claims.
  Keys `rp:{owner}:...`. Blob holds artifacts by key (`jobs/{owner}/...`,
  `tape/{owner}/...`) and the per-owner queue and tick flags.
  `STORE_DRIVER=json` keeps it all local: files in `DATA_DIR`, the queue
  (no lease expiry) and job artifacts in PGlite rows.
- HARD RULE: nothing on the device cadence (`/next`, idle `/tick`)
  touches Postgres, or Neon never scales to zero. Upstash bills per
  command, Neon per CU-hour, Vercel per request: read
  `docs/store-costs.md` before adding anything polled or timer-driven.
- Printers (`lib/devices.js`): an unpaired device POSTs `/pair` and
  prints a code; the owner enters it on the Printer page. To share, the
  owner mints a single-use share code (15 minutes) and another account
  types it into the same code box, joining as a member (`device_member`
  table; the token mirror carries the owner list; consent on both sides
  by design). `/next` and `/tick` serve the owners in stable order, each
  with their own queue, plugins and schedules. Job ids cross the wire as
  `owner~job-N` (opaque to firmware; a bare id means the primary owner).
  One presence heartbeat per device, on the primary owner's slot.

## Auth model

- Dashboard pages and JSON routes: Better Auth sessions (email + password,
  invite-only signup, admins mint invites on /users), checked from a
  signed cookie cache (5 minutes), so a page view reads no database. The
  seam is `app/_lib/dashboard-session.ts`; everything else gets a Caller.
- Device endpoints: per-device Bearer tokens from pairing ONLY, never the
  cookie; sha256 at rest, checked memory cache -> Redis mirror ->
  Postgres on a miss. A paired printer can be re-claimed only by its
  owner until revoked. Local dev only: `DEVICE_TOKEN` (`dev-token`, no
  default on Vercel or in a production build) acts for `OWNER_ID`.
- `/ingest`: the per-owner `ingestToken` shown on the message-ingest
  Slips page. `/pair` is deliberately unauthenticated; authority is the
  printed code + a signed-in claimer.
- middleware.ts only does an optimistic cookie-presence redirect for
  pages; real enforcement is the layout, each op's permission check, and
  owner-scoped stores. Never middleware alone.

## Checks and safety

- `npm run check` (Biome with the boundary lock, typecheck, Vitest,
  `tape:doc`) must pass before handing work back. CI runs it on push.
- Frozen contract tests change only for an intended change to that
  contract, with the maintainer's sign-off: `tests/device-wire.test.ts`
  (what the firmware sees; printers in the field cannot be reflashed
  remotely, so only additions the firmware ignores are safe),
  `tests/meter-budget.test.ts` (metered calls of the idle device
  cadence), `tests/golden-escpos.test.ts` + `tests/golden/escpos.json`
  (exact printed bytes). After an intended rendering change only:
  `UPDATE_GOLDEN=1 npx vitest run tests/golden-escpos.test.ts`, then read
  the diff.
- `.env` may point `DATABASE_URL` at production, and every command that
  imports `config.js` (`npm run dev`, `scripts/`) uses it. For local work
  prefix the command with `DATABASE_URL=` (an empty value wins over
  `.env`). Production commands are the maintainer's.
- `DATA_DIR` (default `data/`) holds every local file: json-driver
  stores, local artifacts, PGlite (`PGLITE_DIR`, default `DATA_DIR/pg`).
  PGlite is single-process: stop the dev server before a script opens it.
- Migrations: edit `db/schema.js`, `npm run db:generate`, commit the SQL.
  PGlite applies it on first use; Neon via `npm run db:migrate` (the
  maintainer runs it). Additive only (no drops, renames or type changes).
  Migrate Neon before deploying code that reads new columns: the stores
  select whole rows, so code ahead of the schema fails every query on that
  table.

## Design

`docs/template-authoring.md` is the constraint sheet for writing receipt
templates (Satori's CSS dialect, thermal-paper rules); give it to any
LLM asked to design one.

`docs/design-spec.md` is the visual source of truth (monochrome + register
red, both themes, strict red-usage rules). **Update it whenever the UI
changes**; it must describe what's built. Key rules that keep recurring:
buttons never repeat an already-clickable object's default action; rows
with thumbnails top-align; thumbnails sit on #fff in both themes; red only
where the spec's red-usage rules allow it.

## Hardware truths

`docs/rp850-field-notes.md` holds measured printer behavior (geometry,
status bytes, the mute-after-flash quirk, the 800-row GS* ceiling, dot
gain). `docs/receipt-printer-build-guide.md` is the generic staged
bring-up.

## Workflows

- Local dev: `DATABASE_URL= npm run dev`, plus `node agent/heartbeat.js`
  and `node agent/printer-agent.js` only if the ESP32 isn't covering
  those (they act for `OWNER_ID`; set it to your account id).
- Accounts: `DATABASE_URL= node scripts/create-user.js "Name" email`
  makes an admin (hidden password prompt; dev server stopped).
- Code edits hot-reload under `npm run dev`.
- Templates seed only if missing, per owner: starters at sign-up (the
  user-create hook in `lib/auth-server.js`, also run for
  `scripts/create-user.js`), plugin templates from
  `reference/*-templates.json` on Slips page views and before a message
  delivery. Editing a reference file leaves stored copies alone: save in
  the Studio, or run `scripts/sync-task-template.mjs` for Task.
- Firmware test loop: point `secrets.h` at the laptop
  (`http://<mac-ip>:3000`), flash, **power-cycle the printer after
  flashing** (see field notes), test, point back at production.
- Deploys: push to main -> Vercel. Production stores are Upstash Redis +
  Blob (`STORE_DRIVER=redis` + tokens in Vercel env). Preview deployments
  share production data (ownerId isolation is the escape hatch).

## Conventions for working here

- The maintainer iterates by eye on physical output: prefer cheap probes
  and calibration prints over theorizing.
- Discuss design options before building non-trivial features; present
  trade-offs and a recommendation.
- Explain in plain language and define jargon on first use.
- No git commands that mutate state; the maintainer commits and pushes
  manually. Provide one-line commit messages / PR descriptions on request.
- Keep `data/`, `jobs/`, `.env`, `secrets.h` out of git (already ignored).
  This repo is public; never write personal data, tokens, or real phone
  numbers into tracked files or docs.
