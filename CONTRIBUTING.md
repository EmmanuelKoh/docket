# Contributing

Bug reports, ideas, code and docs are all welcome.

## Report a bug

Report a security bug privately, as [SECURITY.md](SECURITY.md) describes.
Do not open an issue for it.

For any other bug, open an issue with:

- what you tried;
- what you expected;
- what happened;
- the steps to make it happen again;
- your environment: OS, Node version, and the printer model if it matters.

## Suggest a feature

Open an issue that describes the feature and how it would help. Add ideas
for how to build it, if you have them.

## Submit code

1. Fork the repository.
2. Create a branch.
3. Make your change.
4. Add tests where the change has logic.
5. Run `npm run check`.
6. Make sure that the check passes.
7. Open a pull request that says what you changed and how you tested it.

CI runs `npm run check` on every push and pull request
(`.github/workflows/check.yml`).

## Development setup

You need Node 22.12 or later, because vite (the tool that bundles the
tests) needs it. `.nvmrc` pins 22, so `nvm use` picks the newest Node 22
that you have.

Local development needs no cloud account, no Redis, no Vercel and no
printer. With `DATABASE_URL` unset or empty, the database is PGlite, a
Postgres database that runs inside DOCKET. It keeps its files in `data/pg`
and sets itself up on first use. The default `STORE_DRIVER=json` keeps
everything else in files under `data/`.

Warning: the dev server and every script that imports `config.js` read
`.env`. If your `.env` holds a Neon URL, those commands use that database,
production included. For local work, leave `DATABASE_URL` empty, or put
`DATABASE_URL=` before the command. An empty value on the command line
wins over `.env`.

1. Clone the repository:

   ```bash
   git clone https://github.com/EmmanuelKoh/docket.git
   ```

2. Go into its folder: `cd docket`
3. Install the dependencies: `npm install`
4. Copy the example settings file: `cp .env.example .env`
5. If the dev server runs, stop it. PGlite lets only one process use the
   database at a time.
6. Create your account. Signup is by invite, so the first account comes
   from a script.

   ```bash
   DATABASE_URL= node scripts/create-user.js "Your Name" you@example.com
   ```

   The script asks for a password and shows the new account id.
7. In `.env`, set `OWNER_ID` to that account id.
8. Start the dev server:

   ```bash
   DATABASE_URL= npm run dev
   ```

9. Open http://localhost:3000.
10. Sign in with your email and password.

The repository used to be named `receipt-printer`. An older clone can still
point at that URL, and GitHub redirects it.

### Work without the board

The ESP32 board is optional. Two laptop agents (scripts in `agent/`) stand
in for it:

```bash
node agent/printer-agent.js   # asks /next for jobs and sends them to PRINTER_IP over TCP
node agent/heartbeat.js       # calls /tick, which runs the due plugins
```

The agents send `DEVICE_TOKEN` (`dev-token` locally), which acts for the
account in `OWNER_ID`. The printer agent reads `PRINTER_IP` from `.env`:

| `PRINTER_IP` | The printer agent |
|---|---|
| Unset | Exits |
| The address of an ESC/POS printer on your network | Sends each job to the printer over TCP, on port 9100 or `PRINTER_PORT` |
| `file:data/prints` | Writes each job to `data/prints/<job id>.bin` and reports it as printed (acks it), so the job goes from queued to done |

A serial printer, like the RP850 in this build, needs the ESP32 board.

## Checks

`npm run check` runs:

- Biome (lint and the import rules);
- the typecheck;
- the Vitest suite (`npm test`);
- the take-document checks (`npm run tape:doc`).

The tests run against in-memory PGlite and fake Redis and Blob clients.
`vitest.config.ts` blanks every cloud connection setting, so the tests
never touch your `data/` or a cloud service.

Three tests freeze contracts, the behavior that other parts depend on:

| Test | Freezes |
|---|---|
| `tests/device-wire.test.ts` | What the firmware sees on `/pair`, `/next`, `/ack`, `/nack` and `/tick` |
| `tests/meter-budget.test.ts` | The metered store calls of the printer's idle requests |
| `tests/golden-escpos.test.ts` | The exact printed bytes of a set of templates (`tests/golden/escpos.json`) |

A change that needs new expectations in one of them needs the
maintainer's approval in the pull request. To rewrite the golden file
after an intended rendering change, run
`UPDATE_GOLDEN=1 npx vitest run tests/golden-escpos.test.ts`, and include
the diff.

A new test file sets its own `DATA_DIR` subfolder in `vi.hoisted` and
stubs `fetch`, like the existing ones.

## Where code goes

Routes, pages and scripts call operations. An operation is one named
action in `lib/ops/`, with a permission and an input schema. Operations
call the stores in `lib/`. Biome enforces this: code in `app/` and
`components/` cannot import `lib/` (except `lib/ops/` and the auth
client), `db/`, `render/` or `plugins/`. `docs/architecture.md` describes
the layers and contracts behind the steps below.

