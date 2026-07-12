# Store costs

Every service this system runs on has a meter. This doc records what each
hot path costs, the rules that keep costs proportional to activity, and the
approaches that were evaluated and rejected. **Run the quota math before
adding any polled or timer-driven query**: cadence × commands per request ×
30 days, compared against the plan's cap, for every metered service the
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
| `POST /tick`, nothing due | every 30s | 4-6 cmds = ~14,000 | tick flag says "nothing due" → 0 Redis; ~1 safety claim/5min = 288/day |
| World Cup runs (enabled) | every 60s | 4 per run = 5,760 | 3 per run = 4,320 |
| Morning-brief | 288 wake-ups/day | 4 each = 1,152 | 1 real run/day ≈ 3 |
| Dashboard queue refresh | every 3s per tab | ~2 per refresh, 24/7 = 57,600/tab | only while tab visible ≈ ~1,200 |
| **Total (Redis)** | | **~130K/day ≈ 4M/mo** (one open tab) | **~11K/day ≈ 330K/mo (under the 500K free tier; ~200K/mo once the World Cup plugin is off)** |

Blob flag reads are effectively free: measured July 12 2026 on the
production store, ~14K flag reads per 12h moved the Simple Operations
meter barely at all (508/10K used after ten days) — cache-busted reads of
tiny flags bill as downloads/data transfer (~100MB/mo against the 10GB
cap, ~1%). The binding Blob meter is Advanced Operations (WRITES): 2K/mo
on the Hobby store, shared with print artifacts (2-3 puts per print) and
tape saves. Flag writes must therefore be rare and deduplicated — see the
tick flag's active/idle write policy below. Idle cost per plugin is zero:
only actual runs cost commands, so cost scales with each plugin's
schedule, not with how many plugins exist.

Tape takes (added July 2026) follow the templates pattern: the meta list
is one Redis key, so a list read is 1 command and a save/attach/delete is
2-3. Nothing polls — the list fetches once per Tape-page mount and after
each save/delete, so cost scales with actual use (tens of commands per
session, noise next to the totals above). The heavy payloads never touch
Redis: the take document JSON and the audio WAV live in Blob (audio is
uploaded browser→Blob directly via a minted client-upload token — routes
cap at ~4.5MB). Storage is the meter that moves: WAV is ~2.65MB/min, so
the 1GB included tier holds ~380 minutes of saved takes. Deletes are
soft (tombstone, purged lazily on list reads after 30 days), so a
deleted take's blobs linger up to a month — a few MB of grace-period
storage, no extra commands except the rare purge itself.

### Multi-user scaling rule (accounts, 2026)

Every cost above is per owner, and owners multiply: each household's
device polls on its own. The budget survives because both hot paths now
idle on Blob flags (queue flag for /next, tick flag for /tick) at zero
Redis commands, so an idle device costs ~9K commands/month (presence
writes plus safety checks) instead of ~300K. Postgres (Neon) has its own
meter, CU-hours, with the matching rule: nothing on the device cadence
may touch Postgres, or the database never scales to zero (an always-on
0.25 CU instance is ~180 CU-hours/month against the 100 free). Postgres
wakes for dashboard traffic and actual prints only. Registration and
template seeding run on the Slips page view, never on ticks.

### The queue and tick flags (Blob-backed change signals)

`/next` polls read a tiny per-owner flag file in Vercel Blob ("does the
queue have work?") and only run the Redis claim when it says yes or is
unreadable. The store layer maintains it (createJob/nackJob set true, a
verified-empty claim sets false) so feature code can never forget; a 60s
safety check in /next bounds any stale flag to a 60s print delay, never a
lost print. Chosen over Redis for the read price ($0.40/M vs $2.00/M) and
over Edge Config for the meter (no read cap). Probed July 2026 against the
production store with scripts/blob-staleness-probe.mjs: an overwritten
flag is visible to a cache-busted fetch in 46-184ms; plain fetches can lag
~2s on the CDN, so the reader always cache-busts.

The tick flag (tick-flag/{owner}.json) applies the same idea to /tick: it
holds the owner's earliest nextDueAt, refreshed by everything that changes
the schedule (toggle, config save, registration, and any tick that ran
something). An idle tick reads the flag and returns without touching
Redis. The safety valve is a real due-claim at least once per 5 minutes
per warm instance, so a lost flag write delays a plugin run by at most 5
minutes, once, and can never silently stop a plugin.

Because blob WRITES are the scarce meter (2K/mo Advanced Operations on
Hobby), the tick flag is written in two modes rather than after every
run: a plugin due within 10 minutes writes the stable value 0 ("check
every tick") exactly once and the dedup suppresses the rest, however
often the plugin runs; a far-off next run writes the timestamp quantized
to the minute (floor, so checks resume up to 60s early). A World Cup day
costs one flag write; a morning-brief-only owner costs about one per day.
Naively writing each post-run nextDueAt would have burned ~1,440 puts/day
at every:60s and tripped Hobby's 30-day Blob lockout in under two days.

Vercel function invocations are separate: `/next` + `/tick` at 5s/30s ≈
20K/day ≈ 620K/mo against the 1M Hobby cap (was ~960K/mo at 3s polls).
Print latency worst case is 5s.

## Plugin scheduling (July 2026 redesign)

Plugins declare when they run; users edit it on the Plugins page:

- `schedule: { every: seconds }` for watchers (World Cup checks ESPN each run)
- `schedule: { at: "HH:MM", timezone }` for fixed-time plugins (the daily brief)
- `passive: true` for push-driven plugins (message-ingest), which never run on a timer

The store layer derives a `nextDueAt` per plugin and keeps it in a sorted
due-index. An idle tick asks one question ("anything due?") via an atomic
claim that also leases what it returns, so concurrent ticks can't double-run
a plugin, and a crashed run re-becomes due after ~90s. Failures always fall
toward one late re-run, never a silently stopped plugin (plugins keep their
own idempotence guards, e.g. the brief's once-per-day check). A failed run
retries at the lease cadence, not its normal schedule. "At" schedules fire
on the first tick after the wall-clock time (~30s precision, tied to
TICK_MS). Schedule edits apply on Save (which recomputes the due time);
enabling a plugin reschedules it from now.

## Rules that keep costs proportional to activity

- **Dashboard polls only while visible**: the Queue page re-fetches
  `/api/queue` every 3s only while `document.visibilityState` is visible
  (`components/queue-list.tsx`). Hidden tabs cost zero; cost scales with
  people watching, not tabs open.
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
our ~520K reads/mo, roughly $4-5/mo in overage. The design itself was
right and shipped later the same week on Blob (see The queue flag above),
whose read price and uncapped meter fit. The transport turned out to be a
pricing decision, verified by probe, rather than an architecture decision.

**Vercel Cron for fixed-time plugins.** Hour-level precision on Hobby
(a 06:30 job fires anywhere in the 6 o'clock hour), 2 crons max, and a
second clock to reason about. The scheduling redesign achieves 30-second
precision from the existing device tick instead.

**MQTT push to the device.** Eliminates polling entirely, but adds a
broker vendor, firmware rework, and reconnect handling, all for a latency
improvement (3s → instant) that nothing currently needs.
