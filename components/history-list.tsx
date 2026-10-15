'use client';

// History rows: one list per day (the page puts each day in a module).
// A row is a button that opens the record under it: the receipt at true
// size on white paper with the job's stamp pressed on its foot, the
// template and data it was rendered from (loaded on the first open from
// /api/jobs/detail), and the red Reprint key. Only a template job can
// print again: a receipt a tool made (raw bytes, such as a Tape print)
// has no template, so its record names the tool to print it from. Styles
// are in app/(dashboard)/history/history.css.

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import type { HistoryStamp } from '@/app/_lib/format';
import { PaperSlip } from '@/components/hardware/paper';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row } from '@/components/hardware/row';
import { Stamp } from '@/components/hardware/stamp';
import { ErrorText, Note } from '@/components/hardware/text';

export type HistoryRow = {
  id: string;
  /** The receipt PNG's src (app/_lib/format.ts jobImageSrc) */
  image: string;
  /** Intrinsic size of the PNG, so the receipt reserves its space */
  width: number;
  height?: number;
  name: string;
  /** Where the job came from, as captions name it ("Text messages"); '' if none */
  source: string;
  /** When it printed (or was made), "17:30" in the viewer's time zone */
  time: string;
  /** How the job ended */
  stamp: HistoryStamp | null;
  /** "2 failed attempts", or '' */
  attempts: string;
  reprintable: boolean;
};

type Detail =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; template: string; dataJson: string };

type Reprint = { busy: boolean; text: string; error: boolean };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [reprints, setReprints] = useState<Record<string, Reprint>>({});

  async function loadDetail(id: string) {
    setDetails((d) => ({ ...d, [id]: { state: 'loading' } }));
    try {
      const res = await fetch(`/api/jobs/detail?job=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setDetails((d) => ({
        ...d,
        [id]: {
          state: 'ready',
          template: data.template ?? '',
          dataJson: data.dataJson ?? '',
        },
      }));
    } catch {
      setDetails((d) => ({ ...d, [id]: { state: 'error' } }));
    }
  }

  function toggle(row: HistoryRow) {
    const next = !open[row.id];
    setOpen((o) => ({ ...o, [row.id]: next }));
    // A tool's receipt has no template or data to show
    const detail = details[row.id];
    if (next && row.reprintable && (!detail || detail.state === 'error')) {
      loadDetail(row.id);
    }
  }

  async function reprint(id: string) {
    setReprints((r) => ({
      ...r,
      [id]: { busy: true, text: '', error: false },
    }));
    let result: Reprint;
    try {
      const res = await fetch(
        `/api/jobs/reprint?job=${encodeURIComponent(id)}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      result = res.ok
        ? { busy: false, text: 'Sent to the printer.', error: false }
        : {
            busy: false,
            text: data.error ? sentence(data.error) : 'Not sent. Try again.',
            error: true,
          };
    } catch {
      result = { busy: false, text: 'No connection. Try again.', error: true };
    }
    setReprints((r) => ({ ...r, [id]: result }));
  }

  return (
    <ul className="history-rows">
      {rows.map((row, i) => (
        <HistoryItem
          key={row.id}
          row={row}
          alt={i % 2 === 1}
          open={!!open[row.id]}
          detail={details[row.id]}
          reprint={reprints[row.id]}
          onToggle={() => toggle(row)}
          onReprint={() => reprint(row.id)}
        />
      ))}
    </ul>
  );
}

function HistoryItem({
  row,
  alt,
  open,
  detail,
  reprint,
  onToggle,
  onReprint,
}: {
  row: HistoryRow;
  alt: boolean;
  open: boolean;
  detail?: Detail;
  reprint?: Reprint;
  onToggle: () => void;
  onReprint: () => void;
}) {
  const id = useId();
  const nameId = `${id}-name`;
  const sourceId = `${id}-source`;
  const stampId = `${id}-stamp`;
  const timeId = `${id}-time`;
  const recordId = `${id}-record`;
  // The button reads as "Budget, Reprint, Printed, 17:30"; the thumbnail's
  // alt text would only repeat the name
  const labelledBy = [
    nameId,
    row.source ? sourceId : '',
    row.stamp ? stampId : '',
    timeId,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Row as="li" className="history-item">
      <button
        type="button"
        className="history-toggle"
        aria-expanded={open}
        aria-controls={open ? recordId : undefined}
        aria-labelledby={labelledBy}
        onClick={onToggle}
      >
        <span className="hw-thumb history-thumb">
          <img
            src={row.image}
            alt={`${row.name} receipt`}
            width={row.width}
            height={row.height}
            loading="lazy"
            decoding="async"
          />
        </span>
        <span className="history-text">
          <span className="history-name" id={nameId}>
            {row.name}
          </span>
          {row.source ? (
            <span className="hw-row-sub" id={sourceId}>
              {row.source}
            </span>
          ) : null}
          {row.attempts ? (
            <span className="hw-note">{row.attempts}</span>
          ) : null}
        </span>
        <span className="history-rail">
          {row.stamp ? (
            <Stamp id={stampId} state={row.stamp} alt={alt} />
          ) : null}
          <span className="hw-mono history-time" id={timeId}>
            {row.time}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="history-chevron"
          size={18}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <div id={recordId} className="history-record">
          <div className="history-record-grid">
            <div className="history-slip">
              <PaperSlip
                src={row.image}
                alt={`${row.name} receipt, full size`}
                width={row.width}
                height={row.height}
                tear="solo"
              >
                {row.stamp ? (
                  <Stamp
                    state={row.stamp}
                    alt={alt}
                    paper
                    className="history-paper-stamp"
                  />
                ) : null}
              </PaperSlip>
            </div>

            <div className="history-actions">
              {row.reprintable ? (
                <>
                  <KeyGroup>
                    <PushKey
                      variant="print"
                      onClick={onReprint}
                      disabled={reprint?.busy}
                    >
                      Reprint
                    </PushKey>
                  </KeyGroup>
                  <span
                    role="status"
                    className={reprint?.error ? 'hw-error' : 'hw-note'}
                  >
                    {reprint?.text}
                  </span>
                </>
              ) : (
                <Note>
                  Print it again from {row.source || 'the tool that made it'}.
                </Note>
              )}
            </div>

            {row.reprintable ? <Inputs detail={detail} /> : null}
          </div>
        </div>
      ) : null}
    </Row>
  );
}

// What the receipt was rendered from, in a read-only mono window: the
// template's source or the data (both clipped by jobs.detail). Two keys
// choose which, as in the Studio.
function Inputs({ detail }: { detail?: Detail }) {
  const [tab, setTab] = useState<'template' | 'data'>('template');
  if (detail?.state !== 'ready') {
    return (
      <div className="history-inputs">
        {detail?.state === 'error' ? (
          <ErrorText>
            Template and data not loaded. Close the record and open it again.
          </ErrorText>
        ) : (
          <Note>Loading the template and data…</Note>
        )}
      </div>
    );
  }
  const text = (tab === 'template' ? detail.template : detail.dataJson).trim();
  return (
    <div className="history-inputs">
      <KeyGroup>
        {(['template', 'data'] as const).map((t) => (
          <PushKey
            key={t}
            size="compact"
            down={tab === t}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'template' ? 'Template' : 'Data'}
          </PushKey>
        ))}
      </KeyGroup>
      <pre className="history-readout">{text || 'None'}</pre>
    </div>
  );
}
