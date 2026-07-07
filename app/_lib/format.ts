// app/_lib/format.ts — the dashboard's shared time/status formatting,
// ported from api/dashboard.js so both apps print identical strings.

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

// The shape listJobs returns (without bulky fields).
export type JobSummary = {
  id: string;
  name?: string;
  source?: string;
  status: string;
  createdAt: string;
  claimedAt?: string;
};
