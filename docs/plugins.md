# Plugins

A plugin is the code behind a slip that prints on its own, on a schedule or
when a message arrives. DOCKET has three, listed in `plugins/index.js`.

## How plugins run

The printer's board calls DOCKET every 30 seconds. Each call (a tick) runs
the plugins that are due.

- Each plugin's slip page has an on/off switch, the schedule if it has
  one, and the settings. Save also works out the next run time.
- A new account gets its plugins, and their templates, the first time it
  opens the Slips page.
- A failed run shows its error (`lastError`) in red on the slip page, and
  runs again 90 seconds later.
- If the printer was off at a run time, the plugin runs once, late. Missed
  runs do not pile up.

## Morning brief (`morning-brief`)

Prints the Daily Brief receipt once each morning. The receipt has:

- today's meetings, from one or more calendar feeds (iCal addresses);
- the day's weather, from Open-Meteo, which needs no API key;
- a focus line.

The slip starts switched off. Fill in its settings on its slip page, then
switch it on.

| Setting | Key | What to enter |
|---|---|---|
| calendar feeds | `icsUrls` | One secret iCal address per calendar. In Google Calendar: Settings, the calendar, "Secret address in iCal format". Keep these addresses secret: anyone with one can read that calendar |
| latitude, longitude | `latitude`, `longitude` | The place for the forecast |
| timezone | `timezone` | The IANA time zone, for example `America/New_York`. It decides which day is "today" for the calendar |
| unit | `temperatureUnit` | `fahrenheit` (the default) or `celsius` |
| focus | `focus` | The text for the focus bar. Leave it empty to hide the bar |

The slip runs at 06:30 and prints once per local day. Change the time and
time zone on its slip page.

- If the printer was offline at print time, the brief prints late the same
  day. It never prints twice, and it never prints the day before's brief.
- It expands repeating events and skips all-day events. An event on two
  calendars prints once.
- If a calendar feed fails, the run fails, the error shows on the slip
  page, and the run tries again. It does not print a brief with missing
  meetings.
- If the weather fails, the brief prints a dash in place of that value.

## World Cup (`espn-worldcup`)

Watches live FIFA World Cup matches through the ESPN API, and prints a
receipt for three events. One `run()` checks the scoreboard once. By
default it runs every 60 seconds. The slip starts switched off for a new
account.

| Event | Template | Prints when |
|-------|----------|---------|
| Kickoff | [`WC Kickoff`](images/receipt-wc-kickoff.png) | The match state changes from `pre` to `in` |
| Goal | [`WC Goal`](images/receipt-wc-goal.png) | A team's score goes up |
| Full-time | [`WC Full Time`](images/receipt-wc-full-time.png) | The match state changes from `in` to `post` |

When a score goes up, the plugin gets the ESPN match summary for the scorer
and the minute. It reads goals from `summary.rosters[].roster[].plays[]`
where `scoringPlay` is true:

- the scorer is `player.athlete.displayName`;
- the minute is `play.clock.displayValue`;
- `play.ownGoal` marks an own goal.

If the summary call fails or shows no new goal, the receipt prints the
score without a scorer. The summary never stops a print.

The plugin keeps each match in its `state`: the ESPN match state, the
scores, which receipts printed, and how many goals printed for each team.
So nothing prints twice, across ticks or restarts. If a score goes down
(a goal taken back after a video review), the plugin updates its state and
prints nothing. The `watch teams` setting (`watchTeams`) limits it to the
listed team abbreviations. Empty means all teams.

## Text messages (`message-ingest`)

Forward text messages to `POST /ingest`, and DOCKET prints the tasks in
them on Task receipts. Gemini, Google's AI model, finds the tasks in each
message.

- Related items share one receipt as a list: a shopping list, or the steps
  of a routine. When Gemini finds that the order matters, the receipt numbers the steps.
- Unrelated tasks get one receipt each. "Get milk and eggs, and wish your
  dad happy birthday" prints a grocery list and a "Wish Dad happy
  birthday" task.
- Gemini writes the titles for you, the person who got the message. From
  Alice, "call me tonight" prints as "Call Alice tonight".
- Gemini turns phrases like "by friday" into due dates.
- A message that starts with `task:` always prints.

The plugin has no schedule. Its slip page has the on/off switch and these
settings:

| Setting | Key | What it does |
|---|---|---|
| min confidence | `minConfidence` | A message prints only when Gemini's confidence that it holds a task is at least this value. Default 0.6 |
| timezone | `timezone` | The time zone for the date and time on the receipt |
| gemini model | `geminiModel` | The Gemini model. Blank uses `GEMINI_MODEL` |
| ingest token | `ingestToken` | The token that a sender uses for `/ingest`. DOCKET makes it when the account first gets the slip |

### The `/ingest` request

Anything that can send JSON over HTTP can use `/ingest`.

- Token: the ingest token from the slip page, as an
  `Authorization: Bearer <token>` header or as `?token=<token>`. The token
  also picks the account.
- Body: `{ text, sender?, source?, receivedAt? }`. A `?` marks an optional
  field.

| Answer | When |
|---|---|
| 200 `{ task: true, printed, jobs }` | The message held tasks, and they printed |
| 200 `{ task: false, confidence }` | The message held no task, or the confidence was below `min confidence` |
| 200 `{ skipped: 'empty' }` | The text is blank |
| 200 `{ skipped: 'disabled' }` | The slip is switched off |
| 200 `{ duplicate: true }` | The same text, from the same sender and source, came in the last 15 minutes. Nothing prints |
| 400 | The body has no `text` |
| 401 | The token is wrong |
| 409 | DOCKET is still handling the first copy of the same message |
| 429 | Too many unknown tokens in one minute. Wait for the `Retry-After` time, then send again |
| 502 | Handling failed. The error shows on the slip page. Send the message again |

The Android app in `android-forwarder/` forwards text messages (SMS and
RCS) to `/ingest`. It reads them from the phone's message store, so it also
gets a message that arrives while its conversation is open. It sends
contact names in place of phone numbers, and it sends a failed message
again. See [android-forwarder/README.md](../android-forwarder/README.md).

## Write a plugin

A plugin is a module in `plugins/`, listed in `plugins/index.js`:

```js
export const id = 'my-plugin';
export const meta = { title: 'My plugin', description: '...', category: 'daily' };
// schedule: { every: seconds }, or { at: 'HH:MM', timezone: 'America/New_York' }.
// No schedule: the plugin never runs on the tick.
export const defaults = { enabled: false, schedule: { every: 60 }, config: {} };
export const templates = ['My Template'];      // seeded from reference/*-templates.json
export const configLabels = { someKey: 'label' };

// Scheduled: one unit of work per due tick.
export async function run({ config, state, ctx }) {
  return { state };
}
// Push: a message delivered to the module (see /ingest).
export async function onMessage(envelope, { config, state, ctx }) {
  return { state, reply: {} };
}
// Optional: config keys the runner mints as random credentials.
export const hooks = { credentials: [{ key: 'ingestToken', kind: 'token' }] };
```

A plugin has `run`, `onMessage`, or both. It reaches the world outside
DOCKET only through `ctx`. [architecture.md](architecture.md) ("Plugins")
has the contract, `ctx`, registration and ticks.
[CONTRIBUTING.md](../CONTRIBUTING.md) ("Add a plugin") has the steps.
