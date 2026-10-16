'use client';

// The settings of a plugin's slip, on its page (design spec: pages,
// Slips): two plates of the slip's body and one Save key.
// - 01 Schedule: the slip's switch row (its next run, or what makes it
//   print), the last run (red when it failed), then the time it prints
//   and the time zone of that time, or how often it checks. A slip that
//   prints when a message arrives has no schedule fields.
// - 02 Settings: one labelled field per config key. Lists edit one item
//   per line.
// The switch acts at once (SlipSwitch). The fields save together with
// the Save key that closes the last plate (POST /api/slips/config), which
// also works out the next run. Invalid input saves nothing and prints a
// red line beside the key, naming the field by its label.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Slip } from '@/app/_lib/slip-data';
import { Plate, PlateTitle } from '@/components/hardware/kit/body';
import { Note } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Row, Rows, RowText } from '@/components/hardware/kit/sheet';
import { SlipSwitch } from '@/components/slip-switch';
import { cn } from '@/components/utils';

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// lib/schedule.js validateSchedule's messages, named by the fields here
const SCHEDULE_ERRORS: [RegExp, string][] = [
  [/^schedule: every /, '"Check every" '],
  [
    /^schedule: at must be .*$/,
    '"Print time" must be a 24-hour time, such as 06:30',
  ],
  [
    /^schedule: unknown timezone (.*)$/,
    '"Print time zone": unknown time zone $1',
  ],
  [/^schedule: /, ''],
];

export function SlipSystemPanel({ slip }: { slip: Slip }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {
      sched_every: slip.scheduleEvery || '',
      sched_at: slip.scheduleAt || '',
      sched_tz: slip.scheduleTz || '',
    };
    for (const f of slip.fields || []) v[`cfg_${f.key}`] = f.value;
    return v;
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fields = slip.fields || [];

  const set = (key: string, value: string) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  };

  // The store names a bad value by its config key ("minConfidence must
  // be a number") or as a schedule part ("schedule: every must be at
  // least 10 seconds"); show the field's label instead.
  function plainError(message: string) {
    let text = message;
    for (const [from, to] of SCHEDULE_ERRORS) text = text.replace(from, to);
    for (const f of fields) {
      text = text.split(f.key).join(`"${sentence(f.label)}"`);
    }
    text = text.replace(/\s*\(not saved\)\s*$/, '').replace(/[.]?$/, '.');
    return `${sentence(text)} Not saved.`;
  }

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(
        `/api/slips/config?id=${encodeURIComponent(slip.slug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ? plainError(data.error) : 'Not saved. Try again.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('No connection. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const hasSchedule =
    slip.scheduleType === 'at' || slip.scheduleType === 'every';
  // the Save key closes the last plate that has fields
  const saveRow =
    hasSchedule || fields.length ? (
      <div className="sl-act sl-save">
        <span role="status" className={cn('pk-note', error && 'pk-note--red')}>
          {error || (saved ? 'Saved.' : '')}
        </span>
        <KeyWell label="Settings">
          <Key legend="Save" type="submit" disabled={saving} />
        </KeyWell>
      </div>
    ) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Plate seam as="section" aria-labelledby="slip-schedule">
        <h2 id="slip-schedule" className="sl-plate-name">
          <PlateTitle number="01">
            <span className="pk-engr">Schedule</span>
          </PlateTitle>
        </h2>
        <Rows>
          <Row>
            <RowText title="Prints" sub={slip.runLabel} />
            <SlipSwitch
              id={slip.slug}
              title={slip.title}
              enabled={!!slip.enabled}
            />
          </Row>
        </Rows>
        {slip.lastRunText ? (
          <Note
            tone={slip.lastRunRed ? 'red' : undefined}
            className="sl-lastrun"
          >
            {sentence(slip.lastRunText)}
          </Note>
        ) : null}
        {slip.scheduleType === 'at' ? (
          <div className="sl-fields">
            <Field
              label="Print time"
              className="sl-short"
              value={values.sched_at}
              onChange={(e) => set('sched_at', e.target.value)}
              placeholder="06:30"
              autoComplete="off"
            />
            {/* a zone name such as America/Argentina/Buenos_Aires is 30
                characters */}
            <Field
              label="Print time zone"
              value={values.sched_tz}
              onChange={(e) => set('sched_tz', e.target.value)}
              placeholder="Europe/London"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        {slip.scheduleType === 'every' ? (
          <div className="sl-fields">
            <Field
              label="Check every"
              hint="Seconds between checks."
              className="sl-short"
              value={values.sched_every}
              onChange={(e) => set('sched_every', e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        ) : null}
        {fields.length ? null : saveRow}
      </Plate>

      {fields.length ? (
        <Plate seam as="section" aria-labelledby="slip-settings">
          <h2 id="slip-settings" className="sl-plate-name">
            <PlateTitle number="02">
              <span className="pk-engr">Settings</span>
            </PlateTitle>
          </h2>
          <div className="sl-fields">
            {fields.map((f) =>
              f.multiline ? (
                <Field
                  key={f.key}
                  as="textarea"
                  className="sl-wide"
                  label={sentence(f.label)}
                  hint="One per line."
                  rows={Math.max(f.rows || 1, 3)}
                  value={values[`cfg_${f.key}`]}
                  onChange={(e) => set(`cfg_${f.key}`, e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <Field
                  key={f.key}
                  className={f.wide ? 'sl-wide' : undefined}
                  label={sentence(f.label)}
                  value={values[`cfg_${f.key}`]}
                  onChange={(e) => set(`cfg_${f.key}`, e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              ),
            )}
          </div>
          {saveRow}
        </Plate>
      ) : null}
    </form>
  );
}
