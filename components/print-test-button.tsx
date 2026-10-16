'use client';

// Print test: the red print key on a slip's front plate, last in its key
// well. It prints the slip's primary template with its stored sample
// data, and says beside the well that the job went to the printer, or why
// it did not. Keys passed as children stand before it in the same well
// (a template slip's Edit and Delete); they print their own messages on
// the same status line through useSlipStatus.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { cn } from '@/components/utils';

type Report = (text: string, isError?: boolean) => void;

const SlipStatus = createContext<Report>(() => {});

/** Print a message on the slip's status line, beside its key well. */
export const useSlipStatus = () => useContext(SlipStatus);

export function PrintTestButton({
  slug,
  children,
}: {
  slug: string;
  /** Keys before Print test in the well. */
  children?: ReactNode;
}) {
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const report = useCallback<Report>((text, error = false) => {
    setStatus(text);
    setIsError(error);
  }, []);

  async function printTest() {
    setBusy(true);
    report('');
    try {
      const res = await fetch(
        `/api/slips/print-test?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) report('Sent to the printer.');
      else report(data.error || 'Not sent. Try again.', true);
    } catch {
      report('No connection. Try again.', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlipStatus.Provider value={report}>
      <div className="sl-act">
        <span
          role="status"
          className={cn('pk-note', isError && 'pk-note--red')}
        >
          {status}
        </span>
        <KeyWell label="Slip" className="sl-well">
          {children}
          <Key legend="Print test" print onClick={printTest} disabled={busy} />
        </KeyWell>
      </div>
    </SlipStatus.Provider>
  );
}
