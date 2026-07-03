// api/ack.js — POST /ack?job=ID
// Device-facing endpoint. Marks a job as done after successful print.

import { ackJob } from '../lib/job-store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const id = req.query?.job;
  if (!id) {
    return res.status(400).json({ error: 'job query parameter is required' });
  }

  const found = ackJob(id);
  return res.status(200).json({ acked: id, found });
}
