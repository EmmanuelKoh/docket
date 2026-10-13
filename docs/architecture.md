# Architecture

How the code is put together and where a change goes. `CONTRIBUTING.md`
has the step-by-step recipes. This document covers the contracts behind
them.

## Layers

DOCKET is one Next.js app. Its code sits in layers, and calls go down
the stack, never up.

```
adapters     app/ routes and pages, scripts/
               build a Caller, read the request, call one operation
                  |
operations   lib/ops/
               (caller, input) -> output, with a permission, an input
               schema and declared effects
                  |
stores       lib/*.js: job-store, store (templates), tape-store, devices,
             plugin-registry, plugin-setup, kv, state-store
                  |
drivers      Postgres (lib/db.js), the queue (lib/queue/), artifacts
             (lib/artifacts/), Redis (lib/redis.js), Blob flags
             (lib/change-signal.js), the LLM (lib/llm/)
```

Two parts sit beside the stack:

- `render/render-core.js` turns a template and data into printer bytes.
  The job store and the template ops import it lazily, inside the code
  that renders, so the device routes never load it
  (`tests/lazy-render.test.ts`).
- `plugins/` holds modules that print on their own. They reach the
  stores only through `ctx` (see "Plugins").

Biome enforces the boundaries (`biome.json`, `noRestrictedImports`):

- `app/` and `components/` import `lib/ops/` and `lib/auth-client`, never
  other `lib/` files, `db/`, `render/`, `plugins/` or a driver package.
  Only `app/_lib/dashboard-session.ts`, the auth route and the logout
  route import `lib/auth-server.js`. `require()` is an error there
  (`noCommonJs`), because the import rule does not see it.
- `lib/`, `render/` and `plugins/` never import Next.js or React.
- `plugins/` never import `lib/` or `db/`.

Biome overrides replace rule options instead of merging them, so the
`app/` rule is written twice. `tests/boundary-lock.test.ts` checks that
the two copies match and runs Biome on probe files to prove the rule
catches what it should.

One vendor package reaches the UI tree: the Tape tool's browser code
(`components/tape/persist.js`) and its upload route
(`app/api/tape/takes/upload/route.ts`) use `@vercel/blob/client` for
Vercel's client-upload protocol. The `tape.authorizeUpload` op decides
who may upload where.

## The caller

Every operation takes a `Caller` (`lib/ops/caller.js`) as a plain value:

```js
{ ownerId, actor: { kind, id, owners? }, role, grants }
```

`ownerId` scopes every store call. Owner-scoped store functions take it
as their first argument.

| Actor kind | Built by | `ownerId` | Can call |
|---|---|---|---|
| `user` | `userCaller`, from the session (`app/_lib/caller.ts`) | the user id | owner ops, and admin ops when `role` is `admin` |
| `device` | `deviceCaller`, from a Bearer token (`callerForDeviceToken` in `lib/ops/identity.js`) | the device's primary owner; `actor.owners` lists every owner it serves | no operation (`grants: []`); only the device service |
| `token` | `tokenCaller`, from a module credential (`callerForCredential`) | the owner whose plugin config holds the credential | only the op names in `grants` |
| `system` | `systemCaller`, in scripts | `OWNER_ID`, or null | owner ops when it has an `ownerId`; admin ops only when built with `{ admin: true }` (`scripts/create-user.js`) |

`grants: null` means the actor's full rights. A list means only those op
names, and `'read'` in the list means every read-only op. `/ingest` builds
a token caller with `['messages.deliver']`.

Pages get the caller from `getCaller()`, which React's `cache()` shares
between the layout and the page, so a request resolves the session once.
Route handlers use `requestCaller(req)`. Both go through
`app/_lib/dashboard-session.ts`, the only file that asks Better Auth for
the session.

## Operations

An operation is declared once with `defineOperation` (`lib/ops/define.js`):

- `name` (`area.verb`, e.g. `jobs.reprint`) and a one-sentence
  `description`.
- `input`: a Zod schema.
- `output`: an optional Zod schema.
- `permission`: `public`, `owner` or `admin`, or a list of them.
  `public` lets anyone in. `owner` needs a caller with an `ownerId` that
  is not a device. `admin` needs `role: 'admin'`.
