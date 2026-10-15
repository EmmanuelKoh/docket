// print-file.js — the dry-run sink: write a job's ESC/POS bytes to a file
// instead of a printer. PRINTER_IP=file:<dir> selects it in
// agent/printer-agent.js, so a laptop with no printer still sees jobs go
// from queued to done.

import fs from 'node:fs/promises';
import path from 'node:path';

const PREFIX = 'file:';

// The directory a file:<dir> target names (relative to the current
// directory), '' for a bare file:, or null for a network printer.
export function fileSinkDir(target) {
  if (!target.startsWith(PREFIX)) return null;
  const dir = target.slice(PREFIX.length);
  return dir ? path.resolve(dir) : '';
}

// Writes <dir>/<job id>.bin and returns its path. The id comes from the
// server's X-Job-Id header (owner~job-N); any character outside
// [A-Za-z0-9_.~-] becomes _, so a name can't leave the directory.
export async function printToFile(bytes, dir, jobId) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${String(jobId).replace(/[^\w.~-]/g, '_')}.bin`);
  await fs.writeFile(file, bytes);
  return file;
}
