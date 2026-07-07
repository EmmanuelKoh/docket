# Store costs

Every service this system runs on has a meter. This doc records what each
hot path costs, the rules that keep costs proportional to activity, and the
approaches that were evaluated and rejected. **Run the quota math before
adding any polled or timer-driven query**: cadence × commands per request ×
30 days, compared against the plan's cap — for every metered service the
change touches, not just the obvious one.

## The meters (July 2026)

| Service | Meters | Free allowance | Overage |
|---|---|---|---|
| Upstash Redis | commands, bandwidth | 500K commands/mo, 10GB/mo (free plan) | pay-as-you-go: $0.20/100K commands |
| Vercel functions | invocations | 1M/mo (Hobby) | plan upgrade |
| Vercel Edge Config | reads, writes | 100K reads/mo, 100 writes/mo (Hobby) | $3/1M reads, $1/100 writes |
| Vercel Blob | storage, transfer | ~1GB (Hobby) | plan-dependent |
| Gemini API | requests/tokens | per-model free tier | per-token pricing |

## Cost per path (one owner, per day)

Measured July 2026 (372K writes + 153K reads over a few days confirmed the
model). "Now" = after the July 2026 changes: schedule redesign, visible-tab
polling, throttled presence, POLL_MS 5s (takes effect at the next reflash).

| Path | Cadence | Before | Now |
|---|---|---|---|
| `GET /next` claim | every poll | 3s polls: 28,800/day | queue flag says "empty" → 0 Redis; ~1 safety claim/60s = 1,440/day |
| `GET /next` last-seen write | every poll | 28,800 | throttled to 1/60s = 1,440 |
| `POST /tick`, nothing due | every 30s | 4–6 cmds = ~14,000 | one atomic due-claim = 2,880 |
| World Cup runs (enabled) | every 60s | 4 per run = 5,760 | 3 per run = 4,320 |
| Morning-brief | 288 wake-ups/day | 4 each = 1,152 | 1 real run/day ≈ 3 |
| Dashboard queue refresh | every 3s per tab | ~2 per refresh, 24/7 = 57,600/tab | only while tab visible ≈ ~1,200 |
| **Total (Redis)** | | **~130K/day ≈ 4M/mo** (one open tab) | **~11K/day ≈ 330K/mo — under the 500K free tier; ~200K/mo once the World Cup plugin is off** |

Blob flag reads add ~520K/mo × $0.40/M ≈ $0.21/mo (writes are ~2 per print
— negligible). Idle cost per plugin is zero — only actual runs cost
commands, so cost scales with each plugin's schedule, not with how many
plugins exist.

### The queue flag (Blob-backed change signal)

`/next` polls read a tiny per-owner flag file in Vercel Blob ("does the
queue have work?") and only run the Redis claim when it says yes or is
unreadable. The store layer maintains it (createJob/nackJob set true, a
verified-empty claim sets false) so feature code can never forget; a 60s
safety check in /next bounds any stale flag to a 60s print delay, never a
lost print. Chosen over Redis for the read price ($0.40/M vs $2.00/M) and
over Edge Config for the meter (no read cap). Probed July 2026 against the
production store with scripts/blob-staleness-probe.mjs: an overwritten
flag is visible to a cache-busted fetch in 46–184ms; plain fetches can lag
~2s on the CDN, so the reader always cache-busts.

Vercel function invocations are separate: `/next` + `/tick` at 5s/30s ≈
20K/day ≈ 620K/mo against the 1M Hobby cap (was ~960K/mo at 3s polls).
Print latency worst case is 5s.

## Plugin scheduling (July 2026 redesign)

Plugins declare when they run; users edit it on the Plugins page:

- `schedule: { every: seconds }` — watchers (World Cup checks ESPN each run)
- `schedule: { at: "HH:MM", timezone }` — fixed-time (the daily brief)
- `passive: true` — push-driven (message-ingest), never runs on a timer

The store layer derives a `nextDueAt` per plugin and keeps it in a sorted
due-index. An idle tick asks one question ("anything due?") via an atomic
claim that also leases what it returns — concurrent ticks can't double-run
a plugin, and a crashed run re-becomes due after ~90s. Failures always fall
toward one late re-run, never a silently stopped plugin (plugins keep their
own idempotence guards, e.g. the brief's once-per-day check). A failed run
retries at the lease cadence, not its normal schedule. "At" schedules fire
on the first tick after the wall-clock time — ~30s precision, tied to
TICK_MS. Schedule edits apply on Save (which recomputes the due time);
enabling a plugin reschedules it from now.

## Rules that keep costs proportional to activity

- **Dashboard fragments poll only while visible** — `hx-trigger="every 3s
  [document.visibilityState=='visible']"` (`views/queue-list.liquid`).
  Hidden tabs cost zero; cost scales with people watching, not tabs open.
- **Device presence writes are throttled** (`lib/device-presence.js`, 60s).
  The dashboard's online rule is 90s, so the indicator stays correct.
- **`/tick` claims due plugins in one atomic command** and touches records
  only for plugins that actually run (see Plugin scheduling above).
- **Heavy payloads do not belong in Redis records.** Job records store blob
  URLs for rendered output; input data over 32KB (photo prints) is likewise
  offloaded to Blob at create time and re-inflated by getJob() for the
  debug view and Reprint. Before this fix, inline photo data
  (a full base64 JPEG inside the record, re-downloaded by every dashboard
  list read) caused a 356MB Redis-bandwidth day.

## Remaining reductions

- **World Cup plugin off-season**: disable it on the Plugins page when the
  tournament ends; it is ~130K commands/mo while enabled.
- **Reflash the ESP32** so the POLL_MS 5s change takes effect (the server
  side needs nothing).

## Evaluated and rejected (keep with the reasons)

**Edge Config as the change-beacon transport (built July 2026, removed
before deploy).** Same flag design as the shipped queue flag, wrong meter:
Edge Config's Hobby allowance is 100K reads/mo and 100 writes/mo against
our ~520K reads/mo — roughly $4–5/mo in overage. The design itself was
right and shipped later the same week on Blob (see The queue flag above),
whose read price and uncapped meter fit. Lesson: the transport is a
pricing decision, verified by probe, not an architecture decision.

**Vercel Cron for fixed-time plugins.** Hour-level precision on Hobby
(a 06:30 job fires anywhere in the 6 o'clock hour), 2 crons max, and a
second clock to reason about. The scheduling redesign achieves 30-second
precision from the existing device tick instead.

**MQTT push to the device.** Eliminates polling entirely, but adds a
broker vendor, firmware rework, and reconnect handling — for a latency
improvement (3s → instant) nothing currently needs.
