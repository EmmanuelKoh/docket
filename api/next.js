// api/next.js — GET /next
// Device-facing endpoint. Returns the oldest queued job's ESC/POS bytes
// with X-Job-Id header, or 204 if the queue is empty.
// Requires Authorization: Bearer <DEVICE_TOKEN>.

import { nextJob } from '../lib/job-store.js';
import { requireDeviceToken } from '../lib/auth.js';
import { setState } from '../lib/state-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }
  if (!requireDeviceToken(req, res)) return;

  // Record device contact for the dashboard's "printer online" line.
  await setState('device', { lastSeenAt: new Date().toISOString() }).catch(() => {});

  const job = await nextJob();
  if (!job) {
    return res.status(204).send();
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Job-Id', job.id);
  return res.status(200).send(job.bytes);
}
