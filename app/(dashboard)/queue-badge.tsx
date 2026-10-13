// The Queue item's count badge (design spec: shell). The layout renders
// it inside Suspense, so no page waits on it: it streams in once
// jobs.queueSize answers (hosted, two Redis commands and no Postgres).
// Red, and only shown, when nonzero (red-usage rule 4). A failed read
// shows no badge rather than breaking the shell.

import { queueSize } from '@/app/_lib/queue-data';
import { SidebarMenuBadge } from '@/components/ui/sidebar';
import type { Caller } from '@/lib/ops/caller.js';

export async function QueueBadge({ caller }: { caller: Caller }) {
  let count = 0;
  try {
    const { queued, inflight } = await queueSize(caller);
    count = queued + inflight;
  } catch (err) {
    console.error('[queue badge]', err);
    return null;
  }
  if (!count) return null;
  return (
    <SidebarMenuBadge className="font-mono text-red">{count}</SidebarMenuBadge>
  );
}
