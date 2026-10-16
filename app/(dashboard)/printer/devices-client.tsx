'use client';

// The Printer page's client parts: a printer's row on the Printers plate
// with its compact keys (share, remove, leave, remove a member), the Add a
// printer form (a printed pairing code claims a new printer; a share code
// joins someone else's), and the watcher that refreshes the page while a
// pairing completes. Removing and leaving take two presses: the second key
// names what happens. A refused action prints a red line in the row.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Note } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Row, RowText } from '@/components/hardware/kit/sheet';

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

// The confirming key carries the whole action ("Remove printer"), so it is
// wider than a plain key: width in the well's own (unzoomed) px.
const CONFIRM_W = 178;

// Keys that ask once: the first press shows Keep and the named action.
// They stand in the caller's key well, after any other keys in it.
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
  // The first key stays the same button as it turns from the action to
  // Keep, so it keeps the focus.
  return (
    <>
      <Key
        legend={asking ? 'Keep' : label}
        disabled={asking && busy}
        onClick={() => setAsking(!asking)}
      />
      {asking ? (
        <Key
          legend={confirm}
          width={CONFIRM_W}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
            setAsking(false);
          }}
        />
      ) : null}
    </>
  );
}

export type DeviceRowData = {
  id: string;
  name: string;
  /** "Paired 3 days ago", "Shared with you", "Pairing" */
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
    <Row className="flex-col items-stretch gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <RowText title={device.name} sub={device.sub} className="py-1" />
        <KeyWell compact label={device.name} className="shrink-0">
          {device.role === 'owner' ? (
            <>
              {code ? null : (
                <Key legend="Share" onClick={share} disabled={sharing} />
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
        </KeyWell>
      </div>
      {code ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Field
            label="Share code"
            readOnly
            value={code}
            className="w-[176px]"
            controlClassName="text-[20px] tracking-[0.14em] [&:read-only]:text-[color:var(--pk-eink-ink)] dark:[&:read-only]:text-[#d5d1c7]"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Note className="max-w-[44ch] pb-2.5">
            Works once, for 15 minutes. The other account enters it on its
            Printer page.
          </Note>
        </div>
      ) : null}
      {device.role === 'owner' && device.members.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {device.members.map((m) => (
            <li
              key={m.ownerId}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
            >
              <Note as="span" className="min-w-0 break-all">
                Also prints for {m.email}
              </Note>
              <KeyWell compact label={m.email} className="shrink-0">
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
              </KeyWell>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <Note tone="red" role="alert">
          {error}
        </Note>
      ) : null}
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
      aria-labelledby="add-printer"
      className="grid items-start gap-x-6 gap-y-5 min-[720px]:grid-cols-[minmax(0,15rem)_minmax(0,20rem)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        claim(e.currentTarget);
      }}
    >
      <Field
        label="Pairing code"
        name="code"
        hint="The code the printer prints, or a share code from another account."
        error={error || undefined}
        controlClassName="uppercase tracking-[0.08em]"
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
      <KeyWell label="Pair" className="justify-self-start">
        <Key legend="Pair" type="submit" disabled={busy} />
      </KeyWell>
    </form>
  );
}