- `effects`: what it touches, in meter terms. Reads are `db.read`,
  `kv.read`, `queue.read`, `artifact.get`, `signal.read` and `render`.
  Writes are `db.write`, `kv.write`, `queue.enqueue`, `queue.claim`,
  `queue.release`, `artifact.put`, `artifact.delete`, `signal.write`,
  `llm` and `net`. An op with no write effect is read-only. Ops that can
  create a job spread `JOB_CREATE`.
- `destructive`: set on ops that remove or revoke something, such as
  `templates.delete` and `printers.revoke`.

Calling `op(caller, input)` runs these steps in order:

1. The permission and grant check. When it fails, a missing caller gets
   `unauthenticated` and any other caller `forbidden`.
2. The input is parsed. A failure gives `invalid` with the first issue.
3. `run(caller, parsedInput)`.
4. Outside production, the result must be a JSON value (ISO strings for
   time, `Binary` from `lib/ops/schema.js` for bytes) and must match
   `output`. The check never reshapes the result.

Failures the caller should see are `OpError(code, message)`. The
dashboard adapter (`app/_lib/http.ts`) maps them to HTTP:

| Code | Status |
|---|---|
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `invalid` | 400 |
| `not_found` | 404 |
| `conflict` | 409 |
| `too_large` | 413 |
| `unavailable` | 502 |

Any other error is a 500. An op that returns nothing answers `null`.

The op modules are `accounts`, `jobs`, `messages`, `printers`, `slips`,
`tape` and `templates` in `lib/ops/`. `lib/ops/index.js` collects every op
into `OPERATIONS`. `tests/ops/registry.test.ts` renders each op's input as
JSON Schema (`toJsonSchema` in `lib/ops/schema.js`), so a tool adapter
can describe the ops later. Routes and pages import the op module they
use, not the index.

`app/` is TypeScript and `lib/` is JavaScript. With `allowJs`, the
typecheck infers each op's input and output types from the Zod schemas,
so a route that passes the wrong input type fails `npm run check`.

### Adapters

A dashboard route is a thin adapter:

```ts
export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const id = new URL(req.url).searchParams.get('job') ?? '';
  return json(() => jobsReprint(caller, { id }));
}
```

A route passes a null caller on, and the op refuses it with 401 unless
the op is public. Routes that read a large body (the Tape routes) check
the caller first and answer
`signInRequired()` before reading it. Pages call ops directly or through
the view models in `app/_lib/` (`queue-data.ts`, `slip-data.ts`), which
shape op results for display. Scripts call ops with `systemCaller`
(`scripts/show-plugin.js`).

## The device service and the device wire

The device routes (`app/{pair,next,ack,nack,tick}/route.ts`) call plain
functions in `lib/ops/device-service.js`: `pair`, `serveNext`, `ack`,
`nack` and `runDue`. They are not operations. `defineOperation` would
load Zod on the cold start of `/next`, and no tool lists them. The routes
only shape the responses.

The firmware (`firmware/docket-agent/docket-agent.ino`) polls `GET /next`
every 5 seconds and POSTs `/tick` every 30 seconds. The only other timers
are dashboard pages polling while they are open: the Queue list and the
Studio's recent-jobs strip (`components/hooks/use-eased-poll.ts`), and the
Printer page while a pairing is pending.

What the firmware reads, frozen by `tests/device-wire.test.ts`:

- `GET /next`: 204 when there is nothing to print. 200 with the bytes, an
  explicit `Content-Length` (the firmware reads `http.getSize()`; a
  chunked response makes it nack every job) and `X-Job-Id`. The firmware
  collects only that one header and echoes it into `/ack` and `/nack`.
- `POST /ack?job=<X-Job-Id>`: only a 200 ends the firmware's ack retry,
  which blocks new jobs.
- `POST /nack?job=<X-Job-Id>`: the firmware ignores the answer; the job
  must come back.
- For a job whose owner no longer uses this printer, both answer 200
  `{ gone: true }` and change nothing. `tests/device-service.test.ts`
  covers this answer, not the device-wire test.
- `POST /tick`: the firmware reads only the status. `agent/heartbeat.js`
  reads `results[].{id, status, error}`.
- `POST /pair`: no auth. The firmware pulls `code` and `token` out of the
  200 body with a substring search. 204 while the code is unclaimed.
- 401 means a missing, unknown or revoked token, and nothing else. Ten
  401s in a row make the firmware erase its token and pair again. A store
  failure answers 5xx (`deviceErrorResponse` in `app/_lib/device-auth.ts`
  maps `invalid` to 400, `forbidden` to 403 and anything else to 500).

