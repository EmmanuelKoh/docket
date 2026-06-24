// espn-poller.js — watches live FIFA World Cup matches via ESPN and creates
// print jobs for kickoff, goals, and full-time.
//
// Run alongside the server and printer agent:
//   node agent/espn-poller.js
//
// Env:
//   POLL_INTERVAL   seconds between polls  (default 30)
//   WATCH_TEAMS     comma-separated team abbreviations to filter (default: all)
//   PORT            server port             (default 3000)
//
// State is persisted to data/espn-state.json so nothing is reprinted across
// polls or restarts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { POLL_INTERVAL, WATCH_TEAMS } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'espn-state.json');
const WC_TEMPLATES_FILE = path.join(ROOT, 'reference', 'wc-templates.json');

const SERVER = process.env.PRINT_SERVER || `http://localhost:${process.env.PORT || 3000}`;
const POLL_MS = POLL_INTERVAL * 1000;

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';

// ---- templates ----

const wcTemplates = {};

function loadTemplates() {
  const tpls = JSON.parse(fs.readFileSync(WC_TEMPLATES_FILE, 'utf-8'));
  for (const t of tpls) wcTemplates[t.name] = t.template;
}

async function seedTemplates() {
  // Seed WC templates into the template store if they don't already exist.
  let existing = [];
  try {
    const resp = await fetch(`${SERVER}/templates`);
    existing = await resp.json();
  } catch { return; }

  const toSeed = JSON.parse(fs.readFileSync(WC_TEMPLATES_FILE, 'utf-8'));
  for (const t of toSeed) {
    if (existing.some(e => e.name === t.name)) continue;
    try {
      await fetch(`${SERVER}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      });
      console.log(`  seeded template "${t.name}"`);
    } catch {}
  }
}

// ---- state persistence ----

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---- job creation ----

async function createJob(templateName, data) {
  const template = wcTemplates[templateName];
  if (!template) {
    console.log(`  ! template "${templateName}" not found`);
    return;
  }
  try {
    const resp = await fetch(`${SERVER}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, data }),
    });
    const body = await resp.json();
    if (resp.ok) {
      console.log(`  >> ${templateName}: ${body.id} (${JSON.stringify(data).slice(0, 80)})`);
    } else {
      console.log(`  ! job failed: ${body.error}`);
    }
  } catch (err) {
    console.log(`  ! job post failed: ${err.message}`);
  }
}

// ---- ESPN API ----

async function fetchScoreboard() {
  const resp = await fetch(SCOREBOARD_URL);
  if (!resp.ok) throw new Error(`scoreboard ${resp.status}`);
  return resp.json();
}

async function fetchSummary(eventId) {
  const resp = await fetch(`${SUMMARY_URL}?event=${eventId}`);
  if (!resp.ok) return null;
  return resp.json();
}

// Extract goals from the summary response.
// Shape (confirmed against live data):
//   rosters[i].homeAway              "home" | "away"
//   rosters[i].team.abbreviation     team abbrev
//   rosters[i].roster[j].athlete.id             player ID
//   rosters[i].roster[j].athlete.displayName    scorer name
//   rosters[i].roster[j].plays[k].didScore      boolean (scorer only, not assists)
//   rosters[i].roster[j].plays[k].scoringPlay   boolean (scorer AND assister)
//   rosters[i].roster[j].plays[k].ownGoal       boolean
//   rosters[i].roster[j].plays[k].clock.displayValue   minute string e.g. "6'"
//
// scoringPlay is true for both the scorer and the assister.
// didScore is true only for the player who scored.
// Collect scorers (didScore) and assisters (scoringPlay && !didScore) separately,
// then match assisters to scorers by minute within the same team roster.
function extractGoals(summary) {
  const goals = [];
  try {
    for (const roster of (summary.rosters || [])) {
      const teamAbbrev = roster.team?.abbreviation || '???';
      const teamName = roster.team?.displayName || teamAbbrev;
      const homeAway = roster.homeAway;

      // First pass: collect scorers and assisters from this roster.
      const scorers = [];
      const assisters = []; // { minute, name }
      for (const player of (roster.roster || [])) {
        const athleteId = player.athlete?.id;
        const name = player.athlete?.displayName || 'Unknown';
        for (const play of (player.plays || [])) {
          const minute = play.clock?.displayValue || '';
          if (play.didScore) {
            scorers.push({
              athleteId, name, minute,
              ownGoal: !!play.ownGoal,
            });
          } else if (play.scoringPlay && !play.didScore) {
            assisters.push({ minute, name });
          }
        }
      }

      // Second pass: pair each scorer with an assister at the same minute.
      for (const s of scorers) {
        const assist = assisters.find(a => a.minute === s.minute);
        const key = `${s.athleteId}-${s.minute}`;
        goals.push({
          key,
          scorer: s.ownGoal ? `${s.name} (OG)` : s.name,
          assist: assist ? assist.name : '',
          minute: s.minute,
          teamAbbrev,
          teamName,
          homeAway,
          ownGoal: s.ownGoal,
        });
      }
    }
  } catch {
    // Shape didn't match — return whatever we found.
  }
  return goals;
}

