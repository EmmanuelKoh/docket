# Configuration

## Settings

DOCKET reads its settings from environment variables: named values that a
program reads when it starts. On your computer, they go in a file named
`.env`. On Vercel, they go in the project's Settings, under Environment
Variables.

To create `.env`, copy the example file:

```
cp .env.example .env
```

`.env.example` lists every variable the code reads. An unset variable uses
its default from `config.js`. The tables below list the main ones.

Warning: every script that imports `config.js` reads `.env`. If `.env`
holds a production `DATABASE_URL`, those scripts read and change
production data. [CONTRIBUTING.md](../CONTRIBUTING.md) ("Development
setup") shows how to keep local commands off it.

### Server

| Variable | Default | What it does |
|---|---|---|
| `STORE_DRIVER` | `json` | Where the print queue and other often-read data live: `json` (local files, and the queue in PGlite) or `redis` (Upstash Redis and Vercel Blob) |
| `DATABASE_URL` | Unset: PGlite | The Postgres database (Neon). Unset, DOCKET uses PGlite, a Postgres database that runs inside DOCKET |
| `DATA_DIR` | `data/` | Folder for local data: `json` driver files, local artifacts and PGlite |
| `PGLITE_DIR` | `DATA_DIR/pg` | Folder for PGlite's files |
| `BETTER_AUTH_SECRET` | None. A local run can generate one (see below the table) | Signs the account session cookies. Set it in production. Unset, DOCKET uses `SESSION_SECRET`, then Better Auth's own `AUTH_SECRET` or `BETTER_AUTH_SECRETS` |
| `BETTER_AUTH_URL` | Unset: taken from each request | The website's address in production |
| `JOB_CAP` | `50` | Job records kept per account. Past it, DOCKET deletes the oldest done and failed jobs |
| `LEASE_SECONDS` | `120` | `redis` driver only: seconds that a printer can hold a job without confirming it. Then the job goes back to the queue |
| `DEVICE_TOKEN` | `dev-token`. None on Vercel or in a production build | Lets the laptop agents fetch jobs and send ticks (`/tick`) as a printer |
| `OWNER_ID` | `default` | The account that `DEVICE_TOKEN` acts for. Set it to your local account id |
| `PRINT_WIDTH` | `576` | Dots per line: 576 for 80 mm paper, 384 for 58 mm |
| `FONT_DIR` | `render/fonts` | Folder with the DejaVu fonts |
| `GEMINI_API_KEY` | Unset | Google AI Studio key for the Message ingest slip. Without it, a message fails unless it starts with `task:` |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | The model the Message ingest slip uses when its own `gemini model` setting is blank |
| `WATCH_TEAMS` | Empty: all teams | Team abbreviations, separated by commas. They become the World Cup watcher's `watch teams` setting when an account first gets the slip |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | | `redis` driver: the Upstash Redis connection. The `KV_REST_API_*` names that the Vercel Marketplace sets also work |
| `BLOB_READ_WRITE_TOKEN` | | `redis` driver: the Vercel Blob connection. Vercel sets it |

DOCKET generates a session secret only when all of these are true:

- `BETTER_AUTH_SECRET`, `SESSION_SECRET`, `AUTH_SECRET` and
  `BETTER_AUTH_SECRETS` are all unset or empty.
- `VERCEL` is unset or empty. Vercel sets it on every deploy.
- `NODE_ENV` is not `production`. A production build sets it to
  `production`.

DOCKET keeps the generated secret in `DATA_DIR/auth-secret`, and uses it
again on every later start.

### Laptop agents and scripts

The laptop agents are two scripts in `agent/` that stand in for the
printer's board on your computer. Only they and the scripts read these
variables. The server ignores them.

| Variable | Default | What it does |
|---|---|---|
| `PRINT_SERVER` | `http://localhost:$PORT` for the agents (`PORT` defaults to 3000). `http://localhost:3000` for the calibration script | The server address for the agents and `scripts/print-calibration.js`. The calibration script's first argument overrides it |
| `HEARTBEAT_SECONDS` | `30` | Seconds between `/tick` calls from `agent/heartbeat.js` |
| `POLL_INTERVAL` | `3000` | Milliseconds between `/next` calls from `agent/printer-agent.js` |
| `PRINTER_IP` | None. Unset, the printer agent exits | A network printer's address. Or `file:<dir>`, to write each job to `<dir>/<job id>.bin` with no printer |
| `PRINTER_PORT` | `9100` | The network printer's port |
| `DOCKET_EMAIL` / `DOCKET_PASSWORD` | | The sign-in for `scripts/print-calibration.js` |

DOCKET includes its fonts (DejaVu) in `render/fonts/`. You do not need to
install fonts.

## Where data lives

DOCKET keeps data in three stores. Every record belongs to an account.
DOCKET finds the account from the sign-in session, or from the printer's
pairing token. Only the code in `lib/` and `db/` reads or writes Postgres,
Redis, Blob or local files.

### Postgres: the records

Postgres holds accounts, sessions, invites, printers, templates, job
records, Tape take details and slip settings. It is Neon when
`DATABASE_URL` is set. Without it, local development uses PGlite in
`data/pg`, and sets it up on first use. The schema is Drizzle
(`db/schema.js`), with migrations in `db/migrations/`.

### Redis: the often-read data

With `STORE_DRIVER=redis`, Upstash Redis holds only the data below. Each
key starts with `rp:{owner}:`.

- the print queue and its leases (`LEASE_SECONDS`);
- failed-attempt counts;
- when each slip is next due, and its run state;
- copies of the printer and ingest tokens;
- the claims that stop a forwarded message from printing twice.

### Vercel Blob: files

With `STORE_DRIVER=redis`, Vercel Blob holds:

- each job's preview image (PNG), printer bytes and large inputs, under
  `jobs/{owner}/`;
- Tape documents and WAV recordings, under `tape/{owner}/`;
- a small queue flag and tick flag per account. An idle printer's requests
  read only these flags.

### Local files

With `STORE_DRIVER=json` (the default):

- the queue is the job rows in PGlite;
- the Redis values live in `data/*.json`;
- job files stay inside the job row;
- Tape files go under `data/tape/`.

### Cost

The printer's regular requests never touch Postgres, so Neon can pause
when nothing else uses it. [store-costs.md](store-costs.md) has the cost
of each request, and the rules for adding anything that runs on a timer.
[architecture.md](architecture.md) ("Where state lives") names the module
for each kind of data.
