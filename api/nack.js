// api/nack.js — POST /nack?job=ID
// Device-facing endpoint. Requeues a job after a failed print attempt.
// Requires Authorization: Bearer <DEVICE_TOKEN>.

import { nackJob } from '../lib/job-store.js';
import { requireDeviceToken } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  if (!requireDeviceToken(req, res)) return;

  const id = req.query?.job;
  if (!id) {
    return res.status(400).json({ error: 'job query parameter is required' });
  }

  const found = await nackJob(id);
  return res.status(200).json({ requeued: id, found });
}
