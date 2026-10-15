'use client';

// The Users page's client parts: an invite's row with its keys, and the
// form for a new invite. Copy link puts the link on the clipboard; where
// the browser refuses (a page not served over https), the row shows the
// link in a read-only field to copy by hand. Revoke takes two presses:
// the second key names what happens. A refused action shows a red line.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field } from '@/components/hardware/field';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row, RowText } from '@/components/hardware/row';
import { ErrorText, Note } from '@/components/hardware/text';

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

  return (
    <Row className="flex-col items-stretch gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <RowText
          className="min-w-0"
          title={
            <span className="break-all">{email || 'Anyone with the link'}</span>
          }
          sub={`Expires ${expires}`}
        />
        <KeyGroup>
          {asking ? (
            <>
              <PushKey
                size="compact"
                disabled={busy}
                onClick={() => setAsking(false)}
              >
                Keep
              </PushKey>
              <PushKey size="compact" disabled={busy} onClick={revoke}>
                Revoke invite
              </PushKey>
            </>
          ) : (
            <>
              <PushKey size="compact" onClick={copy} aria-live="polite">
                {copied ? 'Copied' : 'Copy link'}
              </PushKey>
              <PushKey size="compact" onClick={() => setAsking(true)}>
                Revoke
              </PushKey>
            </>
          )}
        </KeyGroup>
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
      {error ? <ErrorText>{error}</ErrorText> : null}
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
      className="hw-module-body--padded flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        create(e.currentTarget);
      }}
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field
          label="Email (optional)"
          type="email"
          name="email"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-[1_1_260px]"
          onChange={() => setMade(false)}
        />
        <KeyGroup>
          <PushKey type="submit" disabled={busy}>
            New invite
          </PushKey>
        </KeyGroup>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Note role="status">
        {made
          ? 'Invite made. Copy its link above.'
          : 'With an email, only that address can use the link. It works for 7 days.'}
      </Note>
    </form>
  );
}
