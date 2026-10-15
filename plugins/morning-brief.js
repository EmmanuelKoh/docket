// plugins/morning-brief.js — prints the "Daily Brief" template once each
// morning: today's meetings merged from one or more calendar ICS feeds,
// the day's weather (Open-Meteo, no API key), and a focus line.
//
// When it runs: the schedule ({ at: "06:30", timezone }) — the runner fires
// this plugin once per day at that wall-clock time (edit on its Slips
// page). run() no longer watches the clock itself.
//
// Config (all editable from its Slips page):
//   icsUrls    array of secret iCal addresses. Google Calendar: Settings →
//              [calendar] → "Secret address in iCal format" — one per
//              calendar (work, personal, family, ...). Treat as secrets.
//   latitude / longitude   coordinates for the weather forecast
//   timezone   IANA zone that defines "today" for the calendar (usually
//              matches the schedule's timezone)
//   temperatureUnit  "fahrenheit" (default) or "celsius"
//   focus      focus line text; empty hides the focus bar
//
// State: { lastPrintedDate: "2026-Jul-03" } — one print per local day.
// This guard stays even though the schedule fires once daily: a crashed
// run re-becomes due after its lease and re-runs, and the guard makes that
// re-run harmless. A printer offline at 06:30 prints late, same day; it
// never double-prints and never back-fills.
//
// Failure policy: if ANY calendar feed fails, the run throws — the tick
// runner records lastError (red on the plugin card) and retries at the
// next interval. A brief silently missing a calendar would lie on paper.
// Weather failure only degrades its stat to "—".
//
// node-ical loads inside fetchFeed, not at module load: plugins/index.js is
// imported by /ingest and the Slips pages, which never parse a calendar.
//
// The feed addresses are owner input, so they are fetched under the image
// guard's address rules (render/image-guard.js fetchPublic), not with a
// plain fetch: http or https on the default port, no user or password,
// every resolved address public (no loopback, private, link-local, CGNAT,
// multicast, unspecified, unique-local, mapped or translated address) and
// the connection pinned to those addresses, at most 3 redirects checked
// the same way, 10 seconds, 5 MB. webcal:// and webcals:// mean https://.
// A refused feed throws like a failed one, so it shows as lastError.
//
// Calendar text is outside input: anyone who can invite the owner to a
// meeting chooses its title. Every string the template gets is escaped
// (render/escape-html.js), so a title like "<img src=...>" prints as
// those characters. The Daily Brief template outputs them as they are,
// so nothing is escaped twice.

import { escapeHtml } from '../render/escape-html.js';
import { fetchPublic } from '../render/image-guard.js';

export const id = 'morning-brief';

// Card copy for the dashboard's Recipes pages.
export const meta = {
  title: 'Morning brief',
  description: 'A daily slip with your calendar, weather, and a focus line.',
  category: 'daily',
};

export const defaults = {
  enabled: false, // enable from the dashboard once config is set
  schedule: { at: '06:30', timezone: 'America/New_York' },
  config: {
    icsUrls: [],
    latitude: null,
    longitude: null,
    timezone: 'America/New_York',
    temperatureUnit: 'fahrenheit',
    focus: '',
  },
};

// Template-store templates this plugin prints with (shown in the dashboard).
export const templates = ['Daily Brief'];

// Friendly labels for the dashboard's per-field config editor.
export const configLabels = {
  icsUrls: 'calendar feeds',
  temperatureUnit: 'unit',
};

// ---- timezone helpers (Intl only, no deps) ----

function tzParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = t => parts.find(x => x.type === t)?.value || '';
  return {
    weekday: get('weekday'),
    month: get('month'),
    day: get('day'),
    year: get('year'),
    hour: get('hour') === '24' ? '00' : get('hour'),
    minute: get('minute'),
  };
}

const dateKey = p => `${p.year}-${p.month}-${p.day}`;

// node-ical gives a property with parameters (SUMMARY;LANGUAGE=en:...)
// as { params, val } instead of a string.
const icalText = v => (typeof v === 'string' ? v : typeof v?.val === 'string' ? v.val : '');

// ---- calendar ----

export const FEED_LIMITS = { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024 };

// The URL a feed address is fetched from: webcal:// and webcals:// are
// https://. Throws when it is not a URL.
export function feedUrl(address) {
  const s = String(address).trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    return new URL(s);
  } catch {
    throw new Error('calendar feed address is not a URL');
  }
}

async function fetchFeed(address) {
  const url = feedUrl(address);
  let res;
  try {
    res = await fetchPublic(url, {
      schemes: ['https:', 'http:'],
      ...FEED_LIMITS,
      headers: { accept: 'text/calendar, */*;q=0.5', 'user-agent': 'docket' },
    });
  } catch (err) {
    // Same message as before the guard for an answer that is not 200.
    if (err.status) throw new Error(`calendar feed ${err.status}`);
    throw new Error(`calendar feed: ${err.message}`);
  }
  const text = res.body.toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trimStart().startsWith('BEGIN:VCALENDAR')) {
    // The most common misconfiguration: a calendar's share/browser link
    // instead of the "Secret address in iCal format".
    throw new Error('feed is not iCal data — use the calendar\'s "Secret address in iCal format"');
  }
  const { default: ical } = await import('node-ical');
  return ical.async.parseICS(text);
}

