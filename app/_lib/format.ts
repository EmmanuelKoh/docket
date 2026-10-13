// app/_lib/format.ts — the dashboard's shared time/status formatting, so
// every page prints identical strings.

export function agoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function agoText(iso: string | null | undefined): string {
  const a = agoShort(iso);
  return a === 'now' ? 'just now' : `${a} ago`;
}

export function hhmmss(iso: string): string {
  try {
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return '';
  }
}

export const HISTORY_STATUSES = ['done', 'failed', 'canceled'];

// The rubber stamp on a History record's receipt: how the job ended. Red
// only for a failure (docs/design-spec.md, red rules).
export type Stamp = { text: string; red: boolean };
const STAMPS: Record<string, string> = {
  done: 'PRINTED',
  canceled: 'CANCELED',
  failed: 'FAILED',
};
export function historyStamp(status: string): Stamp {
  return {
    text: STAMPS[status] ?? status.toUpperCase(),
    red: status === 'failed',
  };
}

// A job's failed print attempts for its sub line in Queue and History;
// empty when there were none.
export function failedAttempts(n = 0): string {
  return n ? `${n} failed attempt${n === 1 ? '' : 's'}` : '';
}

// A job's preview PNG for an <img>: straight from the artifact store when
// jobs.list gave its public URL (hosted), else through our route (local
// rows keep the PNG inline).
export function jobImageSrc(j: {
  id: string;
  imageUrl?: string | null;
}): string {
  return j.imageUrl || `/api/jobs/png?job=${encodeURIComponent(j.id)}`;
}

// The shape jobs.list returns (without bulky fields).
export type JobSummary = {
  id: string;
  name?: string;
  source?: string;
  status: string;
  createdAt: string;
  claimedAt?: string;
  // 'raw' jobs carry caller-rendered bytes (Tape) and cannot be reprinted
  kind: 'template' | 'raw';
  hasTemplate: boolean;
  // the preview PNG's public URL (hosted), or null: see jobImageSrc
  imageUrl: string | null;
  // failed print attempts (nacks); only when listed with attempts: true
  attempts?: number;
};
