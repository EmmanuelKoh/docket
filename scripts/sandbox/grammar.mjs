// npm run sandbox:grammar: checks every page of the running sandbox
// against the page grammar (docs/design-spec.md), at desktop and phone
// width. Exits 1 if a page breaks a rule.
//
//   body   one machine body in the content column
//   name   the engraved page name (or the DOCKET mark signed out) near the
//          body's top, at its left
//   lamp   an LED right of the name, on its row, in the body's right half
//          (signed-out pages have no printer and skip it)
//   print  a red print key is the last key in its well, one per well
//   wells  full-size key wells, and whether the last one sits at the
//          body's foot (reported, not enforced: some tools carry two)

import { readState, signedInPage } from './lib.mjs';

const state = readState();
const ROUTES = [
  '/',
  '/studio',
  '/photo',
  '/history',
  '/slips',
  '/slips/espn-worldcup',
  '/slips/message-ingest',
  '/printer',
  '/queue',
  '/users',
  '/tape',
  { route: '/login', signedIn: false },
  ...(state.inviteToken ? [{ route: `/invite/${state.inviteToken}`, signedIn: false }] : []),
];
const WIDTHS = [1440, 390];

function measure(signedIn) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
  };
  const root = document.querySelector('main') || document.body;
  const bodies = [...root.querySelectorAll('.pk-body')].filter(
    (b) => visible(b) && !b.parentElement.closest('.pk-body'),
  );
  const first = bodies[0];
  const res = { body: bodies.length, name: false, lamp: !signedIn, print: true, wells: 0, foot: '-' };
  const name = first ? [...first.querySelectorAll('.pk-name, .pk-mark')].find(visible) : null;
  if (name) {
    const b = first.getBoundingClientRect();
    const n = name.getBoundingClientRect();
    res.name = n.left - b.left < b.width * 0.25 && n.top - b.top < 160;
    const leds = [...first.querySelectorAll('.pk-led')].filter(visible);
    res.lamp ||= leds.some((led) => {
      const l = led.getBoundingClientRect();
      const row = Math.abs(l.top + l.height / 2 - (n.top + n.height / 2)) < 18;
      return row && l.left > n.right && l.left > b.left + b.width / 2;
    });
  }
  for (const well of root.querySelectorAll('.pk-keys')) {
    if (!visible(well)) continue;
    const keys = [...well.querySelectorAll('.pk-key')].filter(visible);
    const prints = keys.filter((k) => k.classList.contains('pk-key--print'));
    if (prints.length > 1 || (prints[0] && keys.at(-1) !== prints[0])) res.print = false;
  }
  if (first) {
    const full = [...first.querySelectorAll('.pk-keys:not(.pk-keys--compact)')].filter(visible);
    res.wells = full.length;
    if (full.length) {
      const b = first.getBoundingClientRect();
      const w = full.at(-1).getBoundingClientRect();
      res.foot = b.bottom - w.bottom < 120 ? 'yes' : 'no';
    }
  }
  return res;
}

const rows = [];
let failed = false;
for (const width of WIDTHS) {
  const sessions = {};
  for (const entry of ROUTES) {
    const { route, signedIn = true } = typeof entry === 'string' ? { route: entry } : entry;
    const key = String(signedIn);
    sessions[key] ??= await signedInPage(state, { width, height: 900, dpr: 1, signedIn });
    const { page, errors } = sessions[key];
    errors.length = 0;
    await page.goto(state.base + route, { waitUntil: 'networkidle', timeout: 120_000 });
    const r = await page.evaluate(measure, signedIn);
    const bad = r.body !== 1 || !r.name || !r.lamp || !r.print;
    if (bad) failed = true;
    rows.push({
      route,
      width,
      body: r.body,
      name: r.name ? 'ok' : 'FAIL',
      lamp: r.lamp ? 'ok' : 'FAIL',
      print: r.print ? 'ok' : 'FAIL',
      wells: r.wells,
      foot: r.foot,
      errors: errors.length,
    });
  }
  for (const s of Object.values(sessions)) await s.browser.close();
}
console.table(rows);
process.exit(failed ? 1 : 0);
