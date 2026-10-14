# Store costs

Every service this system runs on has a meter. This doc records what each
hot path costs, the rules that keep costs proportional to activity, and the
approaches that were evaluated and rejected. **Run the quota math before
adding any polled or timer-driven query**: cadence × commands per request ×
30 days, compared against the plan's cap, for every metered service the
change touches, not just the obvious one.

## The meters (October 2026)

| Service | Meters | Free allowance | On-demand rate |
|---|---|---|---|
| Upstash Redis | commands, bandwidth | 500K commands/mo, 10GB/mo (free plan) | $0.20 per 100K commands (pay as you go) |
| Neon Postgres | compute, in CU-hours | 100 CU-hours/mo (Free); compute suspends after 5 idle minutes | $0.106 per CU-hour (Launch) |
| Vercel functions | invocations | 1M/mo (Hobby) | plan upgrade |
| Vercel CDN Requests | every request to the deployment and every Blob URL read | 1M/mo (Hobby) | $2.00 to $3.20 per 1M, by region |
| Vercel Blob | storage, Simple Operations (reads that miss the cache), Advanced Operations (writes), data transfer | 1GB storage, 10K Simple and 2K Advanced Operations, 10GB transfer per month (Hobby) | regional |
| Gemini API | requests, tokens | per-model free tier | per-token pricing |

On Hobby, a Vercel allowance that runs out is not billed: the feature stops
until 30 days have passed.

Measured from 2026-09-12 to 2026-10-12: 929,361 CDN Requests, 93% of the
Hobby allowance. One device's `/next` and `/tick` requests are 604,800 of
them per 30 days (65%). Vercel's Blob pricing docs say every Blob URL read
counts as a CDN Request. If the server's flag reads billed that way, one
queue-flag read per poll would add 518,400 per owner per 30 days, more than
the measured total leaves room for. The measurement and the docs disagree,
so the Vercel Usage breakdown must settle how the server's flag reads bill
before anything adds more polling. "The queue and tick flags" below
compares the read prices.

Neon: an isolated wake costs about 0.021 CU-hours (the 0.25 CU minimum for
the 5 minutes before compute suspends). Anything that wakes it at least
every 5 minutes around the clock keeps it always on: 0.25 CU × 720 hours =
180 CU-hours a month, against 100 free.

## Cost per path (one owner, per day)

An idle device costs a fixed Redis budget and nothing else.
`tests/meter-budget.test.ts` measures it against faked Redis, Blob and
Postgres and fails if a change adds to it. With the firmware cadence
(`/next` every 5s, `/tick` every 30s) and one warm server instance:

| Path | Cadence | Redis commands per day |
|---|---|---|
| `GET /next` safety claim | 1 EVAL per 60s | 1,440 |
| `POST /tick` safety check | 2 commands (claim EVAL + ZRANGE) per 5 min | 576 |
| Presence write | 1 SET per 60s, per device | 1,440 |
| Device-token mirror read | 1 GET per 5 min (the in-memory token cache expires) | 288 |
| **Idle device, one owner** | | **3,744/day, about 112K per 30 days** |

