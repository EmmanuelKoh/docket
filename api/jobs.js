// api/jobs.js — POST /jobs to create a print job, GET /jobs to list recent jobs.
// GET /jobs?png=job-1 serves the stored preview PNG for thumbnails.

import { createJob, listJobs, getJobPng } from '../lib/job-store.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query && req.query.png) {
      const png = getJobPng(req.query.png);
      if (!png) return res.status(404).json({ error: 'job not found' });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(png);
    }
    const limit = parseInt(req.query?.limit, 10) || 20;
    return res.status(200).json(listJobs(limit));
  }

  if (req.method === 'POST') {
    const { template, data } = req.body || {};
    if (!template) {
      return res.status(400).json({ error: 'template is required' });
    }
    try {
      const result = await createJob({ template, data });
      return res.status(201).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
