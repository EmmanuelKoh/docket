'use client';

// The settings of a plugin's slip, on its page (design spec: pages,
// Slips). Two modules and one Save key:
// - Schedule: the slip's switch row (its next run, or what makes it
//   print), the last run (red when it failed), then the time it prints
//   and the time zone of that time, or how often it checks. A slip that prints when a
//   message arrives has no schedule fields.
// - Settings: one labelled field per config key. Lists edit one item per
//   line.
// The switch acts at once (SlipSwitch). The fields save together with
// one Save (POST /api/slips/config), which also works out the next run.
// Invalid input saves nothing and shows a red line under the key.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Slip } from '@/app/_lib/slip-data';
import { Field } from '@/components/hardware/field';
import { Module } from '@/components/hardware/module';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row, RowText } from '@/components/hardware/row';
import { ErrorText, Note } from '@/components/hardware/text';
import { SlipSwitch } from '@/components/slip-switch';
import { cn } from '@/components/utils';

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  // be a number"); show the field's label instead.
  function plainError(message: string) {
    let text = message;
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

  return (
    <form
      className="flex flex-col gap-[30px]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Module number="01" title="Schedule" flush>
        <Row tight off={!slip.enabled}>
          <RowText title={slip.title} sub={slip.runLabel} />
          <SlipSwitch
            id={slip.slug}
            title={slip.title}
            enabled={!!slip.enabled}
          />
        </Row>
        <div className="hw-module-body--padded flex flex-col">
          {slip.lastRunText ? (
            slip.lastRunRed ? (
              <ErrorText>{sentence(slip.lastRunText)}</ErrorText>
            ) : (
              <Note>{sentence(slip.lastRunText)}</Note>
            )
          ) : null}
          {slip.scheduleType === 'at' ? (
            <>
              <Field
                label="Print time"
                className="w-[132px]"
                value={values.sched_at}
                onChange={(e) => set('sched_at', e.target.value)}
                placeholder="06:30"
                autoComplete="off"
              />
              {/* full width: a zone name such as America/Argentina/Buenos_Aires
                  is 30 characters */}
              <Field
                label="Print time zone"
                value={values.sched_tz}
                onChange={(e) => set('sched_tz', e.target.value)}
                placeholder="Europe/London"
                autoComplete="off"
                spellCheck={false}
              />
            </>
          ) : null}
          {slip.scheduleType === 'every' ? (
            <Field
              label="Check every"
              hint="Seconds between checks."
              className="w-[180px]"
              value={values.sched_every}
              onChange={(e) => set('sched_every', e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          ) : null}
        </div>
      </Module>

      {fields.length ? (
        <Module number="02" title="Settings">
          {fields.map((f) =>
            f.multiline ? (
              <Field
                key={f.key}
                as="textarea"
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
                label={sentence(f.label)}
                value={values[`cfg_${f.key}`]}
                onChange={(e) => set(`cfg_${f.key}`, e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            ),
          )}
        </Module>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <span
          role="status"
          className={cn('hw-ink', error ? 'hw-error' : 'hw-note')}
        >
          {error || (saved ? 'Saved.' : '')}
        </span>
        <KeyGroup>
          <PushKey type="submit" disabled={saving}>
            Save
          </PushKey>
        </KeyGroup>
      </div>
    </form>
  );
}
