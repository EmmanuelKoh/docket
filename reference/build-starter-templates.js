// build-starter-templates.js
// Converts the four tested designs into real Liquid templates (placeholders +
// loops + a conditional), renders each through the REAL render-core.js to prove
// they work, and writes starter-templates.json for the studio.

const fs = require('fs');
const { renderToEscpos } = require('./render-core');
const PHOTO = fs.readFileSync('photo.txt', 'utf8');

// ---------- 1. Morning brief ----------
const brief = {
  name: 'Morning Brief',
  template: `
<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #000;padding-bottom:8px">
    <div style="display:flex;font-size:46px;font-weight:700">{{ day }}</div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;font-family:Mono;font-size:18px">
      <div style="display:flex">{{ date }}</div>
      <div style="display:flex">{{ time }}</div>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:16px">
    {% for s in stats %}
    <div style="display:flex;flex-direction:column;align-items:center;flex:1">
      <div style="display:flex;font-size:40px;font-weight:700">{{ s.value }}</div>
      <div style="display:flex;font-size:15px">{{ s.label }}</div>
    </div>
    {% endfor %}
  </div>
  <div style="display:flex;background:#000;color:#fff;font-size:18px;font-weight:700;padding:4px 10px;margin-top:18px">SCHEDULE</div>
  {% for e in schedule %}
  <div style="display:flex;justify-content:space-between;font-family:Mono;font-size:20px;margin-top:6px">
    <div style="display:flex;width:90px">{{ e.at }}</div>
    <div style="display:flex;flex:1">{{ e.title }}</div>
    <div style="display:flex">{{ e.tag }}</div>
  </div>
  {% endfor %}
  <div style="display:flex;background:#888;padding:12px;margin-top:16px;font-size:22px;font-weight:700">FOCUS: {{ focus }}</div>
</div>`,
  data: {
    day: 'TUESDAY', date: 'Jun 17 2026', time: '06:30',
    stats: [{ value: '7', label: 'TASKS' }, { value: '3', label: 'MEETINGS' }, { value: '64°', label: 'RAIN PM' }],
    schedule: [
      { at: '09:00', title: 'Standup', tag: '15m' },
      { at: '13:00', title: 'Dentist', tag: '!' },
      { at: '18:30', title: 'Call mom', tag: '' },
    ],
    focus: 'ship the parser',
  },
};

// ---------- 2. Budget (loop + conditional badge) ----------
const budget = {
  name: 'Budget',
  template: `
<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;font-size:34px;font-weight:700">{{ title }}</div>
    {% if over %}<div style="display:flex;background:#000;color:#fff;font-size:16px;font-weight:700;padding:3px 10px;border-radius:12px">OVER</div>{% endif %}
  </div>
  <div style="display:flex;flex-direction:column;margin-top:14px">
    {% for row in rows %}
    <div style="display:flex;align-items:center;margin-top:6px">
      <div style="display:flex;width:120px;font-size:18px">{{ row.label }}</div>
      <div style="display:flex;flex:1;height:22px;background:#ddd">
        <div style="display:flex;width:{{ row.pct }}%;background:#000;height:22px"></div>
      </div>
      <div style="display:flex;width:90px;justify-content:flex-end;font-family:Mono;font-size:18px">{{ row.value }}</div>
    </div>
    {% endfor %}
  </div>
  <div style="display:flex;justify-content:space-between;border-top:3px solid #000;margin-top:16px;padding-top:8px">
    <div style="display:flex;font-size:24px;font-weight:700">TOTAL</div>
    <div style="display:flex;font-family:Mono;font-size:24px;font-weight:700">{{ total }}</div>
  </div>
</div>`,
  data: {
    title: 'June Budget', over: true, total: '$3,032',
    rows: [
      { label: 'Rent', pct: 95, value: '$1,800' },
      { label: 'Food', pct: 60, value: '$612' },
      { label: 'Transit', pct: 30, value: '$190' },
      { label: 'Fun', pct: 80, value: '$430' },
    ],
  },
};

// ---------- 3. Photo card ----------
const photo = {
  name: 'Photo Card',
  template: `
<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
  <div style="display:flex;font-size:30px;font-weight:700;margin-bottom:10px">{{ title }}</div>
  <div style="display:flex;flex-direction:column;border:3px solid #000;padding:10px">
    <img src="{{ photo }}" style="width:524px;height:300px" />
    <div style="display:flex;font-family:Mono;font-size:16px;margin-top:8px">{{ caption }}</div>
  </div>
  <div style="display:flex;font-size:18px;margin-top:12px">{{ body }}</div>
</div>`,
  data: {
    title: 'Photo of the Day',
    photo: PHOTO,
    caption: 'sunrise over the hills — 6:14 AM',
    body: 'A quiet start. Light rain expected after noon; bring a jacket if you head out.',
  },
};

// ---------- 4. Kanban ----------
const kanban = {
  name: 'Kanban',
  template: `
<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;font-size:30px;font-weight:700">{{ title }}</div>
    <div style="display:flex;background:#000;color:#fff;font-size:15px;font-weight:700;padding:4px 12px;border-radius:14px">{{ priority }}</div>
  </div>
  <div style="display:flex;align-items:center;margin-top:12px">
    <div style="display:flex;font-size:16px;width:90px">{{ percent }}% done</div>
    <div style="display:flex;flex:1;height:18px;background:#ddd">
      <div style="display:flex;width:{{ percent }}%;height:18px;background:#000"></div>
    </div>
  </div>
  <div style="display:flex;margin-top:14px">
    {% for col in columns %}
    <div style="display:flex;flex-direction:column;flex:1;margin:0 4px">
      <div style="display:flex;justify-content:center;background:#000;color:#fff;font-size:14px;font-weight:700;padding:3px">{{ col.name }}</div>
      {% for item in col.items %}
      <div style="display:flex;border:1px solid #000;padding:5px;margin-top:6px;font-size:14px">{{ item }}</div>
      {% endfor %}
    </div>
    {% endfor %}
  </div>
</div>`,
  data: {
    title: 'Sprint 14', priority: 'HIGH', percent: 62,
    columns: [
      { name: 'TODO', items: ['Auth flow', 'Rate limit'] },
      { name: 'DOING', items: ['Parser', 'Cache'] },
      { name: 'DONE', items: ['Schema', 'Login', 'CI'] },
    ],
  },
};

const templates = [brief, budget, photo, kanban];

(async () => {
  for (const t of templates) {
    try {
      const { preview, height } = await renderToEscpos(t.template, t.data);
      const file = `tmpl_${t.name.replace(/\s+/g, '_').toLowerCase()}.png`;
      fs.writeFileSync(file, preview);
      console.log(`OK    ${t.name}  -> ${file}  (${height}px)`);
    } catch (e) {
      console.log(`BREAK ${t.name}: ${e.message.split('\n')[0]}`);
    }
  }
  // strip the big photo data URI out of the saved JSON note (keep template usable)
  fs.writeFileSync('starter-templates.json', JSON.stringify(templates, null, 2));
  console.log('wrote starter-templates.json');
})();
