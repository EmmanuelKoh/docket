# DOCKET

A thermal-receipt platform: a hosted server (Vercel) renders Liquid+HTML
templates into ESC/POS bytes; an ESP32 appliance polls for jobs and prints
them on a Rongta RP850 over serial. Plugins print autonomously (World Cup
goals, a daily morning brief); a password-protected dashboard manages it all.

## Architecture in one line

`plugins/studio/photo → createJob (renders at creation, bytes stored) →
queue (Redis, atomic claim + 120s lease) → ESP32 polls /next → serial →
printer → /ack`. The ESP32 also POSTs `/tick` every 30s, which runs due
plugins server-side. No process polls on its own timer except the device.

## Layout

- `server.js` — local dev server; on Vercel, `api/*.js` are functions and
  `vercel.json` maps routes (incl. `/dashboard/:path*` → `api/dashboard.js`,
  which needs `includeFiles: views/**`)
- `render/render-core.js` — Liquid → Satori → resvg → Floyd-Steinberg
  (serpentine + midtone anti-checkerboard noise) → ESC/POS. Dithered jobs
  (auto-detected by tone transitions >0.2/px; text is ~0.01–0.12) are
  encoded as memorize-then-print chunks (`GS *`/`GS /`), **rotated 180°
  with a flush cut** so the printer's mechanical top leader becomes bottom
  margin. Text receipts use the classic single raster, byte-stable.
- `lib/` — store facades. `STORE_DRIVER=json` (local files in `data/`) or
  `redis` (Upstash + Vercel Blob for job png/bytes). Everything carries
  `ownerId` (single owner `default` for now); all Redis keys namespaced
  `rp:{owner}:...`. Never touch Redis/files outside `lib/`.
  Upstash bills per command and every hosting service has a meter — read
  `docs/store-costs.md` (per-path costs, quota math rule, rejected
  approaches) before adding any polled or timer-driven query.
- `plugins/` — registry plugins: export `id`, `defaults` (may set
  `enabled: false`; `schedule` is `{every: seconds}` or
  `{at: "HH:MM", timezone}` — see `lib/schedule.js`), optional
  `templates`/`configLabels`, and `run({config, state, ctx}) -> {state}`.
  Push-driven plugins export `passive: true` and no schedule. World is
  reached ONLY via ctx (`createJob`, `getTemplate`, `log`). Registered on
  first tick or Plugins-page view; the tick runs only what's due.
- `views/` — LiquidJS pages + htmx fragments for the dashboard;
  `views/studio.html` is the template editor (served behind auth at
  `/studio`). `public/docket.css` is the design system.
- `firmware/docket-agent/` — the ESP32 sketch. Credentials in gitignored
  `secrets.h` (copy from `.example`). RP850 pins: DevKit TX=17/RX=16,
  115200 baud.
- `scripts/` — `migrate-json-to-redis.js` (idempotent), `show-plugin.js`,
  `toggle-plugin.js`, `print-calibration.js` (grayscale wedges through the
  real pipeline).

## Auth model

- Dashboard pages, `/studio`, and JSON APIs (`/templates`, `/jobs`,
  `/preview`): stateless HMAC session cookie (`DASHBOARD_PASSWORD` +
  `SESSION_SECRET`).
- Device endpoints (`/next`, `/ack`, `/nack`, `/tick`): Bearer
  `DEVICE_TOKEN` ONLY — never the cookie (the ESP32 can't log in).

## Design

`docs/design-spec.md` is the visual source of truth (monochrome + register
red, both themes, strict red-usage rules) — **update it whenever the UI
changes**; it must describe what's built. Key rules that keep recurring:
buttons never repeat an already-clickable object's default action; rows
with thumbnails top-align; thumbnails sit on #fff in both themes; red only
for active nav / printing / failures / nonzero queue count.

## Hardware truths

`docs/rp850-field-notes.md` holds measured printer behavior (geometry,
status bytes, the mute-after-flash quirk, the 800-row GS* ceiling, dot
gain). `docs/receipt-printer-build-guide.md` is the generic staged
bring-up. Photo tone compensation (the calibrated curve) lives in
`views/photo.liquid` with a keep-in-sync copy in the calibration script.

## Workflows

- Local dev: `npm start` (+ `node agent/heartbeat.js` and
  `node agent/printer-agent.js` only if the ESP32 isn't covering those).
  Login needs `DASHBOARD_PASSWORD`/`SESSION_SECRET` in `.env`.
- **Restart the server after editing views/** — LiquidJS caches compiled
  templates in-process. CSS only needs a browser refresh.
- Templates seed **only if missing** (from `reference/*-templates.json` on
  tick). Editing a seeded template's reference file requires syncing the
  stored copy (local `data/templates.json`, hosted via studio or a POST).
- Firmware test loop: point `secrets.h` at the laptop
  (`http://<mac-ip>:3000`), flash, **power-cycle the printer after
  flashing** (see field notes), test, point back at production.
- Deploys: push to main → Vercel. Production stores are Upstash Redis +
  Blob (`STORE_DRIVER=redis` + tokens in Vercel env). Preview deployments
  share production data (ownerId isolation is the escape hatch).

## Conventions for working here

- The owner iterates by eye on physical output: prefer cheap probes and
  calibration prints over theorizing; one test print settles arguments.
- Discuss design options before building non-trivial features; present
  trade-offs and a recommendation.
- Explain in plain language — define jargon on first use.
- No git commands that mutate state; the owner commits and pushes manually.
  Provide one-line commit messages / PR descriptions on request.
- Keep `data/`, `.env`, `secrets.h` out of git (already ignored). This
  repo is public.
