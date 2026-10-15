'use client';

// Print test: the red print key under a slip's preview. It prints the
// slip's primary template with its stored sample data, and says beside
// the key that the job went to the printer, or why it did not.

import { useState } from 'react';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';

export function PrintTestButton({ slug }: { slug: string }) {
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function printTest() {
    setBusy(true);
    setIsError(false);
    setStatus('');
    try {
      const res = await fetch(
        `/api/slips/print-test?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('Sent to the printer.');
      } else {
        setStatus(data.error || 'Not sent. Try again.');
        setIsError(true);
      }
    } catch {
      setStatus('No connection. Try again.');
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <KeyGroup>
        <PushKey variant="print" onClick={printTest} disabled={busy}>
          Print test
        </PushKey>
      </KeyGroup>
      <span
        role="status"
        className={isError ? 'hw-error hw-ink' : 'hw-note hw-ink'}
      >
        {status}
      </span>
    </div>
  );
}