// ---- event parsing ----

function parseEvent(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  return {
    id: event.id,
    state: event.status?.type?.state || comp.status?.type?.state || 'pre',
    completed: !!(event.status?.type?.completed || comp.status?.type?.completed),
    displayClock: event.status?.displayClock || comp.status?.displayClock || '',
    homeName: home.team?.displayName || 'Home',
    homeAbbrev: home.team?.abbreviation || '???',
    homeScore: parseInt(home.score, 10) || 0,
    awayName: away.team?.displayName || 'Away',
    awayAbbrev: away.team?.abbreviation || '???',
    awayScore: parseInt(away.score, 10) || 0,
    venue: comp.venue?.fullName || '',
    competition: comp.altGameNote || 'FIFA World Cup',
    date: event.date || '',
  };
}

function formatKickoffTime(isoDate) {
  try {
    return new Date(isoDate).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return isoDate;
  }
}

// ---- main poll logic ----

async function poll() {
  let scoreboard;
  try {
    scoreboard = await fetchScoreboard();
  } catch (err) {
    console.log(`  ESPN unreachable: ${err.message}`);
    return;
  }

  const events = (scoreboard.events || []).map(parseEvent).filter(Boolean);
  const state = readState();
  let stateChanged = false;

  for (const ev of events) {
    // Filter by WATCH_TEAMS if configured.
    if (WATCH_TEAMS.length > 0) {
      if (!WATCH_TEAMS.includes(ev.homeAbbrev) && !WATCH_TEAMS.includes(ev.awayAbbrev)) {
        continue;
      }
    }

    // First encounter: snapshot current state, don't print anything.
    // Only changes detected on subsequent polls should trigger prints.
    if (!state[ev.id]) {
      state[ev.id] = {
        state: ev.state,
        homeScore: ev.homeScore,
        awayScore: ev.awayScore,
        kickoffPrinted: ev.state === 'in' || ev.state === 'post',
        fulltimePrinted: ev.state === 'post',
        printedGoalKeys: [],
      };
      console.log(`  ${ev.homeAbbrev} v ${ev.awayAbbrev}: first seen [${ev.state}] ${ev.homeScore}-${ev.awayScore}, snapshotted`);
      stateChanged = true;
      continue;
    }

    const prev = state[ev.id];

    // ---- KICKOFF ----
    if (ev.state === 'in' && prev.state !== 'in' && !prev.kickoffPrinted) {
      await createJob('WC Kickoff', {
        home: ev.homeName,
        away: ev.awayName,
        competition: ev.competition,
        venue: ev.venue,
        kickoffTime: formatKickoffTime(ev.date),
      });
      prev.kickoffPrinted = true;
      stateChanged = true;
    }

    // ---- GOALS ----
    const homeDelta = ev.homeScore - prev.homeScore;
    const awayDelta = ev.awayScore - prev.awayScore;
    const scoreIncreased = homeDelta > 0 || awayDelta > 0;

    if (scoreIncreased) {
      // Try summary for detailed goal info.
      let detailedGoals = [];
      try {
        const summary = await fetchSummary(ev.id);
        if (summary) {
          const allGoals = extractGoals(summary);
          detailedGoals = allGoals.filter(g => !prev.printedGoalKeys.includes(g.key));
        }
      } catch {
        // Summary failed — fall back to score-diff.
      }

      if (detailedGoals.length > 0) {
        // Print each new detailed goal.
        for (const g of detailedGoals) {
          // For own goals, the scoring team is the OPPOSING team.
          let scoringTeam = g.teamName;
          if (g.ownGoal) {
            scoringTeam = g.homeAway === 'home' ? ev.awayName : ev.homeName;
          }
          const goalData = {
            scoringTeam,
            home: ev.homeName,
            away: ev.awayName,
            homeScore: String(ev.homeScore),
            awayScore: String(ev.awayScore),
            scorer: g.scorer,
            minute: g.minute,
          };
          if (g.assist) goalData.assist = g.assist;
          await createJob('WC Goal', goalData);
          prev.printedGoalKeys.push(g.key);
        }
      } else {
        // Fallback: score-diff goals (no scorer/minute).
        for (let i = 0; i < Math.max(0, homeDelta); i++) {
          const key = `diff-home-${ev.homeScore - homeDelta + i + 1}`;
          if (prev.printedGoalKeys.includes(key)) continue;
          await createJob('WC Goal', {
            scoringTeam: ev.homeName,
            home: ev.homeName,
            away: ev.awayName,
            homeScore: String(ev.homeScore),
            awayScore: String(ev.awayScore),
            scorer: '',
            minute: ev.displayClock || '',
          });
          prev.printedGoalKeys.push(key);
        }
        for (let i = 0; i < Math.max(0, awayDelta); i++) {
          const key = `diff-away-${ev.awayScore - awayDelta + i + 1}`;
          if (prev.printedGoalKeys.includes(key)) continue;
          await createJob('WC Goal', {
            scoringTeam: ev.awayName,
            home: ev.homeName,
            away: ev.awayName,
            homeScore: String(ev.homeScore),
            awayScore: String(ev.awayScore),
            scorer: '',
            minute: ev.displayClock || '',
          });
          prev.printedGoalKeys.push(key);
        }
      }
      stateChanged = true;
    }

    // Score going DOWN (VAR reversal): update state, print nothing.
    if (homeDelta < 0 || awayDelta < 0) {
      stateChanged = true;
    }

    // ---- FULL-TIME ----
    if ((ev.state === 'post' || ev.completed) && prev.state === 'in' && !prev.fulltimePrinted) {
      let result;
      if (ev.homeScore > ev.awayScore) result = `${ev.homeName} win`;
      else if (ev.awayScore > ev.homeScore) result = `${ev.awayName} win`;
      else result = 'Draw';

      await createJob('WC Full Time', {
        home: ev.homeName,
        away: ev.awayName,
        homeScore: String(ev.homeScore),
        awayScore: String(ev.awayScore),
        result,
      });
      prev.fulltimePrinted = true;
      stateChanged = true;
    }

    // Update stored state for this event.
    prev.state = ev.state;
    prev.homeScore = ev.homeScore;
    prev.awayScore = ev.awayScore;
    state[ev.id] = prev;
  }

  if (stateChanged) writeState(state);
}

// ---- boot ----

async function main() {
  loadTemplates();

  console.log(`ESPN World Cup poller`);
  console.log(`  server:   ${SERVER}`);
  console.log(`  interval: ${POLL_INTERVAL}s`);
  console.log(`  teams:    ${WATCH_TEAMS.length ? WATCH_TEAMS.join(', ') : 'all'}`);
  console.log(`  state:    ${STATE_FILE}`);
  console.log('');

  await seedTemplates();

  // First poll immediately.
  await poll();

  setInterval(async () => {
    try {
      await poll();
    } catch (err) {
      console.log(`  poll error: ${err.message}`);
    }
  }, POLL_MS);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
