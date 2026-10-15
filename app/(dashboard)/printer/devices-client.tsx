'use client';

// The Printer page's client parts: a printer's row with its keys (share,
// remove, leave, remove a member), the form that takes a code (a printed
// pairing code claims a new printer; a share code joins someone else's),
// and the watcher that refreshes the page while a pairing completes.
// Removing and leaving take two presses: the second key names what
// happens. A refused action shows a red line in the row.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field } from '@/components/hardware/field';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row, RowText } from '@/components/hardware/row';
import { ErrorText, Note } from '@/components/hardware/text';

// "code required" -> "Code required."
const sentence = (s: string) => {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

async function send(url: string, init: RequestInit): Promise<string> {
  try {
    const r = await fetch(url, init);
    if (r.ok) return '';
    const body = await r.json().catch(() => ({}));
    return sentence(body.error || 'Not done. Try again');
  } catch {
    return 'No connection. Try again.';
  }
}

// Rendered only while a printer is mid-pairing (claimed, token not yet
// collected): re-renders the page every 3s, visible tab only, so the row
// flips to paired the moment the printer picks up its token. Unmounts
// (and stops) once nothing is pending.
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

// A key that asks once: the first press shows Keep and the named action.
function TwoStep({
  label,
  confirm,
  onConfirm,
}: {
  label: string;
  confirm: string;
  onConfirm: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <PushKey size="compact" onClick={() => setAsking(true)}>
        {label}
      </PushKey>
    );
  }
  return (
    <>
      <PushKey size="compact" onClick={() => setAsking(false)} disabled={busy}>
        Keep
      </PushKey>
      <PushKey
        size="compact"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onConfirm();
          setBusy(false);
          setAsking(false);
        }}
      >
        {confirm}
      </PushKey>
    </>
  );
}

export type DeviceRowData = {
  id: string;
  name: string;
  /** "Paired 3 d ago", "Shared with you", "Pairing" */
  sub: string;
  role: 'owner' | 'member';
  shareCode: string | null;
  members: { ownerId: string; email: string }[];
};

export function DeviceRow({ device }: { device: DeviceRowData }) {
  const router = useRouter();
  const [code, setCode] = useState(device.shareCode);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const { id } = device;

  async function act(url: string, init: RequestInit) {
    setError('');
    const err = await send(url, init);
    if (err) setError(err);
    else router.refresh();
  }

  async function share() {
    setSharing(true);
    setError('');
    try {
      const r = await fetch('/api/devices', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) setCode(body.code);
      else setError(sentence(body.error || 'No share code. Try again'));
    } catch {
      setError('No connection. Try again.');
    } finally {
      setSharing(false);
    }
  }

  const q = `id=${encodeURIComponent(id)}`;
  return (
    <Row className="flex-col items-stretch gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <RowText title={device.name} sub={device.sub} />
        <KeyGroup>
          {device.role === 'owner' ? (
            <>
              {code ? null : (
                <PushKey size="compact" onClick={share} disabled={sharing}>
                  Share
                </PushKey>
              )}
              <TwoStep
                label="Remove"
                confirm="Remove printer"
                onConfirm={() => act(`/api/devices?${q}`, { method: 'DELETE' })}
              />
            </>
          ) : (
            <TwoStep
              label="Leave"
              confirm="Leave printer"
              onConfirm={() =>
                act(`/api/devices?${q}&leave`, { method: 'DELETE' })
              }
            />
          )}
        </KeyGroup>
      </div>
      {code ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Field
            label="Share code"
            readOnly
            value={code}
            className="w-[170px]"
            controlClassName="text-[20px] tracking-[0.12em]"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Note className="pb-3">
            Works once, for 15 minutes. The other account enters it on its
            Printer page.
          </Note>
        </div>
      ) : null}
      {device.role === 'owner' && device.members.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {device.members.map((m) => (
            <li
              key={m.ownerId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
            >
              <Note as="span" className="min-w-0 break-all">
                Also prints for {m.email}
              </Note>
              <KeyGroup>
                <TwoStep
                  label="Remove"
                  confirm="Remove account"
                  onConfirm={() =>
                    act(
                      `/api/devices?${q}&member=${encodeURIComponent(m.ownerId)}`,
                      { method: 'DELETE' },
                    )
                  }
                />
              </KeyGroup>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Row>
  );
}

export function ClaimDeviceForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function claim(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setError('');
    const err = await send('/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: String(data.get('code') || ''),
        name: String(data.get('name') || ''),
      }),
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        claim(e.currentTarget);
      }}
    >
      <Field
        label="Pairing code"
        name="code"
        hint="The code the printer prints, or a share code from another account."
        controlClassName="uppercase"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
      />
      <Field
        label="Name"
        name="name"
        placeholder="Kitchen printer"
        autoComplete="off"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <KeyGroup className="self-start">
        <PushKey type="submit" disabled={busy}>
          Pair
        </PushKey>
      </KeyGroup>
    </form>
  );
}
