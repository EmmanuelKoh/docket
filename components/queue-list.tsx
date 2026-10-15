'use client';

// The Queue page's live view (design spec: pages, Queue). The server
// renders the first list; this component then re-fetches /api/queue while
// the tab is visible, at a cadence that follows the person
// (components/hooks/use-eased-poll.ts): every 3s while they are active,
// every 30s after two idle minutes, stopped after thirty. Any interaction
// resumes the fast cadence; the Refresh key re-fetches at once and is the
// way back from Paused.
//
// Two modules in print order: Printing (the job a printer holds, with a
// red LED and a Requeue key, the way back for a job stuck on a printer
// that went away) and Waiting (the jobs in the order they will print,
// each with a Cancel key). A row: the receipt's thumbnail on white paper,
// its name, when it was made (viewer's time zone, formatted by the
// server) and what made it, and any failed print attempts in red. A
// refused action shows a red line in its row.

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { QueueJob } from '@/app/_lib/queue-data';
import { Led } from '@/components/hardware/led';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row } from '@/components/hardware/row';
import { ErrorText, Note } from '@/components/hardware/text';
import { useEasedPoll } from '@/components/hooks/use-eased-poll';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "a done job cannot be requeued" -> "A done job cannot be requeued."
const sentence = (s: string) => {
  const t = capital(s);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

const POLL_TEXT = {
  live: 'Updates every 3 s',
  eased: 'Updates every 30 s',
  paused: 'Paused',
} as const;

type Action = 'cancel' | 'requeue';

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

  return (
    <>
      <PageTitle
        aside={POLL_TEXT[mode]}
        actions={
          <KeyGroup>
            <PushKey size="compact" onClick={() => resume()}>
              Refresh
            </PushKey>
          </KeyGroup>
        }
      >
        Queue
      </PageTitle>

      <div className="flex max-w-[860px] flex-col gap-[30px]">
        {jobs.length === 0 ? (
          <Module number="01" title="Waiting">
            <Note>Nothing is waiting to print.</Note>
            <Link href="/" className="hw-link self-start">
              Back to Home
            </Link>
          </Module>
        ) : (
          <>
            <Module number="01" title="Printing" flush>
              {printing.map(row)}
              {printing.length === 0 ? (
                <Row>
                  <Note>Nothing printing.</Note>
                </Row>
              ) : null}
            </Module>
            <Module number="02" title="Waiting" flush>
              {waiting.map(row)}
              {waiting.length === 0 ? (
                <Row>
                  <Note>Nothing else waiting.</Note>
                </Row>
              ) : null}
            </Module>
          </>
        )}
      </div>
    </>
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
    <Row className="items-start justify-start gap-4">
      <span className="hw-thumb max-h-[150px] w-[72px] sm:w-[112px]">
        <img
          src={job.image}
          alt=""
          width={job.width}
          height={job.height ?? undefined}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
          <span className="break-words font-semibold">{job.name}</span>
          {job.inflight ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-2 font-semibold text-red">
                <Led state="printing" />
                Printing
              </span>
              {job.claimedAgo ? (
                <Note as="span">
                  Started <span className="hw-mono">{job.claimedAgo}</span> ago
                </Note>
              ) : null}
            </span>
          ) : null}
          <span className="hw-row-sub">
            {source ? `${job.createdTime} · ${source}` : job.createdTime}
          </span>
          {job.attemptsText ? (
            <span className="hw-error">{capital(job.attemptsText)}</span>
          ) : null}
          {error ? <ErrorText className="mt-1">{error}</ErrorText> : null}
        </div>
        <KeyGroup>
          <PushKey
            size="compact"
            disabled={busy}
            onClick={() => onAct(job.inflight ? 'requeue' : 'cancel', job.id)}
          >
            {job.inflight ? 'Requeue' : 'Cancel'}
          </PushKey>
        </KeyGroup>
      </div>
    </Row>
  );
}
