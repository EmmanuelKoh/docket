// lib/ops/jobs.js: print jobs from the dashboard side. Studio and Photo
// create jobs from a template (rendered now, bytes stored); Tape hands in
// bytes it rendered itself (a raw job, never re-rendered). The Queue,
// History and Overview pages list jobs and act on one by id. The job store
// (lib/job-store.js) composes the record, the queue and the artifacts;
// these ops scope it to the caller and shape the results. The device side
// (claim, ack, nack) is lib/ops/device-service.js.
import { z } from 'zod';
import * as jobStore from '../job-store.js';
import { defineOperation, JOB_CREATE, OpError } from './define.js';
import { Binary } from './schema.js';

const jobId = z
  .string({ error: 'job query parameter is required' })
  .min(1, { error: 'job query parameter is required' });

// Vercel's request cap is ~4.5MB; a very long take (base64-inflated)
// could brush it. Reject clearly rather than opaquely.
const MAX_B64 = 3 * 1024 * 1024;
const base64 = z
  .string({ error: 'bytes and png (base64) required' })
  .min(1, { error: 'bytes and png (base64) required' });
// db/schema.js JobEncoding: the framing the bytes use.
const JobEncoding = z.object({
  mode: z.enum(['raster', 'chunked']),
  rotate: z.union([z.literal(0), z.literal(180)]),
  flushCut: z.boolean(),
  encoder: z.string(),
});

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…` : s);

export const jobsCreate = defineOperation({
  name: 'jobs.create',
  description: 'Render a template (Liquid + HTML) with data and queue it to print. source labels the job in History; the default is studio.',
  permission: 'owner',
  effects: ['render', ...JOB_CREATE],
  input: z.object({
    template: z.string({ error: 'template is required' }).min(1, { error: 'template is required' }),
    data: z.record(z.string(), z.unknown(), { error: 'data must be a JSON object' }).optional(),
    name: z.string().optional().catch(undefined),
    source: z.string().optional().catch(undefined), // Photo sends 'photo' (components/photo-engine.js)
  }),
  run: (caller, { template, data, name, source }) =>
    jobStore.createJob(caller.ownerId, { template, data, name, source: source || 'studio' }),
});

export const jobsCreateRaw = defineOperation({
  name: 'jobs.createRaw',
  description: 'Queue ESC/POS bytes the caller rendered itself (the Tape tool), with their preview PNG, both base64. name and source label the job in History. A raw job cannot be reprinted.',
  permission: 'owner',
  effects: JOB_CREATE,
  input: z.object({
    bytes: base64,
    png: base64,
    width: z.coerce.number().optional().catch(undefined),
    height: z.coerce.number().optional().catch(undefined),
    name: z.string().optional().catch(undefined),
    source: z.string().optional().catch(undefined),
    encoding: JobEncoding.optional(), // null on the record when the caller does not know it
  }),
  async run(caller, { bytes, png, width, height, name, source, encoding }) {
    if (bytes.length > MAX_B64 || png.length > MAX_B64) {
      throw new OpError('too_large', 'take too long for one job — split it');
    }
    // No producer's defaults here: each producer labels its own jobs
    // (app/api/tape/print/route.ts sends Tape's).
    return jobStore.createRawJob(caller.ownerId, {
      name: name || '',
      source: source || '',
      bytes: Buffer.from(bytes, 'base64'),
      png: Buffer.from(png, 'base64'),
      width: width || 576,
      height: height || 0,
      encoding: encoding ?? null,
    });
  },
});

// A job nacked this many times waits at the back of the queue
// (lib/job-store.js nackJob); while one does, the Queue view reads
// jobs.order.
export { STUCK_AFTER_NACKS } from '../job-store.js';

export const jobsList = defineOperation({
  name: 'jobs.list',
  description: "Your recent jobs, newest first, without payloads (default 20). imageUrl is the preview PNG's public URL where the store serves one, else null (jobs.image has it). status keeps only jobs in those statuses: queued, inflight, done, failed, canceled. attempts adds each job's failed print attempts (times a printer handed it back).",
  permission: 'owner',
  effects: ['db.read', 'queue.read'],
  input: z.object({
    limit: z.number().int().min(1).optional(),
    status: z.array(z.string()).optional(),
    attempts: z.boolean().optional(),
  }),
  run: (caller, { limit, status, attempts }) => jobStore.listJobs(caller.ownerId, limit, { status, attempts }),
});

// The sidebar badge and Overview's queue cell: counts from the queue
// alone, never a job listing.
export const jobsQueueSize = defineOperation({
  name: 'jobs.queueSize',
  description: 'How many of your jobs are waiting to print (queued) and how many a printer holds right now (inflight).',
  permission: 'owner',
  effects: ['queue.read'],
  input: z.object({}),
  output: z.object({ queued: z.number().int(), inflight: z.number().int() }),
  run: caller => jobStore.queueSize(caller.ownerId),
});

export const jobsOrder = defineOperation({
  name: 'jobs.order',
  description: 'The ids of your jobs waiting to print, in the order printers will take them (next first). Jobs a printer holds now are not in it.',
  permission: 'owner',
  effects: ['queue.read'],
  input: z.object({}),
  output: z.object({ ids: z.array(z.string()) }),
  run: async caller => ({ ids: await jobStore.queueOrder(caller.ownerId) }),
});

export const jobsImage = defineOperation({
  name: 'jobs.image',
  description: "A job's preview PNG: the receipt as it prints.",
  permission: 'owner',
  effects: ['db.read', 'artifact.get'],
  input: z.object({ id: jobId }),
  output: Binary,
  async run(caller, { id }) {
    const body = await jobStore.getJobPng(caller.ownerId, id);
    if (!body) throw new OpError('not_found', 'job not found');
    return { contentType: 'image/png', body };
  },
});

// A glance at the record for History's expanded row, not an editor:
// Reprint uses the full stored inputs regardless.
export const jobsDetail = defineOperation({
  name: 'jobs.detail',
  description: "A job's stored inputs: template source and data as JSON, each clipped to 600 characters.",
  permission: 'owner',
  effects: ['db.read', 'artifact.get'],
  input: z.object({ id: jobId }),
  async run(caller, { id }) {
    const job = await jobStore.getJob(caller.ownerId, id);
    if (!job) throw new OpError('not_found', 'record not found');
    return {
      id: job.id,
      template: clip(job.template || '', 600),
      dataJson: clip(JSON.stringify(job.data || {}, null, 2), 600),
    };
  },
});

// Never resends old bytes: the render pipeline may have improved since the
// original print.
export const jobsReprint = defineOperation({
  name: 'jobs.reprint',
  description: "Print a job again: re-render its stored template and data as a new job. Jobs printed from a tool (raw bytes, e.g. Tape) cannot be reprinted.",
  permission: 'owner',
  effects: ['artifact.get', 'render', ...JOB_CREATE],
  input: z.object({ id: jobId }),
  async run(caller, { id }) {
    const job = await jobStore.getJob(caller.ownerId, id);
    if (!job) throw new OpError('not_found', 'record not found');
    // Raw rows the old deployment inserted after the migration still say
    // 'template', but have no template either.
    if (job.kind === 'raw' || !job.template) {
      throw new OpError('invalid', 'printed from a tool — print it again there');
    }
    try {
      const result = await jobStore.createJob(caller.ownerId, {
        template: job.template,
        data: job.data,
        name: job.name || job.id,
        source: 'reprint',
      });
      return { queued: result.id };
    } catch (err) {
      throw new Error(`reprint failed · ${err.message}`, { cause: err });
    }
  },
});

// Only while still queued: a claimed job may already be printing, so
// canceled is false for it (job-store.cancelJob).
export const jobsCancel = defineOperation({
  name: 'jobs.cancel',
  description: 'Cancel a job still waiting in the queue. A job a printer has claimed is left alone (canceled: false); canceled jobs stay in History.',
  permission: 'owner',
  effects: ['queue.release', 'db.write'],
  input: z.object({ id: jobId }),
  run: async (caller, { id }) => ({ canceled: await jobStore.cancelJob(caller.ownerId, id) }),
});

// The dashboard's /nack: a claim never acked (a printer that died mid-job)
// goes back to the front of the queue, to print again or be canceled.
// Only a job still queued or printing: a done job would print twice, and a
// canceled or failed one would come back to life. job-store.requeueJob
// makes that check on its own write, so an ack racing it still wins.
export const jobsRequeue = defineOperation({
  name: 'jobs.requeue',
  description: 'Put a queued or printing job back at the front of the queue, e.g. one stuck printing on a printer that went away. A done, failed or canceled job is refused.',
  permission: 'owner',
  effects: ['db.read', 'queue.release', 'signal.write', 'db.write'],
  input: z.object({ id: jobId }),
  async run(caller, { id }) {
    const { requeued, status } = await jobStore.requeueJob(caller.ownerId, id);
    if (!requeued && status) throw new OpError('conflict', `a ${status} job cannot be requeued`);
    return { requeued };
  },
});
