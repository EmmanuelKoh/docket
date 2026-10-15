'use client';

// Delete a template slip (a plugin's slip is code and can only be turned
// off). Two steps: Delete, then Keep or Delete template. A matte key, not
// red: red is for printing. The store refuses a template a plugin or the
// Photo tool prints with, and the refusal shows under the keys.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { ErrorText } from '@/components/hardware/text';

export function DeleteTemplateButton({ name }: { name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function doDelete() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/templates?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Not deleted. Try again.');
        setConfirming(false);
        return;
      }
      router.push('/slips');
      router.refresh();
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <KeyGroup>
        {confirming ? (
          <>
            <PushKey onClick={() => setConfirming(false)} disabled={busy}>
              Keep
            </PushKey>
            <PushKey onClick={doDelete} disabled={busy}>
              Delete template
            </PushKey>
          </>
        ) : (
          <PushKey onClick={() => setConfirming(true)}>Delete</PushKey>
        )}
      </KeyGroup>
      {error ? <ErrorText className="text-right">{error}</ErrorText> : null}
    </div>
  );
}
