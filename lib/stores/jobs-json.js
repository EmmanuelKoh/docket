// Jobs: JSON-file driver (local dev fallback). data/jobs.json.
// Render-on-create: createJob renders immediately and stores the finished
// bytes inline (base64). Each job is a debug record — inputs + outputs — so
// a bad print is reproducible.
//
// No lease handling here: an inflight job stays inflight until acked or
// nacked. The Redis driver is the one with real queue semantics (atomic
// claim + lease expiry); this driver exists so local dev needs no services.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderToEscpos } from '../../render/render-core.js';
import { JOB_CAP, OWNER_ID } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

// Records written before ownerId existed have no ownerId — treat them as ours.
const mine = j => !j.ownerId || j.ownerId === OWNER_ID;

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
export async function createJob({ template, data, name, source }) {
  const { bytes, preview, width, height } = await renderToEscpos(template, data || {});
  const jobs = readStore();
  const id = nextId(jobs);
  jobs.push({
    id,
    ownerId: OWNER_ID,
    createdAt: new Date().toISOString(),
    status: 'queued',
    name: name || '',
    source: source || '',
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

// Store a job whose bytes were rendered by the caller (the Tape tool
// renders in the browser so its preview and its print are the same
// rows). Same record shape as createJob, but template/data are empty:
// there is nothing to re-render from.
export async function createRawJob({ name, source, bytes, png, width, height }) {
  const jobs = readStore();
  const id = nextId(jobs);
  jobs.push({
    id,
    ownerId: OWNER_ID,
    createdAt: new Date().toISOString(),
    status: 'queued',
    name: name || '',
    source: source || '',
    template: null,
    data: {},
    png: png.toString('base64'),
    bytes: bytes.toString('base64'),
    width,
    height,
  });
  writeStore(trim(jobs));
  return { id, status: 'queued', width, height };
}

// Oldest queued job -> inflight. Returns { id, bytes } or null.
export async function nextJob() {
  const jobs = readStore();
  const job = jobs.find(j => j.status === 'queued' && mine(j));
  if (!job) return null;
  job.status = 'inflight';
  job.claimedAt = new Date().toISOString();
  writeStore(jobs);
  return { id: job.id, bytes: Buffer.from(job.bytes, 'base64') };
}

// Cancel a job — only while still queued (never yank an inflight job the
// printer may already be receiving). Returns true if canceled.
export async function cancelJob(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id && mine(j));
  if (!job || job.status !== 'queued') return false;
  job.status = 'canceled';
  writeStore(jobs);
  return true;
}

// Mark done.
export async function ackJob(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id && mine(j));
  if (!job) return false;
  job.status = 'done';
  writeStore(jobs);
  return true;
}

// Back to queued (retry).
export async function nackJob(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id && mine(j));
  if (!job) return false;
  job.status = 'queued';
  writeStore(jobs);
  return true;
}

// Recent jobs, most-recent-first, without bulky fields.
export async function listJobs(limit = 20) {
  return readStore()
    .filter(mine)
    .slice()
    .reverse()
    .slice(0, limit)
    .map(({ id, createdAt, status, width, height, name, source, claimedAt }) => ({
      id, createdAt, status, width, height, name, source, claimedAt,
    }));
}

// Full debug record for one job (inputs + metadata, no bulky payloads).
export async function getJob(id) {
  const job = readStore().find(j => j.id === id && mine(j));
  if (!job) return null;
  const { png, bytes, ...rest } = job;
  return rest;
}

// Return the stored preview PNG for a job (for thumbnails).
export async function getJobPng(id) {
  const jobs = readStore();
  const job = jobs.find(j => j.id === id && mine(j));
  if (!job || !job.png) return null;
  return Buffer.from(job.png, 'base64');
}