### Add an operation

1. Put it in the matching `lib/ops/<area>.js`:

   ```js
   import { z } from 'zod';
   import { defineOperation, OpError } from './define.js';

   export const thingsRename = defineOperation({
     name: 'things.rename',
     description: 'Rename a thing. One sentence a tool could show.',
     permission: 'owner',              // 'public', 'owner' or 'admin'
     effects: ['db.write'],            // what it touches (READS and WRITES in define.js)
     input: z.object({ id: z.string(), name: z.string() }),
     async run(caller, { id, name }) {
       // every store call takes caller.ownerId
       return { renamed: true };
     },
   });
   ```

   An operation with no write effect is read-only. Outputs are JSON
   values: ISO strings for times, `Binary` (`lib/ops/schema.js`) for bytes.
2. For an expected failure, throw `new OpError(code, message)`. The route
   helpers map each code to an HTTP status:

   | Code | Status |
   |---|---|
   | `invalid` | 400 |
   | `unauthenticated` | 401 |
   | `forbidden` | 403 |
   | `not_found` | 404 |
   | `conflict` | 409 |
   | `too_large` | 413 |
   | `busy` | 429, with a `Retry-After` header |
   | `unavailable` | 502 |

3. Add a new `lib/ops/` module to `lib/ops/index.js`. A new operation in
   an existing module needs no registration.
4. Add a test in `tests/ops/` when the operation has logic.

### Add a route

A route is a thin adapter. It builds the caller, reads the request, and
calls one operation:

```ts
import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { thingsRename } from '@/lib/ops/things.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const body = (await req.json().catch(() => null)) || {};
  return json(() => thingsRename(caller, body));
}
```

The printer's endpoints are different. They use `app/_lib/device-auth.ts`
and the plain functions in `lib/ops/device-service.js`, and they answer
401 only for a bad token.

### Add a page

1. Create `app/(dashboard)/<name>/page.tsx`.
2. In it, get the caller with `getCaller()` from `app/_lib/caller.ts`.
3. When the caller is null, redirect to `/login`.
4. Call operations for the data.
5. Put the interactive parts in a `'use client'` component that calls an
   `app/api/` route.
6. Add a key for the page to the key bank in `components/app-sidebar.tsx`.
7. Describe the page in `docs/design-spec.md`, which must match what is
   built.

A page that polls (asks the server again on a timer) follows
`components/hooks/use-eased-poll.ts`. Work out its cost with the quota
math in `docs/store-costs.md` first.

### Add a plugin

1. Write a module in `plugins/` that exports `id`, `meta`, `defaults`,
   `templates`, `configLabels`, and `run` (with a `defaults.schedule`),
   `onMessage`, or both. `docs/plugins.md` shows the shape.
2. Add it to `PLUGINS` in `plugins/index.js`.
3. Put its templates in a `reference/*-templates.json` file.
4. If you made a new templates file, add it to `SEED_TEMPLATE_FILES` in
   `lib/plugin-setup.js`.
5. Reach the world outside DOCKET only through `ctx`. Biome forbids
   imports from `lib/`, `db/`, Next.js and React in `plugins/`.
6. Load heavy dependencies inside the code path that uses them, so that
   `/ingest` and the Slips pages stay light.

Registration runs when an account views the Slips page, once per account
per server process. So after a deploy, each account gets a new plugin on
its next Slips visit. Work out what the schedule costs before you pick a
default (`docs/store-costs.md`). Give a plugin that polls an outside
service the default `enabled: false`.

## Guidelines

- Only `lib/` reads or writes Postgres, Redis, Blob or local files. New
  often-read state, the kind that lives in Redis when hosted, needs both
  drivers: `json` and `redis`.
- Do not query Postgres from the printer's regular requests (`/next`, an
  idle `/tick`).
- Read `docs/store-costs.md` before you add anything that polls or runs
  on a timer.
- For a schema change, edit `db/schema.js`, run `npm run db:generate`, and
  commit the migration. Keep migrations additive.
- When you change the dashboard, update `docs/design-spec.md`.
- Add each new environment variable to `.env.example` (a test checks it)
  and to the tables in `docs/configuration.md`.
- A file from another project (a font, a model, a binary, copied code)
  keeps its license. List it in `THIRD_PARTY_NOTICES.md` with its
  copyright lines. Add the license text there, or in a `LICENSE` file
  beside it. A test checks this for fonts, models and binaries.
- Never commit secrets or personal data. Git ignores `data/`, every `.env`
  file except `.env.example`, `.vercel/` and
  `firmware/docket-agent/secrets.h`. Use placeholder domains and numbers
  in docs.

## Questions

Open an issue.
