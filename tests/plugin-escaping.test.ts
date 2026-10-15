// tests/plugin-escaping.test.ts — text a plugin takes from outside the
// account reaches its template escaped (render/escape-html.js), as
// message-ingest does for texts (tests/ingest-escaping.test.ts). Anyone
// can invite the owner to a meeting, so the morning brief escapes calendar
// text; ESPN's feed names the teams and scorers the World Cup watcher
// prints. Markup in either prints as text: no element is made from it and
// the renderer fetches nothing. The reference templates output the values
// as they are, so nothing is escaped twice.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as espn from '@/plugins/espn-worldcup.js';
import * as brief from '@/plugins/morning-brief.js';
import { escapeHtml } from '@/render/escape-html.js';
import { imageDeps } from '@/render/image-guard.js';
import { fill, renderToEscpos, toElement } from '@/render/render-core.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/plugin-escaping`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

const IMG = '<img src="http://example.test/x">';

const reference = (file: string, name: string): string =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'reference', file), 'utf8'),
  ).find((t: { name: string }) => t.name === name).template;

type Job = { template: string; data: Record<string, unknown>; name: string };

// A ctx that records jobs and serves the reference templates.
function context(file: string) {
  const jobs: Job[] = [];
  const ctx = {
    getTemplate: async (name: string) => ({
      name,
      template: reference(file, name),
    }),
    createJob: async (job: Job) => {
      jobs.push(job);
      return { id: `job-${jobs.length}` };
    },
    log: () => {},
  };
  return { ctx, jobs };
}

// Every element type and text string in a Satori element tree.
type Node = { type?: string; props?: { children?: unknown } };
function walk(node: unknown, types: string[] = [], texts: string[] = []) {
  if (typeof node === 'string') texts.push(node);
  else if (Array.isArray(node)) for (const n of node) walk(n, types, texts);
  else if (node && typeof node === 'object') {
    const el = node as Node;
    if (el.type) types.push(el.type);
    walk(el.props?.children, types, texts);
  }
  return { types, texts };
}

// Network for the plugins: `routes` answers by URL prefix; anything else
// is recorded and fails.
const strays: string[] = [];
function network(routes: Record<string, () => Response>) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    const hit = Object.keys(routes).find((p) => url.startsWith(p));
    if (hit) return routes[hit]();
    strays.push(url);
    throw new Error('network access is disabled in tests');
  });
}