`X-Job-Id` is `owner~job-N`. A device can serve several owners (shared
printers), and their job ids can collide, so the id carries the owner.
`parseJobRef` accepts a bare `job-N` for the primary owner.

The device caller's `actor.owners` is `[primary, ...members]`. `serveNext`
walks them in that order and hands out the oldest job of the first owner
with work. `runDue` runs each owner's due plugins. Presence (the
dashboard's "online") is one heartbeat per device, written to the primary
owner's slot at most once a minute per warm instance
(`lib/device-presence.js`).

### The cost rule

An idle `/next` or `/tick` reads one Blob flag per owner and touches
neither Redis nor Postgres. Once a safety window passes (60 seconds for
`/next`, 300 seconds for `/tick`, per owner per warm instance), the call
does the real claim anyway, so a stale or lost flag delays work by at most
one window. `tests/meter-budget.test.ts` counts every metered call on
these paths. `docs/store-costs.md` has the money behind the rule.

## Jobs

### The job record

One row per job in the Postgres `job` table (`db/schema.js`), keyed by
`(owner_id, id)`. The fields that carry meaning:

- `kind`: `template` (re-renderable from `template` and `data`) or `raw`
  (bytes the caller rendered, such as a Tape take). `jobs.reprint` refuses
  a raw job.
- `encoding`: the framing of the bytes,
  `{ mode: 'raster' | 'chunked', rotate: 0 | 180, flushCut, encoder }`,
  or null on rows from before it existed. `render-core` reports it for
  template jobs, and the Tape print route passes the Tape renderer's. It
  describes the bytes and never changes them. `encoder` names the framing
  (`render-core/1`, `tape-renderer/1`) and changes only when the framing
  does.
- `status`: `queued`, `inflight`, `done` or `canceled`. Lists and the trim
  also accept `failed`, but nothing sets it on its own: the firmware nacks
  on paper-out too, which a refill fixes.
- `template` and `data`: the inputs. Hosted, `data` over 32KB of JSON
  moves to an artifact.
- Artifact refs: `png_key`, `bytes_key`, `data_key`, plus the older
  `*_url` columns. Locally, `png` and `bytes` sit inline in the row.

### Producers

There are two ways into the queue, both in `lib/job-store.js`:

- `createJob(owner, { template, data, name, source })` renders now, then
  stores. `jobs.create`, `jobs.reprint`, `slips.printTest` and the
  plugins (through `ctx.createJob`, on a tick or in `messages.deliver`)
  use it.
- `createRawJob(owner, { bytes, png, width, height, name, source, encoding })`
  stores bytes the caller rendered. `jobs.createRaw` uses it.

Both store the artifacts, insert the row and enqueue the id. `/next` sends
stored bytes and never renders. Past `JOB_CAP` records per owner, the
oldest done and failed jobs are trimmed with their artifacts.

```
jobs.create, jobs.reprint,      createJob: render     storeJob: artifacts put,
slips.printTest, ctx.createJob ------------------+--> row insert, enqueue
jobs.createRaw --------------> createRawJob -----/          |
                                                            v
GET /next  -> serveNext -> queue.claim -> row inflight -> stored bytes
POST /ack  -> ackJob    -> queue.done  -> row done
POST /nack -> nackJob   -> count the attempt, requeue front or back -> row queued
```

### The queue seam

`lib/queue/index.js` defines the `JobQueue` interface: `mintId`,
`enqueue`, `hint`, `claim`, `done`, `requeue`, `withdraw`, `drop`,
`countAttempt`, `attempts`, `forget`, `size` and `order`. The job store
composes it with the record. `STORE_DRIVER` picks the driver:

- `redis` (hosted, `lib/queue/redis.js`): a list of waiting ids and a
  sorted set of leases per owner. A claim is one Lua script that first
  puts expired leases back at the front. A lease lasts `LEASE_SECONDS`
  (120). This driver owns the Blob queue flag: enqueue and requeue set it,
  an empty claim clears it, `hint` reads it. No feature code can forget
  it.
- `postgres` (local, `lib/queue/postgres.js`): the job rows are the queue.
  `inflight` has no expiry. `hint` always answers "unknown".

A nack counts a failed attempt. The first two put the job back at the
front, and from the third (`STUCK_AFTER_NACKS`) it goes to the back so the
jobs behind it print.

### The artifact seam

`lib/artifacts/index.js` defines the `ArtifactStore` interface: `put`,
`get`, `del`, `url`, `keyFromUrl` and an `inline` flag.

