// plugins/morning-brief.js — prints the "Daily Brief" template once each
// morning: today's meetings merged from one or more calendar ICS feeds,
// the day's weather (Open-Meteo, no API key), and a focus line.
//
// Config (all editable from the Plugins page):
//   icsUrls    array of secret iCal addresses. Google Calendar: Settings →
//              [calendar] → "Secret address in iCal format" — one per
//              calendar (work, personal, family, ...). Treat as secrets.
//   latitude / longitude   coordinates for the weather forecast
//   timezone   IANA zone that defines "today" and printAt (e.g.
//              "America/Los_Angeles")
//   printAt    "HH:MM" local time after which the brief prints (default
//              06:30)
//   temperatureUnit  "fahrenheit" (default) or "celsius"
//   focus      focus line text; empty hides the focus bar
//
// State: { lastPrintedDate: "2026-Jul-03" } — one print per local day,
// fired on the first due tick at/after printAt. A late heartbeat prints
// late, same day; it never double-prints and never back-fills.
//
// Failure policy: if ANY calendar feed fails, the run throws — the tick
// runner records lastError (red on the plugin card) and retries at the
// next interval. A brief silently missing a calendar would lie on paper.
// Weather failure only degrades its stat to "—".

import ical from 'node-ical';

export const id = 'morning-brief';

export const defaults = {
  enabled: false, // enable from the dashboard once config is set
  intervalSeconds: 300,
  config: {
    icsUrls: [],
    latitude: null,
    longitude: null,
    timezone: 'America/New_York',
    printAt: '06:30',
    temperatureUnit: 'fahrenheit',
    focus: '',
  },
};

// Template-store templates this plugin prints with (shown in the dashboard).
export const templates = ['Daily Brief'];

// Friendly labels for the dashboard's per-field config editor.
export const configLabels = {
  icsUrls: 'calendar feeds',
  printAt: 'print at',
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

// ---- calendar ----

async function fetchFeed(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`calendar feed ${resp.status}`);
  const text = await resp.text();
  if (!text.trimStart().startsWith('BEGIN:VCALENDAR')) {
    // The most common misconfiguration: a calendar's share/browser link
    // instead of the "Secret address in iCal format".
    throw new Error('feed is not iCal data — use the calendar\'s "Secret address in iCal format"');
  }
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
        title: ev.summary || 'busy',
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

  if (state.lastPrintedDate === todayKey) return { state };
  if (hm < (cfg.printAt || '06:30')) return { state };

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

  const data = {
    day: p.weekday.toUpperCase(),
    date: `${p.month} ${parseInt(p.day, 10)} ${p.year}`,
    time: hm,
    stats,
    schedule: events.slice(0, 10).map(e => ({
      at: e.at,
      title: e.title.length > 32 ? e.title.slice(0, 31) + '…' : e.title,
      tag: fmtDuration(e.durMs),
    })),
    focus: cfg.focus || '',
  };

  const printed = await createJob(ctx, 'Daily Brief', data);
  if (printed) state.lastPrintedDate = todayKey;
  return { state };
}