beforeEach(() => {
  strays.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Renders a job as it would print, checking that no element came from its
// data and that nothing was fetched. Returns the printed text.
async function printed(job: Job) {
  const { types, texts } = walk(toElement(await fill(job.template, job.data)));
  expect(types.filter((t) => t !== 'div')).toEqual([]);
  const { bytes } = await renderToEscpos(job.template, job.data);
  expect(bytes.length).toBeGreaterThan(0);
  expect(strays).toEqual([]);
  return texts;
}

describe('morning brief', () => {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//docket test//EN',
    'BEGIN:VEVENT',
    'UID:1@docket.test',
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${day}T120000Z`,
    `DTEND:${day}T130000Z`,
    `SUMMARY:${IMG}`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2@docket.test',
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${day}T140000Z`,
    `DTEND:${day}T143000Z`,
    "SUMMARY;LANGUAGE=en:Tom & Jerry's <b>sync</b>",
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  const config = {
    icsUrls: ['https://calendar.docket.test/a.ics'],
    latitude: 1,
    longitude: 2,
    timezone: 'UTC',
    temperatureUnit: 'celsius',
    focus: 'Ship <it> & rest',
  };

  async function runBrief() {
    // Feeds go through the image guard's pinned transport, not fetch.
    vi.spyOn(imageDeps, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    vi.spyOn(imageDeps, 'request').mockImplementation(async (url: URL) => {
      if (url.href.startsWith('https://calendar.docket.test/')) {
        return {
          status: 200,
          headers: { 'content-type': 'text/calendar' },
          body: Buffer.from(ICS),
        };
      }
      strays.push(url.href);
      throw new Error('network access is disabled in tests');
    });
    network({
      'https://api.open-meteo.com/': () =>
        Response.json({
          daily: {
            temperature_2m_max: [21.4],
            precipitation_probability_max: [30],
          },
        }),
    });
    const { ctx, jobs } = context('brief-templates.json');
    await brief.run({ config, state: {}, ctx: ctx as never });
    expect(jobs).toHaveLength(1);
    return jobs[0];
  }

  it('escapes event titles, truncated before escaping, and every other string', async () => {
    const job = await runBrief();
    const schedule = job.data.schedule as { title: string; at: string }[];
    // 33 characters: cut to 31 and an ellipsis, then escaped.
    expect(schedule.map((e) => e.title)).toEqual([
      escapeHtml(`${IMG.slice(0, 31)}…`),
      // SUMMARY with a parameter reaches node-ical as { params, val }.
      escapeHtml("Tom & Jerry's <b>sync</b>"),
    ]);
    expect(job.data.focus).toBe(escapeHtml(config.focus));
    expect(job.data.stats).toEqual([
      { value: '2', label: 'MEETINGS' },
      { value: '21°', label: 'RAIN 30%' },
    ]);
    for (const e of schedule) expect(e.title).not.toMatch(/[<>"']/);
  });

  it('prints the titles as text, with no element made from them and nothing fetched', async () => {
    const job = await runBrief();
    const texts = await printed(job);
    expect(texts).toContain(`${IMG.slice(0, 31)}…`);
    expect(texts).toContain("Tom & Jerry's <b>sync</b>");
    expect(texts).toContain('FOCUS: Ship <it> & rest');
  });
});

describe('World Cup watcher', () => {
  const HOME = `Home ${IMG}`;
  const AWAY = `<b>Away</b> & co`;
  const SCORER = IMG;

  const scoreboard = (state: string, homeScore: number) => ({
    events: [
      {
        id: '401',
        date: '2026-06-20T18:00Z',
        status: {
          type: { state, completed: false },
          displayClock: "12'",
        },
        competitions: [
          {
            competitors: [
              {
                homeAway: 'home',
                team: { displayName: HOME, abbreviation: 'AAA' },
                score: String(homeScore),
              },
              {
                homeAway: 'away',
                team: { displayName: AWAY, abbreviation: 'BBB' },
                score: '0',
              },
            ],
            venue: { fullName: `Stadium "${IMG}"` },
            altGameNote: `Group <A>`,
          },
        ],
      },
    ],
  });
  const summary = {
    rosters: [
      {
        homeAway: 'home',
        team: { abbreviation: 'AAA', displayName: HOME },
        roster: [
          {
            athlete: { id: 'p1', displayName: SCORER },
            plays: [
              {
                didScore: true,
                scoringPlay: true,
                clock: { displayValue: "12'" },
              },
            ],
          },
        ],
      },
    ],
  };

  async function runMatch() {
    const { ctx, jobs } = context('wc-templates.json');
    let board = scoreboard('pre', 0);
    network({
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard':
        () => Response.json(board),
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary':
        () => Response.json(summary),
    });
    const config = { watchTeams: [] };
    let { state } = await espn.run({ config, state: {}, ctx: ctx as never });
    board = scoreboard('in', 1); // kickoff and a goal since the last run
    ({ state } = await espn.run({ config, state, ctx: ctx as never }));
    return jobs;
  }

  it('escapes team, scorer, venue and competition names', async () => {
    const jobs = await runMatch();
    expect(jobs.map((j) => j.name)).toEqual(['WC Kickoff', 'WC Goal']);
    expect(jobs[0].data).toMatchObject({
      home: escapeHtml(HOME),
      away: escapeHtml(AWAY),
      venue: escapeHtml(`Stadium "${IMG}"`),
      competition: escapeHtml('Group <A>'),
    });
    expect(jobs[1].data).toMatchObject({
      scoringTeam: escapeHtml(HOME),
      home: escapeHtml(HOME),
      scorer: escapeHtml(SCORER),
      homeScore: '1',
      minute: '12&#39;',
    });
  });

  it('prints the names as text, with no element made from them and nothing fetched', async () => {
    const [kickoff, goal] = await runMatch();
    const kickoffTexts = await printed(kickoff);
    expect(kickoffTexts).toEqual(
      expect.arrayContaining([HOME, AWAY, `Stadium "${IMG}"`, 'Group <A>']),
    );
    const goalTexts = await printed(goal);
    expect(goalTexts.join(' ')).toContain(SCORER);
  });
});