- `blob` (hosted, `lib/artifacts/blob.js`): Vercel Blob. Objects are
  public behind a random suffix, and the pathname is the key.
- `local` (`lib/artifacts/local.js`): files under `DATA_DIR`. Job PNGs and
  bytes skip it and ride inline in the row (`inline: true`).

Keys: `jobs/{owner}/{id}.png`, `.bin`, `.data.json`, and
`tape/{owner}/{id}.json`, `.wav`. Records store the key `put` returns.
New rows also still write the `*_url` columns. Readers try the key, then
the URL (`readFirst`), so rows from before keys keep working.

## Plugins

A plugin is a module listed in `PLUGINS` in `plugins/index.js`. It
exports:

- `id`, `meta` (card copy), `templates` (names it prints with) and,
  optionally, `configLabels`.
- `defaults`: `{ enabled, schedule?, config }`. `schedule` is
  `{ every: seconds }` or `{ at: 'HH:MM', timezone }` (`lib/schedule.js`).
  `enabled` applies only when a record is first created.
- At least one trigger:
  - `run({ config, state, ctx })` returns `{ state }`. A module with `run`
    and a default schedule is scheduled (`isScheduled`): it enters the
    due-index and the tick runs it when due.
  - `onMessage(envelope, { config, state, ctx })` returns
    `{ state, reply }`. `messages.deliver` calls it (`takesMessages`).
- Optionally `hooks.credentials`: `[{ key, kind: 'token' }]`, config keys
  the runner mints at registration (16 random bytes, base64url). A
  credential is never re-minted or dropped. Its value reaches only a
  signed-in user: `slips.list` and `slips.get` leave it out for any other
  caller.

`ctx` (`lib/plugin-context.js`) is the whole surface a module gets:

- `createJob({ template, data, name, source })`
- `getTemplate(name)`: the owner's stored template, or null. It never
  seeds.
- `llm.generateObject({ schema, prompt })` (see "The LLM seam")
- `log(msg)`

Generic code never branches on a module id
(`tests/plugin-contract.test.ts`).

**Registration.** `slips.register` runs on Slips page views
(`ensureRegistered` in `lib/plugin-setup.js`), once per owner per server
process. It creates missing records, mints credentials, mirrors them for
lookup, and seeds the plugin templates the owner lacks from
`reference/*-templates.json`. The tick never registers or seeds, so a new
account's plugins start on its first Slips visit.

**Records.** A plugin's config truth (enabled, schedule, config) lives in
the Postgres `plugin_config` table. Its runtime record (state, last run,
`nextDueAt`, the due-index) lives in Redis, or `plugins.json` in
`DATA_DIR` locally. Registration restores a lost runtime record's settings
from Postgres; only the runtime state is gone.

**Ticks.** `runDue` claims the due plugins in one atomic step with a
90-second lease, so two ticks never run the same plugin. A run that
throws records `lastError` and is due again when the lease ends. After a
run, the next due time counts from now: a printer that was off runs the
plugin once, late, with no backlog.

### The inbound envelope

`messages.deliver` takes `{ moduleId, envelope }`, with
`envelope = { text, sender?, source?, receivedAt? }`. `/ingest` calls it
for `message-ingest` with the caller its `ingestToken` resolves to.

- Blank text answers `{ skipped: 'empty' }`. A disabled plugin answers
  `{ skipped: 'disabled' }`.
- Before the handler runs, the delivery claims
  `sha256(owner|source|sender|text)` in kv. A copy that finds the claim
  pending gets `conflict` (409). One that finds it done gets
  `{ duplicate: true }`. Pending lasts 90 seconds (just past the route's
  60-second limit), done lasts 15 minutes.
- A failed delivery releases the claim, records `lastError` on the
  plugin, and answers `unavailable` (502), so the sender retries.

The ingest token resolves through a kv mirror
(`rp:_credentials:{moduleId}:{key}:{sha256}`), with a Postgres lookup on
a miss. A token Postgres did not know is refused from memory for the next
minute, per warm instance.

## The LLM seam

`generateObject({ schema, prompt, model?, temperature })` in
`lib/llm/index.js` takes a Zod schema and returns the parsed reply.
Temperature defaults to 0. It turns the schema into JSON Schema, hands it
to the provider, and parses the reply against the schema. A reply that
does not match throws.

