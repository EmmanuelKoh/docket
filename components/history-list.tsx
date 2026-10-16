'use client';

// History's live parts. HistoryProvider holds the one open record and the
// Reprint status, so the deck's red Reprint key (ReprintKey) and its
// status line (ReprintStatus) act on the record open on a day sheet
// (HistoryList). One record is open at a time; opening another closes it,
// and the page scrolls so the line you pressed stays under the pointer.
//
// A day sheet lists its records as typed entries: the receipt laid on the
// sheet as a small slip, the name, the source, failed attempts, and at the
// right the stamp and the time. Opening one lays its receipt on the sheet
// at real size where the small slip was, with its stamp pressed on the
// foot. Only a template job can print again: a receipt a tool made (raw
// bytes, such as a Tape print) has no template, so the record names the
// tool to print it from and Reprint stays off. Each entry is a hair off
// the next (a fixed table by place, never random, so server and client
// agree). Styles are in app/(dashboard)/history/history.css.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { HistoryStamp } from '@/app/_lib/format';
import { Key } from '@/components/hardware/kit/keys';
import { SheetRow, SheetRows } from '@/components/hardware/kit/sheet';
import { Slip, Thumb } from '@/components/hardware/kit/slip';
import { Stamp } from '@/components/hardware/stamp';
import { cn } from '@/components/utils';

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

/** The open record: what the Reprint key prints and names. */
type OpenRecord = { id: string; reprintable: boolean; nameId: string };

type Status = { busy: boolean; text: string; error: boolean };

const IDLE: Status = { busy: false, text: '', error: false };

type HistoryState = {
  open: OpenRecord | null;
  toggle: (record: OpenRecord, line: HTMLElement) => void;
  status: Status;
  reprint: () => void;
};

