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
model). "Now" = after the July 2026 fixes below.

| Path | Cadence | Before | Now |
|---|---|---|---|
| `GET /next` claim | every 3s | 1 cmd/poll = 28,800 | unchanged = 28,800 |
| `GET /next` last-seen write | every poll | 28,800 | throttled to 1/60s = 1,440 |
| `POST /tick` registry reads | every 30s | 3–4 per tick = ~11,500 | one batched read (2 cmds) = 5,760 |
| World Cup plugin runs | every 60s while enabled | 4 per run = 5,760 | unchanged = 5,760 |
| Morning-brief runs | every 300s | 4 per run = 1,152 | unchanged = 1,152 |
| Dashboard queue refresh | every 3s per tab | ~2 per refresh, 24/7 = 57,600/tab | only while tab visible ≈ ~1,200 |
| **Total** | | **~130K/day ≈ 4M/mo** (one open tab) | **~44K/day ≈ 1.3M/mo** |

Vercel function invocations are separate: `/next` + `/tick` ≈ 31K/day ≈
960K/mo against the 1M Hobby cap. Raising the firmware `POLL_MS` from 3s to
5s drops this to ~620K/mo (and removes ~350K Redis commands/mo). Print
latency worst case becomes 5s instead of 3s.

## Rules that keep costs proportional to activity

- **Dashboard fragments poll only while visible** — `hx-trigger="every 3s
  [document.visibilityState=='visible']"` (`views/queue-list.liquid`).
  Hidden tabs cost zero; cost scales with people watching, not tabs open.
- **Device presence writes are throttled** (`lib/device-presence.js`, 60s).
  The dashboard's online rule is 90s, so the indicator stays correct.
- **`/tick` reads all plugin records in one batched query** and writes a
  record only when that plugin actually ran.
- **Heavy payloads do not belong in Redis records.** Job records store blob
  URLs for rendered output; photo *input* data currently violates this
  (`data.photo` is a full base64 JPEG inside the record, re-downloaded by
  every dashboard list read — this caused a 356MB bandwidth day). Known
  fix, not yet built: offload large `data` fields to Blob at create time.

## Planned reductions (designed, not yet built)

- **Plugin scheduling redesign**: plugins declare `every: N` seconds or
  `at: "HH:MM"` + timezone; the runner stores each plugin's next-due time
  and the tick reads one earliest-due value — 1 command per idle tick
  regardless of plugin count, and fixed-time plugins (the brief) drop from
  288 wake-ups/day to 1. Needs a staleness safety: re-scan the full
  registry every ~5 minutes so a missed schedule edit is bounded.
- **Firmware `POLL_MS` 3s → 5s** at next reflash (see table above).
- **World Cup plugin off-season**: disable it on the Plugins page when the
  tournament ends; it is ~170K commands/mo while enabled.

## Evaluated and rejected (keep with the reasons)

**Edge Config change-beacon (built July 2026, removed before deploy).**
A free-read flag in Vercel Edge Config in front of `/next`, so idle polls
skip Redis. Correct design, wrong meter: Edge Config's Hobby allowance is
100K reads/mo and 100 writes/mo against our ~860K reads/mo and ~300
writes/mo — roughly $4–5/mo in overage, versus ~$1.60/mo for simply paying
Upstash for the polls it replaces. Rejected on arithmetic, not on
architecture: with a genuinely free high-read store (or at multi-user
scale where per-user polling multiplies), the same per-owner-per-purpose
flag design applies. The git history has the full implementation
(`lib/change-signal.js`).

**Vercel Cron for fixed-time plugins.** Hour-level precision on Hobby
(a 06:30 job fires anywhere in the 6 o'clock hour), 2 crons max, and a
second clock to reason about. The scheduling redesign achieves 30-second
precision from the existing device tick instead.

**MQTT push to the device.** Eliminates polling entirely, but adds a
broker vendor, firmware rework, and reconnect handling — for a latency
improvement (3s → instant) nothing currently needs.
