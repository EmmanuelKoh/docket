// lib/job-store.js — job queue storage facade.
// Render-on-create: createJob renders immediately and stores the finished
// bytes. Polling (/next) returns stored bytes; it does not render.
//
// Same interface, two drivers, selected by STORE_DRIVER:
//   json  — local dev fallback; full records inline in data/jobs.json
//   redis — Upstash queue with atomic claim + lease expiry; heavy artifacts
//           (png, ESC/POS bytes) live in Vercel Blob
// Callers never know which is active. All functions are async.

import { STORE_DRIVER } from '../config.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/jobs-redis.js')
  : await import('./stores/jobs-json.js');

export const createJob = impl.createJob;
export const createRawJob = impl.createRawJob;
export const nextJob = impl.nextJob;
export const ackJob = impl.ackJob;
export const nackJob = impl.nackJob;
export const cancelJob = impl.cancelJob;
export const listJobs = impl.listJobs;
export const getJob = impl.getJob;
export const getJobPng = impl.getJobPng;
