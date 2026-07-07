// lib/schedule.js — plugin schedule math.
//
// A plugin schedule is one of:
//   { every: seconds }                    run repeatedly (watcher plugins)
//   { at: "HH:MM", timezone: "IANA" }     run once per day at a wall-clock time
//
// computeNextDueAt(schedule, fromMs) returns the epoch-ms of the next moment
// the plugin is due strictly after fromMs. The tick runner stores this in
// the due-index; "due" means nextDueAt <= now at some later tick, so actual
// run time is nextDueAt rounded up to the next device check-in (~30s).
//
// Missed-run policy (run late, once): the runner calls this with fromMs =
// now after every run. If the printer was off past a due time, the stale
// nextDueAt is simply in the past, the next tick runs the plugin once, and
// the schedule continues from now — never a backlog of catch-up runs.
//
// Timezone handling uses Intl only (no date libraries, per house style).
// DST edges: a wall time that doesn't exist on spring-forward day resolves
// to the shifted instant (e.g. 02:30 EST→EDT runs at 03:30); a wall time
// that occurs twice on fall-back day runs at its first occurrence.

const DAY_MS = 24 * 3600 * 1000;

// Offset between a timezone's wall clock and UTC at a given instant, in ms.
// (Wall-clock fields of `atMs` in `tz`, re-read as if they were UTC, minus
// the instant itself.)
function tzOffsetMs(tz, atMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(atMs);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const asUtc = Date.UTC(
    p.year, p.month - 1, p.day,
    p.hour === '24' ? 0 : parseInt(p.hour, 10), p.minute, p.second,
  );
  return asUtc - atMs;
}

// Wall-clock minutes-of-day of an instant in a timezone.
function wallMinutes(tz, atMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(atMs);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return (p.hour === '24' ? 0 : parseInt(p.hour, 10)) * 60 + parseInt(p.minute, 10);
}

// Next occurrence of HH:MM (wall clock in tz) strictly after fromMs.
function nextAtOccurrence(hh, mm, tz, fromMs) {
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const ref = fromMs + dayOffset * DAY_MS;
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(ref)) p[type] = value;
    const naiveUtc = Date.UTC(p.year, p.month - 1, p.day, hh, mm, 0);
    // The offset can differ between the reference and the candidate (DST).
    // Try the offset at the candidate; keep the correction only if it lands
    // on the requested wall time — a nonexistent time (spring-forward skip)
    // won't, and then the uncorrected candidate is the shifted-forward
    // instant (02:30 EST→EDT runs at 03:30), which is the behavior we want.
    const first = naiveUtc - tzOffsetMs(tz, ref);
    const corrected = naiveUtc - tzOffsetMs(tz, first);
    const candidate = wallMinutes(tz, corrected) === hh * 60 + mm ? corrected : first;
    if (candidate > fromMs) return candidate;
  }
  return null; // unreachable for valid inputs
}

// Returns epoch ms of the next due moment after fromMs, or null for a
// missing/invalid schedule (passive plugins have no schedule).
export function computeNextDueAt(schedule, fromMs = Date.now()) {
  if (!schedule || typeof schedule !== 'object') return null;
  if (schedule.every != null) {
    const s = Number(schedule.every);
    if (!Number.isFinite(s) || s < 1) return null;
    return fromMs + s * 1000;
  }
  if (schedule.at) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(schedule.at).trim());
    if (!m) return null;
    const tz = schedule.timezone || 'America/New_York';
    try {
      return nextAtOccurrence(parseInt(m[1], 10), parseInt(m[2], 10), tz, fromMs);
    } catch {
      return null; // invalid timezone
    }
  }
  return null;
}

// Validate + normalize a schedule edited on the dashboard.
// Returns { schedule } or { error }.
export function validateSchedule(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'schedule is required' };
  if (raw.every != null && raw.at) return { error: 'schedule is either "every" or "at", not both' };
  if (raw.every != null) {
    const s = Number(raw.every);
    if (!Number.isFinite(s) || s < 10) return { error: 'every must be at least 10 seconds' };
    return { schedule: { every: Math.round(s) } };
  }
  if (raw.at) {
    if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(raw.at).trim())) {
      return { error: 'at must be HH:MM (24-hour)' };
    }
    const timezone = String(raw.timezone || '').trim() || 'America/New_York';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return { error: `unknown timezone "${timezone}"` };
    }
    return { schedule: { at: String(raw.at).trim(), timezone } };
  }
  return { error: 'schedule needs "every" (seconds) or "at" (HH:MM)' };
}