// Timed events occurring "today" in the given timezone. All-day items are
// ignored (they aren't meetings). Recurring events are expanded via rrule
// with best-effort exdate/override handling.
function todaysTimedEvents(parsed, tz, now, todayKey) {
  const out = [];
  const winStart = new Date(now.getTime() - 48 * 3600 * 1000);
  const winEnd = new Date(now.getTime() + 48 * 3600 * 1000);

  for (const k of Object.keys(parsed)) {
    const ev = parsed[k];
    if (!ev || ev.type !== 'VEVENT') continue;
    if (ev.datetype === 'date') continue; // all-day
    const durMs = ev.end && ev.start ? new Date(ev.end) - new Date(ev.start) : 0;

    const consider = start => {
      const p = tzParts(start, tz);
      if (dateKey(p) !== todayKey) return;
      out.push({
        start: new Date(start),
        at: `${p.hour}:${p.minute}`,
        title: icalText(ev.summary) || 'busy',
        durMs,
      });
    };

    if (ev.rrule) {
      const exdates = new Set(Object.keys(ev.exdate || {}).map(d => d.slice(0, 10)));
      for (const d of ev.rrule.between(winStart, winEnd, true)) {
        const dayStr = d.toISOString().slice(0, 10);
        if (exdates.has(dayStr)) continue;
        const override = ev.recurrences && ev.recurrences[dayStr];
        consider(override ? override.start : d);
      }
    } else {
      consider(ev.start);
    }
  }
  return out;
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return '';
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`;
}

// ---- weather ----

async function fetchWeather(lat, lon, tz, unit) {
  // tolerate string coords and pasted Google-Maps fragments ("-71.15,17")
  lat = parseFloat(lat);
  lon = parseFloat(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,precipitation_probability_max&forecast_days=1` +
    `&temperature_unit=${unit === 'celsius' ? 'celsius' : 'fahrenheit'}` +
    `&timezone=${encodeURIComponent(tz)}`;
  const resp = await fetch(u);
  if (!resp.ok) return null;
  const j = await resp.json();
  const tmax = j.daily?.temperature_2m_max?.[0];
  if (tmax == null) return null;
  return { tmax, rain: j.daily?.precipitation_probability_max?.[0] ?? 0 };
}

// ---- job creation ----

async function createJob(ctx, templateName, data) {
  const tpl = await ctx.getTemplate(templateName);
  if (!tpl) {
    ctx.log(`! template "${templateName}" not found`);
    return false;
  }
  try {
    const result = await ctx.createJob({ template: tpl.template, data, name: templateName });
    ctx.log(`>> ${templateName}: ${result.id}`);
    return true;
  } catch (err) {
    ctx.log(`! job failed: ${err.message}`);
    return false;
  }
}

// ---- one cycle ----

export async function run({ config, state, ctx }) {
  state = state || {};
  const cfg = { ...defaults.config, ...(config || {}) };
  const urls = (cfg.icsUrls || []).filter(Boolean);
  if (!urls.length) {
    ctx.log('not configured — set config.icsUrls to your calendar\'s secret iCal address(es)');
    return { state };
  }

  const tz = cfg.timezone || defaults.config.timezone;
  const now = new Date();
  const p = tzParts(now, tz);
  const todayKey = dateKey(p);
  const hm = `${p.hour}:${p.minute}`;

  // Once per local day — makes a crash-recovery re-run harmless.
  if (state.lastPrintedDate === todayKey) return { state };

  // All feeds must succeed — throws surface as lastError and retry next tick.
  const feeds = await Promise.all(urls.map(fetchFeed));

  let events = [];
  for (const feed of feeds) events = events.concat(todaysTimedEvents(feed, tz, now, todayKey));
  // Same event can appear on multiple calendars — dedup by time + title.
  const seen = new Set();
  events = events
    .filter(e => {
      const key = `${e.at}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);

  const stats = [{ value: String(events.length), label: 'MEETINGS' }];
  const weather = await fetchWeather(cfg.latitude, cfg.longitude, tz, cfg.temperatureUnit)
    .catch(() => null);
  stats.push(weather
    ? { value: `${Math.round(weather.tmax)}°`, label: `RAIN ${Math.round(weather.rain)}%` }
    : { value: '—', label: 'WEATHER' });

  // Truncate first, then escape, so the cut never splits an entity.
  const data = {
    day: escapeHtml(p.weekday.toUpperCase()),
    date: escapeHtml(`${p.month} ${parseInt(p.day, 10)} ${p.year}`),
    time: escapeHtml(hm),
    stats: stats.map(s => ({ value: escapeHtml(s.value), label: escapeHtml(s.label) })),
    schedule: events.slice(0, 10).map(e => ({
      at: escapeHtml(e.at),
      title: escapeHtml(e.title.length > 32 ? e.title.slice(0, 31) + '…' : e.title),
      tag: escapeHtml(fmtDuration(e.durMs)),
    })),
    focus: escapeHtml(cfg.focus || ''),
  };

  const printed = await createJob(ctx, 'Daily Brief', data);
  if (printed) state.lastPrintedDate = todayKey;
  return { state };
}
