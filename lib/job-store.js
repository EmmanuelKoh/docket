// lib/job-store.js — job queue storage.
// Render-on-create: createJob renders immediately and stores the finished
// bytes. Polling (/next) returns stored bytes; it does not render.
//
// Each job is a debug record — inputs + outputs — so a bad print is
// reproducible: { id, createdAt, template, data, png, bytes, status, width, height }
//
// Local dev: reads/writes data/jobs.json.
// Vercel (hosted): the job queue MUST be writable to function, so it requires
// Vercel KV/Blob. Until that swap is built, jobs are not available on hosted.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderToEscpos } from '../render/render-core.js';
import { JOB_CAP } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

function readStore() {
  if (!fs.existsSync(JOBS_FILE)) return [];
  return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
}

function writeStore(jobs) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function nextId(jobs) {
  let max = 0;
  for (const j of jobs) {
    const m = j.id.match(/^job-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `job-${max + 1}`;
}

// Remove oldest done/failed jobs when over cap.
function trim(jobs) {
  while (jobs.length > JOB_CAP) {
    const idx = jobs.findIndex(j => j.status === 'done' || j.status === 'failed');
    if (idx < 0) break;
    jobs.splice(idx, 1);
  }
  return jobs;
}

// Render immediately and store the full record.
export async function createJob({ template, data }) {
  const { bytes, preview, width, height } = await renderToEscpos(template, data || {});
  const jobs = readStore();
  const id = nextId(jobs);
  jobs.push({
    id,
    createdAt: new Date().toISOString(),
    status: 'queued',
    template,
    data: data || {},
    png: preview.toString('base64'),
    bytes: bytes.toString('base64'),
    width,
    height,
  });
  writeStore(trim(jobs));
  return { id, status: 'queued', width, height };
}

// Oldest queued job -> inflight. Returns { id, bytes } or null.
export function nextJob() {
  const jobs = readStore();
  const job = jobs.find(j => j.status === 'queued');
  if (!job) return null;
  job.status = 'inflight';
  writeStore(jobs);
  return { id: job.id, bytes: Buffer.from(job.bytes, 'base64') };
}

// Mark done.
export function ackJob(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id);
  if (!job) return false;
  job.status = 'done';
  writeStore(jobs);
  return true;
}

// Back to queued (retry).
export function nackJob(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id);
  if (!job) return false;
  job.status = 'queued';
  writeStore(jobs);
  return true;
}

// Recent jobs, most-recent-first, without bulky fields.
export function listJobs(limit = 20) {
  return readStore()
    .slice()
    .reverse()
    .slice(0, limit)
    .map(({ id, createdAt, status, width, height }) => ({
      id, createdAt, status, width, height,
    }));
}

// Return the stored preview PNG for a job (for thumbnails).
export function getJobPng(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id);
  if (!job || !job.png) return null;
  return Buffer.from(job.png, 'base64');
}
