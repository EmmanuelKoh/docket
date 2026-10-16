'use client';

// The Queue page's live view (design spec: pages, Queue): one deck. The
// server renders the first list; this component then re-fetches
// /api/queue while the tab is visible, at a cadence that follows the
// person (components/hooks/use-eased-poll.ts): every 3s while they are
// active, every 30s after two idle minutes, stopped after thirty. Any
// interaction resumes the fast cadence; the Refresh key re-fetches at once
// and is the way back from Paused.
//
// The head plate engraves the name and the poll state; the deck plate
// counts the waiting jobs on a counter beside the Refresh key. Then two
// numbered plates in print order: Printing (the job a printer holds, with
// a red LED and a Requeue key, the way back for a job stuck on a printer
// that went away) and Waiting (the jobs in the order they will print,
// each with a Cancel key). A row: the receipt's thumbnail, its name, when
// it was made (viewer's time zone, formatted by the server) and what made
// it, and any failed print attempts in red. A refused action prints a red
// line in its row.

import { useCallback, useState } from 'react';
import type { QueueJob } from '@/app/_lib/queue-data';
import { Body, Plate, PlateTitle } from '@/components/hardware/kit/body';
import { CounterWindow } from '@/components/hardware/kit/counter-window';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp } from '@/components/hardware/kit/led';
import { Row, Rows } from '@/components/hardware/kit/sheet';
import { Thumb } from '@/components/hardware/kit/slip';
import { useEasedPoll } from '@/components/hooks/use-eased-poll';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "a done job cannot be requeued" -> "A done job cannot be requeued."
const sentence = (s: string) => {
  const t = capital(s);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

// "5 m" (the server's short form) -> "5 min", as the Printer page writes it
const AGO_UNIT: Record<string, string> = {
  s: 'sec',
  m: 'min',
  h: 'hr',
  d: 'days',
};
const agoWords = (t: string) =>
  t === '1 d'
    ? '1 day'
    : t.replace(/ ([smhd])$/, (_, u: string) => ` ${AGO_UNIT[u]}`);

const POLL_TEXT = {
  live: 'Updates every 3 sec',
  eased: 'Updates every 30 sec',
  paused: 'Paused',
} as const;

type Action = 'cancel' | 'requeue';

// A plate's numbered name, with an engraved line running on to the plate's
// right edge (a panel's section legend).
function PlateHeading({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className="m-0 flex items-center gap-4">
      <PlateTitle number={number}>
        <Engraved>{children}</Engraved>
      </PlateTitle>
      <span
        aria-hidden="true"
        className="h-[1.2px] flex-1 bg-[linear-gradient(var(--pk-rule)_0_0.6px,var(--pk-rule-lip)_0.6px_1.2px)]"
      />
    </h2>
  );
}

export function QueueList({
  initial,
  labels,
}: {
  initial: QueueJob[];
  /** a job's source id to the name a caption gives it ('sms' -> 'Text messages') */
  labels: Record<string, string>;
}) {
  const [jobs, setJobs] = useState<QueueJob[]>(initial);
  // A server render (router.refresh, for example once the time zone
  // cookie is first set) brings a fresher list: take it.
  const [rendered, setRendered] = useState(initial);
  if (initial !== rendered) {
    setRendered(initial);
    setJobs(initial);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs);
    } catch {
      // transient network error: keep the last good list
    }
  }, []);
  const { mode, resume } = useEasedPoll(load);

  // Cancel a waiting job; requeue a printing one (a stuck claim back to
  // the front of the queue). Both answer the fresh list, so the rows
  // update in one round trip.
  async function act(action: Action, id: string) {
    setBusy(id);
    setErrors((e) => {
      const { [id]: _gone, ...rest } = e;
      return rest;
    });
    let error = '';
    try {
      const res = await fetch(
        `/api/jobs/${action}?job=${encodeURIComponent(id)}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        error = sentence(
          data?.error ||
            (action === 'cancel'
              ? 'Not canceled. Try again'
              : 'Not requeued. Try again'),
        );
      } else {
        const list: QueueJob[] = data.jobs;
        setJobs(list);
        // A printer took the job between the last poll and the press
        if (
          action === 'cancel' &&
          list.some((j) => j.id === id && j.inflight)
        ) {
          error = 'Not canceled: a printer took it first.';
        }
      }
    } catch {
      error = 'No connection. Try again.';
    } finally {
      setBusy(null);
    }
    if (error) setErrors((e) => ({ ...e, [id]: error }));
  }

  const printing = jobs.filter((j) => j.inflight);
  const waiting = jobs.filter((j) => !j.inflight);
  const label = (source: string) =>
    source ? (labels[source] ?? capital(source)) : '';
  const row = (job: QueueJob) => (
    <QueueRow
      key={job.id}
      job={job}
      source={label(job.source)}
      busy={busy === job.id}
      error={errors[job.id] ?? ''}
      onAct={act}
    />
  );
  const count = waiting.length;

  return (
    <Body as="section" aria-labelledby="queue-name">
      <Plate head>
        <PageName id="queue-name">Queue</PageName>
        <Engraved tone="soft" className="mr-[-0.15em]">
          {POLL_TEXT[mode]}
        </Engraved>
      </Plate>

      <Plate
        seam
        className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5"
      >
        <span className="flex items-center gap-3">
          <Engraved aria-hidden="true">Waiting</Engraved>
          <CounterWindow
            value={String(count).padStart(2, '0')}
            label={`${count} ${count === 1 ? 'job' : 'jobs'} waiting`}
            legend={count === 1 ? 'Job' : 'Jobs'}
          />
        </span>
        <KeyWell label="Queue">
          <Key legend="Refresh" onClick={() => resume()} />
        </KeyWell>
      </Plate>

      {jobs.length === 0 ? (
        <Plate seam className="flex flex-col gap-2 pb-[26px]">
          <PlateHeading number="01">Waiting</PlateHeading>
          <Rows>
            <Row>
              <Note>Nothing is waiting to print.</Note>
            </Row>
          </Rows>
        </Plate>
      ) : (
        <>
          <Plate seam className="flex flex-col gap-2">
            <PlateHeading number="01">Printing</PlateHeading>
            <Rows ruled>
              {printing.map(row)}
              {printing.length === 0 ? (
                <Row>
                  <Note>Nothing printing.</Note>
                </Row>
              ) : null}
            </Rows>
          </Plate>
          <Plate seam className="flex flex-col gap-2 pb-[26px]">
            <PlateHeading number="02">Waiting</PlateHeading>
            <Rows ruled>
              {waiting.map(row)}
              {waiting.length === 0 ? (
                <Row>
                  <Note>Nothing else waiting.</Note>
                </Row>
              ) : null}
            </Rows>
          </Plate>
        </>
      )}
    </Body>
  );
}

function QueueRow({
  job,
  source,
  busy,
  error,
  onAct,
}: {
  job: QueueJob;
  source: string;
  busy: boolean;
  error: string;
  onAct: (action: Action, id: string) => void;
}) {
  return (
    <Row className="items-start justify-start gap-5 max-[639px]:gap-4">
      <Thumb
        src={job.image}
        alt=""
        imageWidth={job.width}
        imageHeight={job.height ?? undefined}
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-3 pt-1">
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
          <span className="pk-note break-words text-[15px] font-semibold leading-snug text-[color:var(--pk-fill)]">
            {job.name}
          </span>
          {job.inflight ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <Lamp state="printing">Printing</Lamp>
              {job.claimedAgo ? (
                <Note as="span">Started {agoWords(job.claimedAgo)} ago</Note>
              ) : null}
            </span>
          ) : null}
          <Engraved tone="soft" className="pk-row-sub leading-[1.3]">
            {source ? `${job.createdTime} · ${source}` : job.createdTime}
          </Engraved>
          {job.attemptsText ? (
            <Note tone="red">{capital(job.attemptsText)}</Note>
          ) : null}
          {error ? (
            <Note tone="red" role="alert">
              {error}
            </Note>
          ) : null}
        </div>
        <KeyWell compact label={job.name} className="shrink-0">
          <Key
            legend={job.inflight ? 'Requeue' : 'Cancel'}
            disabled={busy}
            onClick={() => onAct(job.inflight ? 'requeue' : 'cancel', job.id)}
          />
        </KeyWell>
      </div>
    </Row>
  );
}