const HistoryContext = createContext<HistoryState>({
  open: null,
  toggle: () => {},
  status: IDLE,
  reprint: () => {},
});

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenRecord | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);
  const busy = useRef(false);
  // The line pressed and where it was on the screen, so closing a record
  // above it does not move it away from the pointer
  const anchor = useRef<{ line: HTMLElement; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a?.line.isConnected) return;
    const moved = a.line.getBoundingClientRect().top - a.top;
    if (Math.abs(moved) > 1) window.scrollBy(0, moved);
  });

  const toggle = useCallback((record: OpenRecord, line: HTMLElement) => {
    anchor.current = { line, top: line.getBoundingClientRect().top };
    setOpen((o) => (o?.id === record.id ? null : record));
    if (!busy.current) setStatus(IDLE);
  }, []);

  const reprint = useCallback(async () => {
    if (!open?.reprintable || busy.current) return;
    busy.current = true;
    setStatus({ busy: true, text: '', error: false });
    let next: Status;
    try {
      const res = await fetch(
        `/api/jobs/reprint?job=${encodeURIComponent(open.id)}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      next = res.ok
        ? { busy: false, text: 'Sent to the printer.', error: false }
        : {
            busy: false,
            text: data.error ? sentence(data.error) : 'Not sent. Try again.',
            error: true,
          };
    } catch {
      next = { busy: false, text: 'No connection. Try again.', error: true };
    }
    busy.current = false;
    setStatus(next);
  }, [open]);

  const value = useMemo(
    () => ({ open, toggle, status, reprint }),
    [open, toggle, status, reprint],
  );
  return (
    <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
  );
}

/** The deck's red key: live only while a record that can print again is open. */
export function ReprintKey() {
  const { open, status, reprint } = useContext(HistoryContext);
  const live = !!open?.reprintable;
  return (
    <Key
      legend="Reprint"
      print
      disabled={!live}
      down={status.busy}
      aria-describedby={live ? open.nameId : undefined}
      onClick={reprint}
    />
  );
}

/** What the last Reprint did, printed on the deck beside the keys. */
export function ReprintStatus({ className }: { className?: string }) {
  const { status } = useContext(HistoryContext);
  return (
    <span
      role="status"
      className={cn('pk-note', status.error && 'pk-note--red', className)}
    >
      {status.text}
    </span>
  );
}

// Hand-applied stamps: each lands a little differently (rotation, offset,
// where the ink pattern falls)
const STAMPS = [
  { rotate: -2.6, translate: '0 0', mask: '0 0' },
  { rotate: -1.1, translate: '1px -1px', mask: '37px 23px' },
  { rotate: -3.4, translate: '-1px 1px', mask: '81px 9px' },
  { rotate: -0.8, translate: '0 0.5px', mask: '12px 61px' },
  { rotate: -2.1, translate: '1.5px 0', mask: '57px 40px' },
  { rotate: -1.6, translate: '-0.5px -0.5px', mask: '101px 77px' },
];

// Thumbnails laid down by hand: a fraction of a degree each
const THUMB_ROTATE = [-0.5, 0.35, -0.2, 0.55, -0.4, 0.15];

function stampStyle(n: number) {
  const s = STAMPS[n % STAMPS.length];
  return {
    rotate: `${s.rotate}deg`,
    translate: s.translate,
    WebkitMaskPosition: `${s.mask}, 0 0`,
    maskPosition: `${s.mask}, 0 0`,
  };
}

/** One day sheet's entries. `sheet` is the sheet's place (its lie). */
export function HistoryList({
  rows,
  sheet = 0,
}: {
  rows: HistoryRow[];
  sheet?: number;
}) {
  const { open, toggle } = useContext(HistoryContext);
  return (
    <SheetRows>
      {rows.map((row, i) => (
        <HistoryItem
          key={row.id}
          row={row}
          place={i + sheet}
          stampPlace={i + sheet * 2}
          open={open?.id === row.id}
          onToggle={toggle}
        />
      ))}
    </SheetRows>
  );
}

function HistoryItem({
  row,
  place,
  stampPlace,
  open,
  onToggle,
}: {
  row: HistoryRow;
  place: number;
  stampPlace: number;
  open: boolean;
  onToggle: (record: OpenRecord, line: HTMLElement) => void;
}) {
  const id = useId();
  const nameId = `${id}-name`;
  const sourceId = `${id}-source`;
  const attemptsId = `${id}-attempts`;
  const stampId = `${id}-stamp`;
  const timeId = `${id}-time`;
  const recordId = `${id}-record`;
  const asideId = `${id}-aside`;
  // The line reads as "Budget, Studio, Printed, 17:30"; the thumbnail's alt
  // text would only repeat the name
  const labelledBy = [
    nameId,
    row.source ? sourceId : '',
    row.attempts ? attemptsId : '',
    row.stamp ? stampId : '',
    timeId,
  ]
    .filter(Boolean)
    .join(' ');
  const elsewhere = open && !row.reprintable;

  return (
    <SheetRow className={cn('history-row', open && 'is-open')}>
      <button
        type="button"
        className="pk-sheet-line history-line"
        aria-expanded={open}
        aria-controls={open ? recordId : undefined}
        aria-labelledby={labelledBy}
        aria-describedby={elsewhere ? asideId : undefined}
        onClick={(e) =>
          onToggle(
            { id: row.id, reprintable: row.reprintable, nameId },
            e.currentTarget,
          )
        }
      >
        {open ? null : (
          <Thumb
            className="history-thumb"
            src={row.image}
            alt={`${row.name} receipt`}
            imageWidth={row.width}
            imageHeight={row.height}
            rotate={THUMB_ROTATE[place % THUMB_ROTATE.length]}
          />
        )}
        <span className="pk-sheet-ink history-text">
          <span className="history-title" id={nameId}>
            {row.name}
          </span>
          {row.source ? (
            <span className="pk-sheet-sub" id={sourceId}>
              {row.source}
            </span>
          ) : null}
          {row.attempts ? (
            <span className="history-note" id={attemptsId}>
              {row.attempts}
            </span>
          ) : null}
        </span>
        <span className="history-rail">
          {row.stamp && !open ? (
            <Stamp
              id={stampId}
              state={row.stamp}
              className="history-stamp"
              style={stampStyle(stampPlace)}
            />
          ) : null}
          <span className="pk-sheet-ink history-time" id={timeId}>
            {row.time}
          </span>
        </span>
      </button>

      {elsewhere ? (
        <p className="pk-sheet-ink history-note history-aside" id={asideId}>
          Print it again from {row.source || 'the tool that made it'}.
        </p>
      ) : null}

      {open ? (
        <figure id={recordId} className="history-full">
          <Slip
            as="div"
            tear="old"
            src={row.image}
            alt={`${row.name} receipt, full size`}
            imageWidth={row.width}
            imageHeight={row.height}
          >
            {row.stamp ? (
              <Stamp
                id={stampId}
                state={row.stamp}
                paper
                className="history-stamp history-paper-stamp"
                style={stampStyle(stampPlace + 2)}
              />
            ) : null}
          </Slip>
        </figure>
      ) : null}
    </SheetRow>
  );
}
