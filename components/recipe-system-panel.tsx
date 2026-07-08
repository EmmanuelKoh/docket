'use client';

// The interactive panel of a system recipe's page: enable toggle (the
// click is the action, no Save) and the PARAMETERS card, which follows
// the plugin-card grammar: schedule row first (its shape fixed by the
// plugin's kind), read-only next-run line, per-field config editing in a
// label/value grid, template names last, and ONE explicit Save button
// that updates record, next-due time and due-index together. Invalid
// input shows a red inline error and saves nothing.

import { useState } from 'react';
import type { Recipe } from '@/app/_lib/recipe-data';
import { Button } from '@/components/ui/button';

const inputCls =
  'w-full border-0 border-b border-dotted border-ink-faint bg-transparent ' +
  'font-mono text-[12.5px] text-ink outline-none focus:border-ink';

export function RecipeSystemPanel({ initial }: { initial: Recipe }) {
  const [recipe, setRecipe] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {
      sched_every: initial.scheduleEvery || '',
      sched_at: initial.scheduleAt || '',
      sched_tz: initial.scheduleTz || '',
    };
    for (const f of initial.fields || []) v[`cfg_${f.key}`] = f.value;
    return v;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key: string, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function toggle() {
    try {
      const res = await fetch(
        `/api/recipes/toggle?id=${encodeURIComponent(recipe.slug)}`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (res.ok && data.recipe) setRecipe(data.recipe);
    } catch {
      // leave state as is
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(
        `/api/recipes/config?id=${encodeURIComponent(recipe.slug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const data = await res.json();
      if (!res.ok) setError(data.error || 'save failed');
      else if (data.recipe) setRecipe(data.recipe);
    } catch {
      setError('save failed');
    } finally {
      setSaving(false);
    }
  }

  const dim = recipe.enabled ? '' : 'opacity-70';

  return (
    <div className="space-y-3">
      {/* status row: toggle, chip, last run */}
      <div className="flex items-center gap-3 rounded-md border-[0.5px] border-border bg-raised px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={recipe.enabled ? 'Disable' : 'Enable'}
          className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors ${recipe.enabled ? 'bg-ink' : 'bg-border'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-raised transition-all ${recipe.enabled ? 'left-[16px] bg-page' : 'left-0.5'}`}
          />
        </button>
        <span
          className={`rounded-[4px] border-[0.5px] border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] ${recipe.enabled ? 'text-ink-muted' : 'text-ink-faint'}`}
        >
          {recipe.enabled ? 'enabled' : 'off'}
        </span>
        <span
          className={`ml-auto truncate font-mono text-xs ${recipe.lastRunRed ? 'text-red' : 'text-ink-faint'}`}
        >
          {recipe.lastRunText}
        </span>
      </div>

      {/* parameters */}
      <div
        className={`rounded-md border-[0.5px] border-border bg-raised px-4 py-4 ${dim}`}
      >
        <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
          Parameters
        </div>
        <div className="mt-3 space-y-3">
          {recipe.scheduleType === 'every' ? (
            <Row label="schedule">
              <span className="flex items-baseline gap-1 font-mono text-[12.5px] text-ink">
                every
                <input
                  className={`${inputCls} w-16 text-right`}
                  value={values.sched_every}
                  onChange={(e) => set('sched_every', e.target.value)}
                  inputMode="numeric"
                />
                s
              </span>
            </Row>
          ) : null}
          {recipe.scheduleType === 'at' ? (
            <Row label="schedule">
              <span className="flex items-baseline gap-1 font-mono text-[12.5px] text-ink">
                at
                <input
                  className={`${inputCls} w-16`}
                  value={values.sched_at}
                  onChange={(e) => set('sched_at', e.target.value)}
                  placeholder="HH:MM"
                />
                <input
                  className={`${inputCls} w-40`}
                  value={values.sched_tz}
                  onChange={(e) => set('sched_tz', e.target.value)}
                  placeholder="timezone"
                />
              </span>
            </Row>
          ) : null}
          <Row label="next run">
            <span className="font-mono text-[12.5px] text-ink-muted">
              {recipe.nextRunText}
            </span>
          </Row>
          {(recipe.fields || []).map((f) => (
            <Row key={f.key} label={f.label}>
              {f.multiline ? (
                <textarea
                  className={`${inputCls} resize-y leading-relaxed`}
                  rows={Math.max(f.rows || 1, 1)}
                  value={values[`cfg_${f.key}`]}
                  onChange={(e) => set(`cfg_${f.key}`, e.target.value)}
                />
              ) : (
                <input
                  className={inputCls}
                  value={values[`cfg_${f.key}`]}
                  onChange={(e) => set(`cfg_${f.key}`, e.target.value)}
                />
              )}
            </Row>
          ))}
          <Row label="templates">
            <span className="font-mono text-[12.5px] text-ink-muted">
              {recipe.templates.join(', ') || '—'}
            </span>
          </Row>
        </div>
        {error ? <p className="mt-3 text-xs text-red">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-auto px-3 py-1.5 text-xs font-normal"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3">
      <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  );
}
