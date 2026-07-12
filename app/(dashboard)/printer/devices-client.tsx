'use client';

// Client bits of the Printer page's DEVICES section: claim a printed
// pairing code, revoke a paired device.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