The provider is `lib/llm/gemini.js`: `generateJson({ jsonSchema, prompt,
model, temperature })` over Gemini's REST API, with no SDK. It translates
JSON Schema into Gemini's dialect and aborts after 45 seconds, so a hung
call fails inside the `/ingest` function limit. The supported schema
subset is object, array, string, number, integer, boolean, enum,
optional and description.

Plugins reach it only as `ctx.llm.generateObject`.

## Where state lives

| Concern | Module | Hosted (`STORE_DRIVER=redis`) | Local (`json`) |
|---|---|---|---|
| Records: accounts, devices, templates, jobs, takes, plugin config | `lib/db.js` (by `DATABASE_URL`) | Neon | PGlite in `PGLITE_DIR` |
| Print queue, lease, attempt counts | `lib/queue/` | Redis | job rows, plus the state store |
| Artifacts | `lib/artifacts/` | Vercel Blob | files in `DATA_DIR`, job bytes inline |
| Plugin runtime records and due-index | `lib/plugin-registry.js` | Redis | `plugins.json` in `DATA_DIR` |
| Claims and mirrors (duplicate messages, credentials) | `lib/kv.js` | Redis | `kv.json` in `DATA_DIR` |
| Small state (presence, the local queue's attempts) | `lib/state-store.js` | Redis | files in `DATA_DIR` |
| Device-token mirror | `lib/devices.js` | Redis | none (PGlite directly) |
| Sign-in rate limit | `lib/auth-server.js` | Redis | not configured |
| Queue and tick flags | `lib/change-signal.js` | Vercel Blob | none |

Redis keys are `rp:{owner}:...`. Values no single account owns use a
scope that starts with `_` (`rp:_devices:...`, `rp:_credentials:...`).

## Narrow waists

These contracts have many producers and consumers, and a test holds each
one. The device wire, the job record, the module contract and the
envelope change only by adding (a new optional field, a new kind, a new
export), so old readers keep working.

| Contract | Held by |
|---|---|
| The device wire | `tests/device-wire.test.ts` |
| The device cadence's metered calls | `tests/meter-budget.test.ts` |
| Printed bytes | `tests/golden-escpos.test.ts`, `tests/golden/escpos.json` |
| The job record and its two producers | `tests/job-kind.test.ts` |
| The module contract and `ctx` | `tests/plugin-contract.test.ts` |
| The caller and operation declarations | `tests/ops/define.test.ts`, `tests/ops/registry.test.ts` |
| The inbound envelope | `tests/routes/ingest.test.ts`, `tests/ingest-hosted.test.ts` |
| Import boundaries | `biome.json`, `tests/boundary-lock.test.ts` |

The first three are frozen: a change to their expectations needs the
maintainer's sign-off. Printers in the field cannot be reflashed
remotely, so the device wire takes only additions the current firmware
ignores (a new response header, a new JSON field). The golden file
changes only when printed output is meant to change. Regenerate it with
`UPDATE_GOLDEN=1 npx vitest run tests/golden-escpos.test.ts` and read the
diff. Besides the hashes, that test checks on every run that the bytes
parse as one of the two known framings, that the preview PNG shows
exactly the dots the bytes print, and that a second render is identical.

## How each change type lands

### Add

- An operation: a `defineOperation` in the matching `lib/ops/<area>.js`.
  A new module also goes into `lib/ops/index.js`. Then a route or page
  calls it.
- A route or page: a thin adapter over ops (see "Adapters"). A page goes
  into the sidebar (`components/app-sidebar.tsx`) and
  `docs/design-spec.md`. Deploy wiring lives in `next.config.mjs`: a route
  that renders (it loads `render/fonts/`) or seeds templates (it reads
  `reference/`) needs an `outputFileTracingIncludes` entry, or Vercel
  deploys it without those files, and a new native or bundler-fragile
  server dependency goes into `serverExternalPackages`.
  `tests/route-config.test.ts` checks that every tracing key matches its
  route.
- A plugin: a module in `plugins/`, added to `PLUGINS`. Its templates go
  into a `reference/*-templates.json` file, and a new file goes into
  `SEED_TEMPLATE_FILES` in `lib/plugin-setup.js`. After a deploy, each
  account picks it up on its next Slips visit. Work out what its schedule
  costs first (`docs/store-costs.md`).
- A job producer: call `jobs.create` or `jobs.createRaw` (or
  `ctx.createJob` from a plugin). Every job ends in
  `jobStore.createJob` or `jobStore.createRawJob`.

### Connect

- A new adapter, such as a CLI or a tool server: build a `Caller` and
  call ops from `OPERATIONS`. Each op's `spec` carries its name,
  description, `readOnly`, `destructive` and effects, and `toJsonSchema`
  gives its input schema. No such adapter exists yet.
- A new message source: POST the envelope to `/ingest` with an owner's
  ingest token. A module with its own credential needs its own route,
  shaped like `app/ingest/route.ts`: `callerForCredential(moduleId, key,
  token, ['messages.deliver'])`, then `messagesDeliver`. Give the route
  `maxDuration = 60` and the `next.config.mjs` wiring a rendering route
  needs (`render/fonts/` and `reference/` in `outputFileTracingIncludes`,
  as `/ingest` has), since a delivery can seed templates and render a
  job.
- A new printer or device: pair through `/pair` with its own hardware id
  and speak the device wire. The firmware's `pairUntilTokened` is the
  pairing example. `agent/printer-agent.js` and `agent/heartbeat.js`
  speak the rest of the wire, but they authenticate with the local-dev
  `DEVICE_TOKEN` and do not pair.

### Change a contract

- An op's input or output: edit its Zod schema. The typecheck flags
  `app/` callers that no longer fit.
- The job record: an additive migration (below), with the new field
  optional so old rows keep working, as `kind` (default `template`) and
  `encoding` (null) were added.
- The module contract: a new optional export. Generic code must handle a
  module without it.
- The byte framing: bump `ENCODER` in `render/render-core.js` only when
  `parseEscpos` in the golden test has to learn the new framing.
  Template edits and dither tuning do not bump it.
- The device wire: additions only, as above. Anything else ships new
  firmware first and keeps the old behavior working.

Schema changes: edit `db/schema.js`, run `npm run db:generate`, and
commit the generated SQL. Migrations are additive: no drops, renames or
type changes, so rolling code back leaves only unused columns. Apply a
migration to Neon (`npm run db:migrate`) before deploying code that reads
the new columns. The stores select whole rows (`db.select().from(job)`),
which name every schema column, so code ahead of the database fails every
query on that table. PGlite applies migrations on first use.

### Replace a part

- A store driver: implement the interface (`JobQueue` in
  `lib/queue/index.js`, `ArtifactStore` in `lib/artifacts/index.js`, the
  kv, state and plugin drivers in `lib/stores/`) and select it in the
  index file. Today `STORE_DRIVER` picks every driver except Postgres,
  which follows `DATABASE_URL`.
- The LLM provider: a module with the same `generateJson` signature,
  imported by `lib/llm/index.js`.
- The renderer: it sits behind `createJob` and the template ops. The
  golden test shows every printed byte that moves.
- Authentication: `app/_lib/dashboard-session.ts` is the only file that
  resolves a session. Everything else sees a `Caller`.

### Move a part

- To another runtime: `lib/`, `render/` and `plugins/` import no Next.js
  or React, so code outside the app can call ops with a `Caller`, as
  `scripts/` and `tests/` do. Vendor code sits in `lib/db.js`,
  `lib/redis.js` and its users (the Redis drivers in `lib/queue/` and
  `lib/stores/`, the device-token mirror in `lib/devices.js`, the sign-in
  rate limit in `lib/auth-server.js`), `lib/artifacts/blob.js`,
  `lib/change-signal.js`, `lib/llm/gemini.js` and the Tape client
  upload.
- Data between stores: records point at artifacts by key, so copying
  objects under the same keys keeps them readable. Rows from before keys
  hold only a Blob URL. Redis holds state that exists nowhere else: the
  live queue and leases, attempt counts, plugin runtime state, and the job
  id counters (`rp:{owner}:jobs:seq`; a fresh counter would mint ids that
  collide with existing rows). The device-token and credential mirrors
  rebuild themselves from Postgres on a miss.

### Remove a part

- A plugin: drop it from `PLUGINS`. The tick drops its due entries
  (status `dropped`), and the Slips pages stop listing it. Its stored
  records stay.
- An operation: delete it and its callers. The registry test follows
  `OPERATIONS`.
- A column: stop reading and writing it, and leave it in the table
  (migrations stay additive).
- A file: check `next.config.mjs` file tracing and the imports first.
  `tests/repo-hygiene.test.ts` keeps `reference/` to the template sets
  seeding reads and `.env.example` in step with the variables the code
  reads.
