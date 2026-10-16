'use client';

// A slip's on/off switch, for a slip row (Home, Slips). It sends the
// wanted state to /api/slips/toggle, so a double click or a second tab
// repeats the choice instead of undoing it. The cap moves at once; while
// the server answers, the switch ignores clicks. If the change is not
// saved, the cap goes back and a short red line says so. On success the
// page refreshes, so its next-run line follows.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Switch } from '@/components/hardware/kit/switch';
import { cn } from '@/components/utils';

export function SlipSwitch({
  id,
  title,
  enabled,
  disabled,
  className,
}: {
  /** The slip's module id. */
  id: string;
  /** The slip's name: the switch's accessible name. */
  title: string;
  enabled: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState('');

  async function save(next: boolean) {
    setError('');
    const res = await fetch(
      `/api/slips/toggle?id=${encodeURIComponent(id)}&enabled=${next}`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(`toggle answered ${res.status}`);
    router.refresh();
  }

  const failed = () => setError('Not saved. Try again.');
  return (
    <span className={cn('inline-flex flex-col items-end', className)}>
      <Switch
        checked={enabled}
        label={title}
        disabled={disabled}
        onToggle={save}
        onError={failed}
      />
      {error ? (
        <span role="alert" className="pk-note pk-note--red text-right">
          {error}
        </span>
      ) : null}
    </span>
  );
}