Between safety checks, an idle poll or tick reads one Blob flag per owner
and touches neither Redis nor Postgres. Each member of a shared device adds
its own safety claims and checks: 2,016 a day, about 60K per 30 days (the
test's two-owner device is 5,760 a day, about 173K per 30 days). The
Upstash free tier covers about four idle single-owner devices.

Active costs come on top:

- A queued job: one claim EVAL, then one Postgres select and update and
  one artifact read for the bytes. Creating the job adds two or three
  Blob artifact writes, Postgres writes and a few Redis commands; the ack
  adds one Redis command and a Postgres select and update.
- Plugins: while any plugin is due within 10 minutes, the tick flag says
  "check every tick", so every tick runs the claim: 2 commands per tick,
  5,760 a day. Each run adds 3 (GET, SET and ZADD of its record). The World
  Cup plugin at `every: 60` keeps this up all day: up to about 10,000 a
  day, about 300K per 30 days. The morning brief costs about 45 a day: the
  ticks in the 10 minutes before it is due, and its run.
- Dashboard Queue page or Studio strip: one function invocation and one
  Postgres query per poll, 1,200 an hour while the person is active, 120
  an hour after two idle minutes, none once paused or hidden. The Studio
  strip (`/jobs?limit=10`) reads no Redis. A Queue poll (`/api/queue`)
  adds one HGETALL while a listed job has been handed to a printer, plus
  one LRANGE while a job waits at the back of the queue.

Before the July 2026 changes (3s polls, a presence write per poll, a
dashboard poll in hidden tabs) one owner cost about 130K Redis commands a
day.

Blob flag reads cost little against the Blob meters (CDN Requests are a
separate meter, covered under the queue and tick flags below): measured
July 12 2026 on the production store, ~14K flag reads per 12h moved the Simple
Operations meter barely at all (508/10K used after ten days), and the
transfer is ~100MB/mo against the 10GB cap, ~1%. The binding Blob meter is
Advanced Operations (writes): 2K/mo on the Hobby store, shared with print
artifacts (2-3 puts per print) and tape saves. Flag writes must therefore
be rare and deduplicated; see the tick flag's active and idle modes below.
Idle cost per plugin is zero: only actual runs cost commands, so cost
scales with each plugin's schedule, not with how many plugins exist.

Tape takes (added July 2026): the meta rows live in Postgres (human
traffic only), so takes cost no Redis commands at all. Nothing polls: the
list loads when the Tape page opens and after a save. The heavy payloads
never touch Redis: the take document JSON and the audio WAV live in Blob
(audio goes from the browser to Blob directly with a client-upload token,
since routes cap requests at ~4.5MB). Storage is the meter that moves: WAV
is ~2.65MB/min, so the 1GB included tier holds ~380 minutes of saved
takes. Deletes are soft (a tombstone, purged after 30 days when the takes
list loads), so a deleted take's blobs linger up to a month: a few MB of
grace-period storage, and no extra commands except the rare purge itself.

Ingest (October 2026): `/ingest` is push traffic (a forwarded text) and
runs on no timer. The sender's token resolves from a kv mirror,
`rp:_credentials:message-ingest:ingestToken:{sha256}`, written when the
token is minted and after any Postgres hit: one GET for the entry and one
GET of the owner's message-ingest record, which must still hold that
token. Postgres answers only on a mirror miss (flushed Redis, an edited
token) and for an unknown token. An instance remembers an unknown token
for a minute and refuses it again with no Redis or Postgres read. A
token no config could hold (over 128 characters, spaces or non-ASCII)
costs no read at all. An instance looks up at most 30 tokens a minute
that it has never resolved; past that `/ingest` answers 429 with no
read. Each message then claims
`rp:{owner}:seen:message-ingest:{sha256}` (SET NX
EX 90, just past the 60s function limit) and marks it done with one
more SET (EX 900), so a resend within 15 minutes costs five commands and
no Postgres. A handled message still wakes Neon for the
Task template check and, when it prints, the job row.

Dashboard page loads (October 2026): the sidebar's queue badge, on
every dashboard page, reads `jobs.queueSize`: LLEN plus ZCARD, two Redis
commands and no Postgres (locally one grouped count), streamed in after
the page instead of a 1000-row job listing before it. Overview's queue
cell shares that read within the request. Job thumbnails on Overview,
Queue, History and the Studio load from the artifact's public Blob URL
(jobs.list carries it), so a thumbnail costs Blob data transfer and a CDN
Request, not a function invocation, a Postgres select and a Blob read.
Slip previews render once per template version per browser (and again
after a deploy): their URL carries the template's updatedAt and the
deploy's short commit hash, and the response is cached `private,
immutable`, so only a save, a deploy or a new browser renders again.

### Multi-user scaling rule (accounts, 2026)

Every cost above is per owner, and owners multiply: each household's
device polls on its own. The budget survives because both hot paths idle
on Blob flags (queue flag for /next, tick flag for /tick) at zero Redis
commands, so an idle device costs about 112K commands per 30 days
(presence writes, token-mirror reads and safety checks). Postgres (Neon)
has its own meter, CU-hours, with the matching rule: nothing on the device
cadence may touch Postgres, or the database never scales to zero. Postgres
wakes for dashboard traffic and actual prints only. Registration and
template seeding run on the Slips page view, never on ticks.

### Shared devices (July 2026)

A device can serve several owners (members). Cost shape per meter:
Vercel invocations are per DEVICE and do not change with members (the
same one appliance polls at the same cadence; the 1M cap is what a
second physical printer would threaten). Redis: each member adds their
own safety checks, about 60K commands per 30 days, so an idle shared
device costs about 112K + 60K per extra member against the 500K tier.
Blob flag reads multiply per member. Postgres is untouched by the member
loops; it wakes per human action as ever. Presence is written once per
device, to the primary owner's slot, not per member. So a member adds
about 60K Redis commands per 30 days and no invocations, while a second
device adds its own 604,800 invocations per 30 days and its own idle Redis
budget. Beyond that, costs grow with prints and plugin runs.

Device-less accounts round to zero at rest (nothing polls for an owner
with no printer; their registered plugins never run). What they do cost:
Neon bills the ~5-minute wake window after any query, so VISIT FREQUENCY
is the real variable: a hundred once-a-day visitors is ~60 CU-hours a
month of the 100 free, while weekly visitors are noise. A parked Queue tab
used to keep Postgres awake around the clock (180 CU-hours a month) and
cost about 864K function invocations a month at 3s polling. The queue list
now follows the human instead: 3s while active on the page, 30s after two
idle minutes, fully paused after thirty with a manual refresh. An
abandoned tab costs about a hundred fetches and then nothing.

### The queue and tick flags (Blob-backed change signals)

`/next` polls read a tiny per-owner flag file in Vercel Blob ("does the
queue have work?") and only run the Redis claim when it says yes or is
unreadable. The queue maintains it (`lib/queue/redis.js`: enqueue and
requeue set true, a verified-empty claim sets false) so feature code can
never forget; a 60s safety check in /next bounds any stale flag to a 60s
print delay, never a lost print. Several instances write the flag, so each
write follows a fresh read and is skipped only when the flag already holds
the value (October 2026: a per-instance "last written" dedup could leave
it true on an empty queue, a Redis claim per poll, or false on a queue
with work). The safety check reads the flag as well, so every poll reads
it, and a safety claim that finds work under "false" sets it. Writes stay
at one true and one false per burst of jobs; only while the flag cannot be
read does an instance fall back to its own last write.

Blob was chosen over Redis for the flags because a flag read was priced as
a Blob Simple Operation ($0.40 per 1M) against Redis's $2.00 per 1M, and
over Edge Config for its 100K reads/mo cap (see Evaluated and rejected).
Measured on the production store, flag reads barely moved the Simple
Operations meter (see above). Vercel's Blob pricing docs also count every
Blob URL read as a CDN Request ($2.00 to $3.20 per 1M on demand), which
would put a flag read at Redis's price or above. The measured CDN total
at the top of this doc is too low for every server flag read to have
counted, and the Usage breakdown has not settled it. On on-demand billing
either price is small: one flag read per 5s poll is 518,400 reads per
owner per 30 days, about $1.04 on Redis and $1.04 to $1.66 as CDN
Requests. On Hobby the allowances bind instead: 500K Redis commands and
1M CDN Requests a month.

Probed July 2026 against the production store
(probe script in git history): an overwritten flag is visible to a
cache-busted fetch in 46-184ms; plain fetches can lag ~2s on the CDN, so
the reader always cache-busts. That probe wrote flags with a cache
max-age of 0. Since @vercel/blob 1.0 the lowest allowed value is 60
seconds, so flags are now written with 60. A plain fetch can then lag up
to a minute. A cache-busted fetch is a new CDN key each time, so it
should still see a write within the probed window.

The tick flag (tick-flag/{owner}.json) applies the same idea to /tick: it
holds the owner's earliest nextDueAt, refreshed by everything that changes
the schedule (toggle, config save, registration, and any tick that
claimed). An idle tick reads the flag and returns without touching Redis.
The safety valve is a real due-claim at least once per 5 minutes per warm
instance, so a lost flag write delays a plugin run by at most 5 minutes,
once, and can never silently stop a plugin.

Because blob WRITES are the scarce meter (2K/mo Advanced Operations on
Hobby), the tick flag is written in two modes rather than after every
run: a plugin due within 10 minutes writes the stable value 0 ("check
every tick") once, and the dedup suppresses the rest, however often the
plugin runs; a far-off next run writes the timestamp quantized to the
minute (floor, so checks resume up to 60s early). A World Cup day costs
one flag write; a morning-brief-only owner costs about two a day (the 0
before the run, the next day's time after it). Naively writing each
post-run nextDueAt would have burned ~1,440 puts/day at every:60s and
tripped Hobby's 30-day Blob lockout in under two days.

### Failed attempts (October 2026)

Each /nack counts one in a per-owner hash (rp:{owner}:jobs:attempts, one
HINCRBY); from the third the job waits at the back of the queue. The Queue
and History pages read the hash with one HGETALL (the Studio's recent-jobs
strip does not ask for attempts), and only when a listed job was ever
claimed, so an empty or untouched queue costs nothing extra;
a trim that deletes records sends one HDEL. While a job waits at the back,
each Queue read also sends one LRANGE for the queue's real order, so the
page lists the job where it will print. No other Queue read needs it.

### Device-path invocations

Vercel function invocations are separate: `/next` + `/tick` at 5s/30s are
20,160 a day, 604,800 per 30 days, against the 1M Hobby cap (about 950K
at the old 3s polls). The same requests count as CDN Requests. Print
latency worst case is 5s.

## Plugin scheduling (July 2026 redesign)

Plugins declare when they run; users edit it on the plugin's Slips page:

- `schedule: { every: seconds }` for watchers (World Cup checks ESPN each run)
- `schedule: { at: "HH:MM", timezone }` for fixed-time plugins (the daily brief)
- no schedule for a module that only takes pushed messages through
  `onMessage` (message-ingest), which never runs on a timer

The store layer derives a `nextDueAt` per plugin and keeps it in a sorted
due-index. An idle tick asks one question ("anything due?") via an atomic
claim that also leases what it returns, so concurrent ticks can't double-run
a plugin, and a crashed run is due again after 90s. Failures always fall
toward one late re-run, never a silently stopped plugin (plugins keep their
own idempotence guards, e.g. the brief's once-per-day check). A failed run
retries at the lease cadence, not its normal schedule. "At" schedules fire
on the first tick after the wall-clock time (~30s precision, tied to
TICK_MS). Schedule edits apply on Save (which recomputes the due time);
enabling a plugin reschedules it from now.

## Rules that keep costs proportional to activity

- **Nothing on the device cadence queries Postgres.** `/next` and an idle
  `/tick` read Blob flags, and Redis on a safety check. Postgres answers
  for a claimed job, a plugin run that prints, pairing, a device token the
  mirror does not hold, and human traffic. A device token not shaped like
  a minted one answers 401 with no read. An instance's token cache holds
  at most 1,000 tokens, known or unknown, and drops the oldest.
- **Unknown tokens have a read budget.** Each warm instance looks up at
  most 30 device tokens and 30 ingest tokens a minute that have never
  resolved on that instance (`lib/ops/identity.js`). Past that, device
  endpoints answer 503 with Retry-After and `/ingest` answers 429, with
  no Redis or Postgres read. A flood of random tokens then costs at most
  about 60 Redis GETs and 60 Postgres queries a minute per instance
  (each budget allows a mirror read and then a Postgres query), instead
  of one of each per request. A token that has resolved on the instance
  is never limited, even after its cache entry expires: the instance
  keeps up to 1,000 such token hashes per kind.
  A device this instance has not served yet (after a deploy or a cold
  start) gets 503 for as long as a flood keeps the budget spent, which
  can be longer than a minute. It never gets 401: the firmware keeps its
  token and retries every 15 seconds.
- **Pairing cleans up after itself.** Each new device row from `/pair`
  runs one DELETE of at most 100 rows that no account claimed, created
  over a day ago, with no live code (`lib/devices.js`). It runs only when
  a row is added, never on the device cadence.
- **Dashboard polls only while visible, and ease off when idle**: the
  Queue page (`/api/queue`) and the Studio's recent jobs (`/jobs`) poll
  only while `document.visibilityState` is visible, every 3s while the
  person is active, 30s after two idle minutes, not at all after thirty
  (`components/hooks/use-eased-poll.ts`). Hidden tabs cost zero; cost
  scales with people watching, not tabs open.
- **Device presence writes are throttled** (`lib/device-presence.js`, 60s).
  The dashboard's online rule is 90s, so the indicator stays correct.
- **`/tick` claims due plugins in one atomic command** and touches records
  only for plugins that actually run (see Plugin scheduling above).
- **Heavy payloads do not belong in records.** Job records are Postgres
  rows that hold artifact keys; the rendered PNG and ESC/POS bytes live in
  Blob. Input data over 32KB (photo prints) is offloaded to Blob at create
  time and re-inflated by getJob() for the debug view and Reprint. Before
  this fix, inline photo data (a full base64 JPEG inside the record,
  re-downloaded by every dashboard list read) caused a 356MB
  Redis-bandwidth day.

## Remaining reductions

- **World Cup plugin off-season**: disable it on its Slips page when the
  tournament ends; enabled, it keeps every tick on the claim path (about
  300K commands per 30 days). New accounts start with it off.
- **Reflash old devices**: the firmware has polled every 5s since
  2026-07-07 (commit 87a7d76). A device flashed before then still polls
  every 3s until it is reflashed (the server side needs nothing).

## Evaluated and rejected (keep with the reasons)

**Edge Config as the change-beacon transport (built July 2026, removed
before deploy).** Same flag design as the shipped queue flag, wrong meter:
Edge Config's Hobby allowance is 100K reads/mo and 100 writes/mo against
our ~520K reads/mo, roughly $4-5/mo in overage. The design itself was
right and shipped later the same week on Blob (see the queue and tick
flags above, including how Blob reads are priced). The transport turned
out to be a pricing decision, verified by probe, rather than an
architecture decision.

**Vercel Cron for fixed-time plugins.** Hour-level precision on Hobby
(a 06:30 job fires anywhere in the 6 o'clock hour), 2 crons max, and a
second clock to reason about. The scheduling redesign achieves 30-second
precision from the existing device tick instead.

**MQTT push to the device.** Eliminates polling entirely, but adds a
broker vendor, firmware rework, and reconnect handling, all for a latency
improvement (5s to instant) that nothing currently needs.
