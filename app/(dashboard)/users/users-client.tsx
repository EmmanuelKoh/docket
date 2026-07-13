'use client';

// Client bits of /users: mint an invite, copy its link, revoke it.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NewInviteForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create(form: FormData) {
    setBusy(true);
    await fetch('/api/users/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: String(form.get('email') || '') || null }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        create(new FormData(e.currentTarget));
        e.currentTarget.reset();
      }}
    >
      <Input
        type="email"
        name="email"
        placeholder="email (optional — pins the invite)"
        className="max-w-xs"
        aria-label="Invite email"
      />
      <Button type="submit" disabled={busy}>
        New invite
      </Button>
    </form>
  );
}

export function InviteRow({
  token,
  email,
  expiresAt,
}: {
  token: string;
  email: string | null;
  expiresAt: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  return (
    <li className="flex items-baseline gap-2 border-b-[0.5px] border-border py-2">
      <span className="text-sm font-medium text-ink">
        {email || 'anyone with the link'}
      </span>
      <span className="leader" aria-hidden />
      <span className="text-xs text-ink-faint">
        expires {new Date(expiresAt).toLocaleDateString()}
      </span>
      <span className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(
              `${window.location.origin}/invite/${token}`,
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await fetch(
              `/api/users/invites?token=${encodeURIComponent(token)}`,
              {
                method: 'DELETE',
              },
            );
            router.refresh();
          }}
        >
          Revoke
        </Button>
      </span>
    </li>
  );
}
