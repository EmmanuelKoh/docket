'use client';

// Client bits of the Printer page's DEVICES section: claim a printed
// pairing code, revoke a paired device, and watch a pairing complete.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Rendered only while a device row is mid-pairing (claimed, token not yet
// collected): re-renders the page every 3s — visible tab only, same rule
// as the queue list — so the row flips to "paired" the moment the device
// picks up its token. Unmounts (and stops) once nothing is pending.
export function PairingWatcher() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}

export function ClaimDeviceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim(form: FormData) {
    setBusy(true);
    setError(null);
    const r = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: String(form.get('code') || ''),
        name: String(form.get('name') || ''),
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setError(body.error || 'pairing failed');
      return;
    }
    router.refresh();
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        claim(new FormData(e.currentTarget));
      }}
    >
      <Input
        name="code"
        placeholder="pairing code"
        className="w-36 font-mono uppercase"
        autoComplete="off"
        aria-label="Pairing code"
      />
      <Input
        name="name"
        placeholder="name (kitchen printer)"
        className="max-w-48"
        aria-label="Device name"
      />
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? 'Pairing…' : 'Pair'}
      </Button>
      {error ? <p className="w-full text-xs text-red">{error}</p> : null}
    </form>
  );
}

export function RevokeDeviceButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await fetch(`/api/devices?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        router.refresh();
      }}
    >
      Revoke
    </Button>
  );
}
