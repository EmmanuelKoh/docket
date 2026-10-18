// Seeds a fresh sandbox through the app's own HTTP routes, the way the
// dashboard and a printer would: plugin templates (a Slips visit), a saved
// template, a paired printer, printed jobs from the Studio, a slip and a
// text message, one canceled job, one reprint, and two invites. Returns
// the session cookie, the printer's device token, the ingest token and
// the open invite's token.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const GROCERY = {
  name: 'Grocery List',
  template: `<div style="display:flex;flex-direction:column;width:576px;padding:24px;font-family:'Mono';color:#000;">
  <div style="display:flex;justify-content:space-between;font-size:30px;font-weight:700;">
    <span>GROCERIES</span><span>{{ date }}</span>
  </div>
  <div style="display:flex;border-top:3px solid #000;margin-top:12px;margin-bottom:12px;"></div>
  {% for item in items %}
  <div style="display:flex;justify-content:space-between;font-size:26px;margin-bottom:8px;">
    <span>[ ] {{ item.name }}</span><span>{{ item.qty }}</span>
  </div>
  {% endfor %}
  <div style="display:flex;border-top:2px dashed #000;margin-top:12px;padding-top:10px;font-size:22px;">
    <span>{{ items.size }} items · {{ store }}</span>
  </div>
</div>`,
  data: {
    date: 'Oct 14',
    store: 'Corner market',
    items: [
      { name: 'Oat milk', qty: '2' },
      { name: 'Eggs', qty: '12' },
      { name: 'Sourdough', qty: '1' },
      { name: 'Apples', qty: '6' },
      { name: 'Coffee beans', qty: '1 bag' },
    ],
  },
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function seed(state, log = console.log) {
  const BASE = state.base;
  let cookie = '';
  async function req(method, p, { body, headers = {}, auth = true, raw = false } = {}) {
    const h = { Origin: BASE, ...headers };
    if (auth && cookie) h.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(`${BASE}${p}`, { method, headers: h, body: payload, redirect: 'manual' });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length && auth) {
      const jar = new Map(
        cookie
          .split('; ')
          .filter(Boolean)
          .map((c) => [c.split('=')[0], c]),
      );
      for (const c of set) {
        const kv = c.split(';')[0];
        jar.set(kv.split('=')[0], kv);
      }
      cookie = [...jar.values()].join('; ');
    }
    if (raw) return r;
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (r.status >= 400) log(`  ${method} ${p}: ${r.status} ${text.slice(0, 160)}`);
    return { status: r.status, text, json };
  }

  await req('POST', '/api/auth/sign-in/email', {
    body: { email: state.email, password: state.password },
  });
  const userId = (await req('GET', '/api/auth/get-session')).json?.user?.id;
  if (!userId) throw new Error('seed: sign in failed');

  // A Slips visit registers the plugins and seeds their templates.
  await req('GET', '/slips');
  await req('GET', '/slips/espn-worldcup');
  await req('POST', '/templates', { body: GROCERY });
  const listed = (await req('GET', '/templates')).json;
  const byName = Object.fromEntries(
    (Array.isArray(listed) ? listed : listed?.templates || []).map((t) => [t.name, t]),
  );
  async function print(name) {
    const t = byName[name];
    if (!t) return null;
    const r = await req('POST', '/jobs', {
      body: { template: t.template, data: t.data, name, source: 'studio' },
    });
    await pause(1100); // distinct timestamps, so the order is stable
    return r.json?.id || r.json?.job?.id || null;
  }

  // Pair a printer: /pair prints a code, the Printer page claims it, the
  // device collects its token.
  const hw = `esp32-${crypto.randomBytes(3).toString('hex')}`;
  const code = (await req('POST', '/pair', { body: { hardwareId: hw }, auth: false })).json?.code;
  await req('POST', '/api/devices', { body: { code, name: 'Kitchen printer' } });
  const deviceToken = (
    await req('POST', '/pair', { body: { hardwareId: hw, code }, auth: false })
  ).json?.token;
  if (!deviceToken) throw new Error('seed: pairing failed');
  const device = { Authorization: `Bearer ${deviceToken}` };
  async function printAll() {
    for (let i = 0; i < 20; i++) {
      const r = await req('GET', '/next', { headers: device, auth: false, raw: true });
      await r.arrayBuffer();
      const id = r.status === 200 ? r.headers.get('x-job-id') : null;
      if (!id) return;
      await req('POST', `/ack?job=${encodeURIComponent(id)}`, { headers: device, auth: false });
    }
  }

  await print('Budget');
  await print('Kanban');
  await print('Morning Brief');
  await req('POST', '/api/slips/print-test?slug=espn-worldcup');
  await pause(1100);

  // A text message, through /ingest with the token minted on the Slips visit.
  const plugins = JSON.parse(fs.readFileSync(path.join(state.store, 'plugins.json'), 'utf8'));
  const ingestToken = plugins.find((r) => r.ownerId === userId && r.id === 'message-ingest')
    ?.config?.ingestToken;
  await req('POST', '/ingest', {
    body: { text: 'task: call the plumber about the kitchen sink', sender: 'Alex', source: 'sms' },
    auth: false,
    headers: { Authorization: `Bearer ${ingestToken}` },
  });
  await pause(1100);
  await print('Grocery List');
  await printAll();

  const canceled = await print('Photo Card');
  await req('POST', `/api/jobs/cancel?job=${encodeURIComponent(canceled || '')}`);
  const rows = (await req('GET', '/jobs?limit=50')).json || [];
  const budget = rows.find((j) => j.name === 'Budget');
  await req('POST', `/api/jobs/reprint?job=${encodeURIComponent(budget?.id || '')}`);
  await printAll();

  await req('POST', '/api/users/invites', { body: { email: 'jordan@example.test' } });
  const inviteToken = (await req('POST', '/api/users/invites', { body: {} })).json?.token;

  // Two jobs left waiting: the stand-in printer prints them unless --hold.
  await print('Kanban');
  await print('Daily Brief');

  return { userId, cookie, deviceToken, ingestToken, inviteToken };
}
