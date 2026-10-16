'use client';

// The Users page's client parts: an invite's row with its compact keys,
// and the front plate that makes a new invite. Copy link puts the link on
// the clipboard; where the browser refuses (a page not served over
// https), the row shows the link in a read-only field to copy by hand.
// Revoke takes two presses: Keep, then Revoke invite, which names what
// happens. A refused action shows a red line.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Note } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Row } from '@/components/hardware/kit/sheet';
import { UsersPlate } from './users-plate';

// "invite is invalid" -> "Invite is invalid."
const sentence = (s: string) => {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

async function send(url: string, init: RequestInit, failed: string) {
  try {
    const r = await fetch(url, init);
    if (r.ok) return '';
    const body = await r.json().catch(() => ({}));
    return sentence(body.error || failed);
  } catch {
    return 'No connection. Try again.';
  }
}

export function InviteRow({
  token,
  email,
  expires,
}: {
  token: string;
  email: string | null;
  /** the expiry date as the viewer reads it: "Thu 22 Oct" */
  expires: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function copy() {
    const link = `${window.location.origin}/invite/${token}`;
    setError('');
    try {
      await navigator.clipboard.writeText(link);
      setManual('');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setManual(link);
    }
  }

  async function revoke() {
    setBusy(true);
    setError('');
    const err = await send(
      `/api/users/invites?token=${encodeURIComponent(token)}`,
      { method: 'DELETE' },
      'Not revoked. Try again',
    );
    setBusy(false);
    setAsking(false);
    if (err) setError(err);
    else router.refresh();
  }

  const who = email ? 'For one address' : 'Anyone with the link';
  return (
    <Row className="flex-col items-stretch gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <span className="pk-row-text">
          <span className="pk-engr leading-[1.25]">{who}</span>
          <Note as="span" className="[overflow-wrap:anywhere]">
            {email ? `${email} · ` : ''}Expires {expires}
          </Note>
        </span>
        <KeyWell
          compact
          label={email ? `Invite for ${email}` : 'Open invite'}
          className="ml-auto"
        >
          {asking ? (
            <>
              <Key
                legend="Keep"
                width={96}
                disabled={busy}
                onClick={() => setAsking(false)}
              />
              <Key
                legend="Revoke invite"
                width={176}
                down={busy}
                onClick={() => {
                  if (!busy) revoke();
                }}
              />
            </>
          ) : (
            <>
              <Key
                legend={copied ? 'Copied' : 'Copy link'}
                width={136}
                aria-live="polite"
                onClick={copy}
              />
              <Key
                legend="Revoke"
                width={112}
                onClick={() => setAsking(true)}
              />
            </>
          )}
        </KeyWell>
      </div>
      {manual ? (
        <Field
          label="Invite link"
          hint="Copy this link and send it."
          readOnly
          value={manual}
          controlClassName="text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
      {error ? (
        <Note tone="red" role="alert">
          {error}
        </Note>
      ) : null}
    </Row>
  );
}

export function NewInviteForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState(false);

  async function create(form: HTMLFormElement) {
    const email = String(new FormData(form).get('email') || '').trim();
    setBusy(true);
    setError('');
    setMade(false);
    const err = await send(
      '/api/users/invites',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email || null }),
      },
      'No invite made. Try again',
    );
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    form.reset();
    setMade(true);
    router.refresh();
  }

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) create(e.currentTarget);
      }}
    >
      <UsersPlate
        id="users-new"
        number="03"
        title="New invite"
        className="pb-[26px]"
      >
        {/* the hint stays under the field; the key sits beside the field
            (below the hint on a phone) */}
        <div className="grid grid-cols-1 gap-y-3 pt-3 min-[640px]:grid-cols-[minmax(0,480px)_auto] min-[640px]:items-end min-[640px]:justify-between min-[640px]:gap-x-8 min-[1180px]:pt-[10px]">
          <Field
            label="Email (optional)"
            type="email"
            name="email"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="users-new-status"
            className="min-w-0"
            onChange={() => setMade(false)}
          />
          <div className="flex flex-col gap-2 min-[640px]:col-start-1">
            <Note id="users-new-status" role="status">
              {made
                ? 'Invite made. Copy its link above.'
                : 'With an email, only that address can use the link. It works for 7 days.'}
            </Note>
            {error ? (
              <Note tone="red" role="alert">
                {error}
              </Note>
            ) : null}
          </div>
          <KeyWell className="justify-self-end min-[640px]:col-start-2 min-[640px]:row-start-1">
            <Key legend="Make invite" type="submit" width={144} down={busy} />
          </KeyWell>
        </div>
      </UsersPlate>
    </form>
  );
}
