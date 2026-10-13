# Contributing

Contributions of all kinds are welcome: bug reports, ideas, code and docs.

## Report a bug

Open an issue with what you tried, what you expected, what happened, the
steps to reproduce, and your environment (OS, Node version, printer model
if it matters).

## Suggest a feature

Open an issue that describes the feature and why it would help. Include
implementation ideas if you have them.

## Submit code

1. Fork the repo and create a branch.
2. Make your change, with tests where the change has logic.
3. Run `npm run check`. It must pass.
4. Open a pull request that says what you changed and how you tested it.

CI runs `npm run check` on every push and pull request.

## Development setup

```bash
git clone https://github.com/EmmanuelKoh/docket.git
cd docket
npm install
cp .env.example .env
```

The repository used to be named `receipt-printer`. Older clones may still
point at that URL; GitHub redirects it.

Local dev needs no cloud account. With `DATABASE_URL` unset or empty,
Postgres is PGlite, an embedded database in `data/pg` that migrates itself
on first use. The default `STORE_DRIVER=json` keeps the rest in local
files under `data/`. You do not need Redis, Vercel or a printer.

`.env` is read by the dev server and by every script that imports
`config.js`. If your `.env` holds a Neon URL, those commands use that
database, production included. For local work, leave `DATABASE_URL`
empty, or prefix the command with `DATABASE_URL=` (an empty value wins over
`.env`).

Create an account. Signup is by invite, so the first account comes from a
script. PGlite allows one process at a time, so run it while the dev server
is stopped:

```bash
DATABASE_URL= node scripts/create-user.js "Your Name" you@example.com
```

It prompts for the password and prints the new account id. Then start the
server and sign in at http://localhost:3000:

```bash
DATABASE_URL= npm run dev
```

The ESP32 is optional. Two laptop helpers stand in for it:

```bash
node agent/printer-agent.js   # polls /next and sends jobs to PRINTER_IP over TCP
node agent/heartbeat.js       # POSTs /tick, which runs due plugins
```

They send `DEVICE_TOKEN` (`dev-token` locally), which acts for the account
named by `OWNER_ID`. Set `OWNER_ID` in `.env` to the account id
`create-user.js` printed.

## Checks

`npm run check` runs Biome (lint and the import rules), the typecheck, the
Vitest suite (`npm test`) and the take-document checks (`npm run
tape:doc`). Tests run against in-memory PGlite and fake Redis and Blob
clients, and `vitest.config.ts` blanks every cloud connection setting, so
they never touch your `data/` or a cloud service.

Three tests freeze contracts:

- `tests/device-wire.test.ts`: what the firmware sees on `/pair`, `/next`,
  `/ack`, `/nack` and `/tick`.
- `tests/meter-budget.test.ts`: the metered store calls of the device's
  idle cadence.
- `tests/golden-escpos.test.ts`: the exact printed bytes of a set of
  templates (`tests/golden/escpos.json`).

A change that needs new expectations in one of them needs the
maintainer's sign-off in the pull request. To rewrite the golden file
after an intended rendering change, run
`UPDATE_GOLDEN=1 npx vitest run tests/golden-escpos.test.ts` and include
the diff.

A new test file sets its own `DATA_DIR` subfolder in `vi.hoisted` and
stubs `fetch`, like the existing ones.

## Where code goes

Routes, pages and scripts call operations (`lib/ops/`). Operations call
the stores in `lib/`. Biome enforces this: code in `app/` and
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

   An op with no write effect is read-only. Outputs are JSON values: ISO
   strings for times, `Binary` (`lib/ops/schema.js`) for bytes.
2. Throw `new OpError(code, message)` for expected failures. The route
   helpers map `unauthenticated` to 401, `forbidden` 403, `invalid` 400,
   `not_found` 404, `conflict` 409, `too_large` 413 and `unavailable` 502.
3. A new `lib/ops/` module also goes into `lib/ops/index.js`. A new op in an
   existing module needs no registration.
4. Add a test in `tests/ops/` when the op has logic.

### Add a route

A route is a thin adapter: build the caller, read the request, call one
op.

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

Device endpoints are different: they use `app/_lib/device-auth.ts` and
the plain functions in `lib/ops/device-service.js`, and never answer 401
for anything but a bad token.

### Add a page

1. Create `app/(dashboard)/<name>/page.tsx`. Get the caller with
   `getCaller()` from `app/_lib/caller.ts`, redirect to `/login` when it is
   null, and call ops for the data.
2. Put interactive parts in a `'use client'` component that calls an
   `app/api/` route.
3. Add the page to the sidebar in `components/app-sidebar.tsx`.
4. Describe it in `docs/design-spec.md`, which must match what is built.

Any polling from a page follows `components/hooks/use-eased-poll.ts`, and
its cost goes through the quota math in `docs/store-costs.md` first.

### Add a plugin

1. Write a module in `plugins/` that exports `id`, `meta`, `defaults`,
   `templates`, `configLabels`, and `run` (with a `defaults.schedule`),
   `onMessage`, or both. `README.md` shows the shape.
2. Add it to `PLUGINS` in `plugins/index.js`.
3. Put its templates in a `reference/*-templates.json` file. A new file
   also goes into `SEED_TEMPLATE_FILES` in `lib/plugin-setup.js`.
4. Reach the world only through `ctx`. Biome forbids imports from `lib/`,
   `db/`, Next.js and React in `plugins/`.
5. Load heavy dependencies inside the code path that uses them, so
   `/ingest` and the Slips pages stay light.

Registration runs on Slips page views, once per account per server
process, so after a deploy each account picks up a new plugin on its next
Slips visit. Work out what the schedule costs before you pick a default
(`docs/store-costs.md`). A plugin that polls an outside service should
start with `enabled: false`.

## Guidelines

- Only `lib/` touches Postgres, Redis, Blob or local files. New state
  needs both drivers (`json` and `redis`) where it lives in the hot path.
- Nothing on the device cadence (`/next`, an idle `/tick`) may query
  Postgres. Read `docs/store-costs.md` before adding anything polled or
  timer-driven.
- Schema changes: edit `db/schema.js`, run `npm run db:generate`, and
  commit the migration. Keep migrations additive.
- Update `docs/design-spec.md` when you change the dashboard UI.
- Add new environment variables to `.env.example` (a test checks it) and
  to the README table.
- Never commit secrets or personal data. `data/`, `.env` and
  `firmware/docket-agent/secrets.h` are gitignored. Use placeholder
  domains and numbers in docs.

## Questions

Open an issue.
