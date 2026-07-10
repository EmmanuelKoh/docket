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

- `app/`: the Next.js App Router application (TypeScript + Tailwind 4 +
  the shadcn kit in `components/ui/`). Dashboard pages live in the
  `(dashboard)/` route group behind the session; device endpoints are
  `app/{next,ack,nack,tick}/route.ts`; `/ingest`, the studio-facing JSON
  APIs (`/templates`, `/preview`, `/jobs`) are route handlers importing
  `lib/` directly; the Studio (`/studio`) and Photo (`/photo`) pages are
  React like everything else. `next.config.mjs` keeps the render/plugin
  deps in `serverExternalPackages` (Turbopack breaks node-ical and the
  resvg native module otherwise) and traces `reference/**` and
  `render/fonts/**` into the deployed functions. `/next` MUST send an
  explicit Content-Length: the ESP32 reads it via `http.getSize()` and
  nacks forever on a chunked response.
- `render/render-core.js`: Liquid → Satori → resvg → Floyd-Steinberg
  (serpentine + midtone anti-checkerboard noise) → ESC/POS. Dithered jobs
  (auto-detected by tone transitions >0.2/px; text is ~0.01-0.12) are
  encoded as memorize-then-print chunks (`GS *`/`GS /`), **rotated 180°
  with a flush cut** so the printer's mechanical top leader becomes bottom
  margin. Text receipts use the classic single raster, byte-stable.
- `lib/`: store facades. `STORE_DRIVER=json` (local files in `data/`) or
  `redis` (Upstash + Vercel Blob for job png/bytes). Everything carries
  `ownerId` (single owner `default` for now); all Redis keys namespaced
  `rp:{owner}:...`. Never touch Redis/files outside `lib/`.
  Upstash bills per command and every hosting service has a meter, so read
  `docs/store-costs.md` (per-path costs, quota math rule, rejected
  approaches) before adding any polled or timer-driven query.
- `plugins/`: registry plugins. Each exports `id`, `defaults` (may set
  `enabled: false`; `schedule` is `{every: seconds}` or
  `{at: "HH:MM", timezone}`, see `lib/schedule.js`), optional
  `templates`/`configLabels`, and `run({config, state, ctx}) -> {state}`.
  Push-driven plugins export `passive: true` and no schedule. World is
  reached ONLY via ctx (`createJob`, `getTemplate`, `log`). Registered on
  first tick or Plugins-page view; the tick runs only what's due.
- `components/photo-engine.js`: the Photo tool's imperative engine,
  carried VERBATIM from the pre-rewrite page because it is live-tested
  against the printer: the calibrated tone curve (keep-in-sync copy in
  `scripts/print-calibration.js`), the dither-worker viewfinder protocol
  (`public/dither-worker.js`), and the crop/levels pointer math. Its
  markup is `components/photo-tool.tsx` and its styles
  `app/(dashboard)/photo/photo-tool.css`; ids and class names are the
  contract between the three. Do not "modernize" the engine.
- The Tape tool (`/tape`): live duduk transcription in the browser
  (mic → `public/pcm-worklet.js` → `public/pitch-worker.js` (MPM) →
  `components/tape-events.js` note tracker → `components/tape-renderer.js`
  raster rows). The renderer is pure JS and its rows ARE the print bytes:
  the preview canvas and `/api/tape/print` (→ `createRawJob`, a job with
  `template: null` that Reprint refuses) consume the same arrays; never
  add a second rendering path. The tool lives in `components/tape/`:
  React controls (`tape-tool.tsx`) over a zustand store (`store.ts`),
  an imperative controller (`controller.js`) that owns the session and
  the canvas island (`tape-view.js`), audio/decode/playback modules,
  and the take document (`doc.mjs` — derives the timeline via the
  tape-eval passes and holds edits/undo/versions; `npm run tape:doc`
  checks it). Only the canvases are imperative; controls are ordinary
  React reading the store. Editing (click a note → inspector strip)
  re-renders the whole tape from the edited timeline; detection
  freezes while edits exist ("Start over" re-derives, snapshotting
  the edited tape into doc.versions first). Saved takes:
  `lib/tape-store.js` (meta in one Redis key, document JSON + lossless
  WAV in Blob; json driver = files in `data/tape/`) behind
  `/api/tape/takes*`; hosted audio uploads go browser→Blob via a
  client-upload token (`/api/tape/takes/upload`) because WAVs exceed
  the ~4.5MB route cap.
- `firmware/docket-agent/`: the ESP32 sketch. Credentials in gitignored
  `secrets.h` (copy from `.example`). RP850 pins: DevKit TX=17/RX=16,
  115200 baud.
- `scripts/`: `migrate-json-to-redis.js` (idempotent), `show-plugin.js`,
  `toggle-plugin.js`, `print-calibration.js` (grayscale wedges through the
  real pipeline), `tape-eval/` (Tape transcription v2 pipeline + corpus
  scorer — `npm run tape:eval` scores every `data/clips/*.truth.json`
  fixture; see docs/tape-transcription-v2.md before touching detection).

## Auth model

- Dashboard pages, `/studio`, and JSON APIs (`/templates`, `/jobs`,
  `/preview`): stateless HMAC session cookie (`DASHBOARD_PASSWORD` +
  `SESSION_SECRET`).
- Device endpoints (`/next`, `/ack`, `/nack`, `/tick`): Bearer
  `DEVICE_TOKEN` ONLY, never the cookie (the ESP32 can't log in).

## Design

`docs/design-spec.md` is the visual source of truth (monochrome + register
red, both themes, strict red-usage rules). **Update it whenever the UI
changes**; it must describe what's built. Key rules that keep recurring:
buttons never repeat an already-clickable object's default action; rows
with thumbnails top-align; thumbnails sit on #fff in both themes; red only
for active nav / printing / failures / nonzero queue count.

## Hardware truths

`docs/rp850-field-notes.md` holds measured printer behavior (geometry,
status bytes, the mute-after-flash quirk, the 800-row GS* ceiling, dot
gain). `docs/receipt-printer-build-guide.md` is the generic staged
bring-up. Photo tone compensation (the calibrated curve) lives in
`components/photo-engine.js` with a keep-in-sync copy in the calibration
script.

## Workflows

- Local dev: `npm run dev` (+ `node agent/heartbeat.js` and
  `node agent/printer-agent.js` only if the ESP32 isn't covering those).
  Login needs `DASHBOARD_PASSWORD`/`SESSION_SECRET` in `.env`.
- Everything hot-reloads under `npm run dev` (LiquidJS now runs only
  inside the render core, per render).
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

- The maintainer iterates by eye on physical output: prefer cheap probes
  and calibration prints over theorizing.
- Discuss design options before building non-trivial features; present
  trade-offs and a recommendation.
- Explain in plain language and define jargon on first use.
- No git commands that mutate state; the maintainer commits and pushes
  manually. Provide one-line commit messages / PR descriptions on request.
- Keep `data/`, `.env`, `secrets.h` out of git (already ignored). This
  repo is public; never write personal data, tokens, or real phone
  numbers into tracked files or docs.
