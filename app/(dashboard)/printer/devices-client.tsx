'use client';

// Client bits of the Printer page's DEVICES section: enter a code (a
// printed pairing code claims a new device; a share code joins someone
// else's), share a device you own, leave one shared with you, remove a
// member, revoke, and watch a pairing complete.

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
        placeholder="pairing or share code"
        className="w-44 font-mono uppercase"
        autoComplete="off"
        aria-label="Pairing or share code"
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

// Owner-only: mint a single-use share code and show it inline. Another
// account types it into their own code box to join this device.
export function ShareDeviceButton({
  id,
  initial = null,
}: {
  id: string;
  initial?: string | null;
}) {
  const [code, setCode] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);

  if (code) {
    return (
      <span className="font-mono text-xs text-ink">
        share code {code}
        <span className="text-ink-faint"> · 15m, single use</span>
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await fetch('/api/devices', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        setBusy(false);
        if (r.ok) setCode((await r.json()).code);
      }}
    >
      Share
    </Button>
  );
}

export function LeaveDeviceButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await fetch(`/api/devices?id=${encodeURIComponent(id)}&leave`, {
          method: 'DELETE',
        });
        router.refresh();
      }}
    >
      Leave
    </Button>
  );
}

export function RemoveMemberButton({
  id,
  member,
}: {
  id: string;
  member: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs text-ink-faint transition-colors hover:text-ink"
      onClick={async () => {
        await fetch(
          `/api/devices?id=${encodeURIComponent(id)}&member=${encodeURIComponent(member)}`,
          { method: 'DELETE' },
        );
        router.refresh();
      }}
    >
      remove
    </button>
  );
}
