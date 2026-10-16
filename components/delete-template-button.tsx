'use client';

// Delete, in a template slip's key well (inside PrintTestButton, after
// the keys passed in, before Print test). A plugin's slip is code and can
// only be turned off. Two steps: Delete asks on the status line, Keep
// takes its place and the focus, and Delete, one key along, deletes. A
// plain key, not red: red is for printing. The store refuses a template a
// plugin or the Photo tool prints with, and the refusal prints on the
// status line.

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Key } from '@/components/hardware/kit/keys';
import { useSlipStatus } from '@/components/print-test-button';

export function DeleteTemplateButton({
  name,
  children,
}: {
  name: string;
  /** Keys before Delete (Edit). */
  children?: ReactNode;
}) {
  const router = useRouter();
  const report = useSlipStatus();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const keepId = useId();

  useEffect(() => {
    if (confirming) document.getElementById(keepId)?.focus();
  }, [confirming, keepId]);

  async function doDelete() {
    setBusy(true);
    report('');
    try {
      const res = await fetch(`/templates?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        report(data.error || 'Not deleted. Try again.', true);
        setConfirming(false);
        return;
      }
      router.push('/slips');
      router.refresh();
    } catch {
      report('No connection. Try again.', true);
    } finally {
      setBusy(false);
    }
  }

  // Keep takes Delete's place (a second click lands on it) and gets the
  // focus; Delete moves one along.
  return (
    <>
      {children}
      {confirming ? (
        <>
          <Key
            key="keep"
            id={keepId}
            legend="Keep"
            onClick={() => {
              report('');
              setConfirming(false);
            }}
            disabled={busy}
          />
          <Key
            key="confirm"
            legend="Delete"
            onClick={doDelete}
            disabled={busy}
          />
        </>
      ) : (
        <Key
          key="delete"
          legend="Delete"
          onClick={() => {
            report('Delete this template? Press Delete again.');
            setConfirming(true);
          }}
        />
      )}
    </>
  );
}
