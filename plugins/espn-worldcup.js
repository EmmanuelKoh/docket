// plugins/espn-worldcup.js — watches live FIFA World Cup matches via ESPN and
// creates print jobs for kickoff, goals, and full-time.
//
// First entry of the plugin registry. One run() call = one poll cycle; the
// /tick endpoint decides when it is due. The detection logic (parseEvent,
// extractGoals, kickoff/goal/full-time triggers, count-based goal dedup,
// VAR handling) is ported as-is from the retired agent/espn-poller.js — it
// is live-tested; do not rewrite it.
//
// Contract: export id, defaults { intervalSeconds, config }, and
// async run({ config, state, ctx }) -> { state }. The world is reached only
// through ctx: createJob (job store, renders via render-core), getTemplate
// (template store, by name), and log.

export const id = 'espn-worldcup';

export const defaults = {
  intervalSeconds: 60,
  config: { watchTeams: [] }, // team abbreviations to filter; empty = all
};

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';

// ---- job creation ----

async function createJob(ctx, templateName, data) {
  const tpl = await ctx.getTemplate(templateName);
  if (!tpl) {
    ctx.log(`! template "${templateName}" not found`);
    return;
  }
  try {
    const result = await ctx.createJob({ template: tpl.template, data });
    ctx.log(`>> ${templateName}: ${result.id} (${JSON.stringify(data).slice(0, 80)})`);
  } catch (err) {
    ctx.log(`! job failed: ${err.message}`);
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
        goals.push({
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

function parseMinute(str) {
  const m = (str || '').match(/(\d+)(?:\+(\d+))?/);
  if (!m) return 999;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
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

// ---- one poll cycle ----

export async function run({ config, state, ctx }) {
  state = state || {};
  const watchTeams = (config?.watchTeams || [])
    .map(s => String(s).trim().toUpperCase())
    .filter(Boolean);

  let scoreboard;
  try {
    scoreboard = await fetchScoreboard();
  } catch (err) {
    ctx.log(`ESPN unreachable: ${err.message}`);
    return { state };
  }

  const events = (scoreboard.events || []).map(parseEvent).filter(Boolean);

  for (const ev of events) {
    // Filter by watchTeams if configured.
    if (watchTeams.length > 0) {
      if (!watchTeams.includes(ev.homeAbbrev) && !watchTeams.includes(ev.awayAbbrev)) {
        continue;
      }
    }

    // First encounter: snapshot current state, don't print anything.
    // Only changes detected on subsequent runs should trigger prints.
    if (!state[ev.id]) {
      state[ev.id] = {
        state: ev.state,
        homeScore: ev.homeScore,
        awayScore: ev.awayScore,
        kickoffPrinted: ev.state === 'in' || ev.state === 'post',
        fulltimePrinted: ev.state === 'post',
        printedHome: ev.homeScore,
        printedAway: ev.awayScore,
      };
      ctx.log(`${ev.homeAbbrev} v ${ev.awayAbbrev}: first seen [${ev.state}] ${ev.homeScore}-${ev.awayScore}, snapshotted`);
      continue;
    }

    const prev = state[ev.id];

    // Migrate from key-based to count-based goal dedup.
    if (prev.printedGoalKeys !== undefined) {
      prev.printedHome = prev.homeScore;
      prev.printedAway = prev.awayScore;
      delete prev.printedGoalKeys;
    }

    // ---- KICKOFF ----
    if (ev.state === 'in' && prev.state !== 'in' && !prev.kickoffPrinted) {
      await createJob(ctx, 'WC Kickoff', {
        home: ev.homeName,
        away: ev.awayName,
        competition: ev.competition,
        venue: ev.venue,
        kickoffTime: formatKickoffTime(ev.date),
      });
      prev.kickoffPrinted = true;
    }

    // ---- GOALS ----
    const homeDelta = ev.homeScore - prev.homeScore;
    const awayDelta = ev.awayScore - prev.awayScore;
    const scoreIncreased = homeDelta > 0 || awayDelta > 0;

    // VAR reversal — score went down: cap printed counts so a re-scored
    // goal later picks up details from the summary.
    if (ev.homeScore < prev.printedHome || ev.awayScore < prev.printedAway) {
      prev.printedHome = Math.min(prev.printedHome, ev.homeScore);
      prev.printedAway = Math.min(prev.printedAway, ev.awayScore);
    }

    if (scoreIncreased) {
      let homePrinted = 0;
      let awayPrinted = 0;

      // Try summary for detailed goal info.
      try {
        const summary = await fetchSummary(ev.id);
        if (summary) {
          const allGoals = extractGoals(summary);

          // Split goals by which team's score they contribute to.
          // OG by home player → away score increases (and vice versa).
          const homeScoreGoals = [];
          const awayScoreGoals = [];
          for (const g of allGoals) {
            const side = g.ownGoal
              ? (g.homeAway === 'home' ? 'away' : 'home')
              : g.homeAway;
            (side === 'home' ? homeScoreGoals : awayScoreGoals).push(g);
          }
          homeScoreGoals.sort((a, b) => parseMinute(a.minute) - parseMinute(b.minute));
          awayScoreGoals.sort((a, b) => parseMinute(a.minute) - parseMinute(b.minute));

          // Goals beyond what we've already printed are new.
          const newHome = homeScoreGoals.slice(prev.printedHome, prev.printedHome + homeDelta);
          const newAway = awayScoreGoals.slice(prev.printedAway, prev.printedAway + awayDelta);

          for (const g of [...newHome, ...newAway]) {
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
            await createJob(ctx, 'WC Goal', goalData);
          }

          homePrinted = newHome.length;
          awayPrinted = newAway.length;
        }
      } catch {
        // Summary failed — fall through to fallback.
      }

      // Fallback for any goals not covered by the summary.
      for (let i = 0; i < Math.max(0, homeDelta - homePrinted); i++) {
        await createJob(ctx, 'WC Goal', {
          scoringTeam: ev.homeName,
          home: ev.homeName,
          away: ev.awayName,
          homeScore: String(ev.homeScore),
          awayScore: String(ev.awayScore),
          scorer: '',
          minute: ev.displayClock || '',
        });
      }
      for (let i = 0; i < Math.max(0, awayDelta - awayPrinted); i++) {
        await createJob(ctx, 'WC Goal', {
          scoringTeam: ev.awayName,
          home: ev.homeName,
          away: ev.awayName,
          homeScore: String(ev.homeScore),
          awayScore: String(ev.awayScore),
          scorer: '',
          minute: ev.displayClock || '',
        });
      }

      prev.printedHome += homeDelta;
      prev.printedAway += awayDelta;
    }

    // ---- FULL-TIME ----
    if ((ev.state === 'post' || ev.completed) && prev.state === 'in' && !prev.fulltimePrinted) {
      let result;
      if (ev.homeScore > ev.awayScore) result = `${ev.homeName} win`;
      else if (ev.awayScore > ev.homeScore) result = `${ev.awayName} win`;
      else result = 'Draw';

      await createJob(ctx, 'WC Full Time', {
        home: ev.homeName,
        away: ev.awayName,
        homeScore: String(ev.homeScore),
        awayScore: String(ev.awayScore),
        result,
      });
      prev.fulltimePrinted = true;
    }

    // Update stored state for this event.
    prev.state = ev.state;
    prev.homeScore = ev.homeScore;
    prev.awayScore = ev.awayScore;
    state[ev.id] = prev;
  }

  return { state };
}
