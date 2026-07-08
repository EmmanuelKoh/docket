// One-off builder for reference/task-templates.json — keeps the escaped
// JSON honest. Run: node scripts/build-task-template.mjs
import fs from 'node:fs';

const template = `<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #000;padding-bottom:8px">
    <div style="display:flex;font-size:46px;font-weight:700">TASK</div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;font-family:Mono;font-size:18px">
      <div style="display:flex">{{ date }}</div>
      <div style="display:flex">{{ time }}</div>
    </div>
  </div>
  {% if items and items.size > 0 %}
  <div style="display:flex;font-size:30px;font-weight:700;line-height:1.15;margin-top:18px">{{ title }}</div>
  <div style="display:flex;flex-direction:column;margin-top:12px">
    {% for item in items %}
    <div style="display:flex;flex-direction:row;align-items:flex-start;margin-top:10px">
      {% if ordered %}
      <div style="display:flex;font-family:Mono;font-size:24px;font-weight:700;width:40px">{{ forloop.index }}.</div>
      {% else %}
      <div style="display:flex;width:24px;height:24px;border:3px solid #000;margin-top:3px;margin-right:14px"></div>
      {% endif %}
      <div style="display:flex;flex:1;font-size:24px;line-height:1.2">{{ item }}</div>
    </div>
    {% endfor %}
  </div>
  {% else %}
  <div style="display:flex;flex-direction:row;align-items:flex-start;margin-top:18px">
    <div style="display:flex;width:26px;height:26px;border:3px solid #000;margin-top:5px"></div>
    <div style="display:flex;flex:1;font-size:30px;font-weight:700;line-height:1.15;margin-left:14px">{{ title }}</div>
  </div>
  {% endif %}
  <div style="display:flex;flex-direction:column;font-family:Mono;font-size:20px;margin-top:16px">
    <div style="display:flex;justify-content:space-between;margin-top:4px">
      <div style="display:flex">FROM</div>
      <div style="display:flex">{{ sender }}</div>
    </div>
    {% if due != "" %}
    <div style="display:flex;justify-content:space-between;margin-top:4px">
      <div style="display:flex">DUE</div>
      <div style="display:flex;font-weight:700">{{ due }}</div>
    </div>
    {% endif %}
  </div>
  {% if priority == "high" %}
  <div style="display:flex;background:#000;color:#fff;font-size:18px;font-weight:700;padding:4px 10px;margin-top:14px">PRIORITY HIGH</div>
  {% endif %}
  {% if quote != "" %}
  <div style="display:flex;border-left:4px solid #000;padding-left:12px;margin-top:16px;font-size:20px;color:#222">“{{ quote }}”</div>
  {% endif %}
</div>`;

const out = [
  {
    name: 'Task',
    template,
    data: {
      title: 'Before leaving',
      items: ['Take out the trash', 'Turn off the devices', 'Lock the doors'],
      ordered: false,
      sender: 'Alice',
      date: 'Jul 8 2026',
      time: '17:30',
      due: '',
      priority: 'normal',
      quote: 'before you leave remember to do these things',
    },
  },
];

fs.writeFileSync(
  'reference/task-templates.json',
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log('wrote reference/task-templates.json');
