// tests/printer-agent.test.ts — the laptop printer agent has no default
// printer. With PRINTER_IP unset it exits and says what to set (a bare
// file: gets its own message naming the missing directory); with
// PRINTER_IP=file:<dir> it writes each job's bytes to <dir>/<job id>.bin
// and acks, so a checkout with no printer still sees queued -> done. The
// agent runs as a child process against a stub server, from a temp
// directory so dotenv finds no .env.

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileSinkDir, printToFile } from '@/transport/print-file.js';
import { printToNetwork } from '@/transport/print-net.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/printer-agent`;
});

const ROOT = path.resolve(__dirname, '..');
const AGENT = path.join(ROOT, 'agent', 'printer-agent.js');
const BASE = process.env.DATA_DIR as string;
const children: ChildProcess[] = [];

beforeAll(() => {
  fs.mkdirSync(BASE, { recursive: true });
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
  vi.unstubAllGlobals();
});

function runAgent(env: Record<string, string>) {
  const child = spawn(process.execPath, [AGENT], {
    cwd: BASE,
    env: { ...process.env, POLL_INTERVAL: '50', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout?.on('data', (d) => {
    out += d;
  });
  child.stderr?.on('data', (d) => {
    out += d;
  });
  const exited = new Promise<number | null>((resolve) =>
    child.on('exit', (code) => resolve(code)),
  );
  return { child, exited, output: () => out };
}

describe('printer agent', () => {
  it('exits with a message naming PRINTER_IP and the dry-run sink when it is unset', async () => {
    const { exited, output } = runAgent({ PRINTER_IP: '' });
    expect(await exited).toBe(1);
    expect(output()).toMatch(/PRINTER_IP is not set/);
    expect(output()).toMatch(/file:<dir>/);
  });

  it('refuses a bare file: and says the directory is missing', async () => {
    const { exited, output } = runAgent({ PRINTER_IP: 'file:' });
    expect(await exited).toBe(1);
    expect(output()).toMatch(/PRINTER_IP=file: names no directory/);
    expect(output()).toMatch(/PRINTER_IP=file:data\/prints/);
    expect(output()).not.toMatch(/not set/);
  });

  it('with PRINTER_IP=file:<dir>, writes the job to <dir>/<job id>.bin and acks it', async () => {
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x00]);
    const jobId = 'test-owner~job-7';
    let served = false;
    let resolveAck: (id: string | null) => void = () => {};
    const acked = new Promise<string | null>((r) => {
      resolveAck = r;
    });
    const nacks: string[] = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/next') {
        if (served) {
          res.writeHead(204).end();
          return;
        }
        served = true;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.length),
          'X-Job-Id': jobId,
        });
        res.end(bytes);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/ack') {
        resolveAck(url.searchParams.get('job'));
      }
      if (req.method === 'POST' && url.pathname === '/nack') {
        nacks.push(url.searchParams.get('job') ?? '');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const dir = path.join(BASE, 'prints');
    try {
      const { child, exited, output } = runAgent({
        PRINTER_IP: 'file:prints',
        PRINT_SERVER: `http://127.0.0.1:${port}`,
        DEVICE_TOKEN: 'test-device-token',
      });
      const died = exited.then((code) => {
        throw new Error(`agent exited (${code}): ${output()}`);
      });
      expect(await Promise.race([acked, died])).toBe(jobId);
      expect(fs.readFileSync(path.join(dir, `${jobId}.bin`))).toEqual(bytes);
      expect(nacks).toEqual([]);
      expect(output()).toMatch(/dry run: writing jobs to/);
      child.kill();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('transports', () => {
  it('printToNetwork throws before connecting when there is no address', async () => {
    await expect(printToNetwork(Buffer.from([0x0a]), '')).rejects.toThrow(
      /PRINTER_IP/,
    );
  });

  it('fileSinkDir reads file:<dir>, a bare file:, and a network address', () => {
    expect(fileSinkDir('file:out/prints')).toBe(path.resolve('out/prints'));
    expect(fileSinkDir('file:')).toBe('');
    expect(fileSinkDir('192.168.0.50')).toBeNull();
  });

  it('printToFile keeps a hostile job id inside the directory', async () => {
    const dir = path.join(BASE, 'hostile');
    const file = await printToFile(Buffer.from([1, 2]), dir, '../../x/y');
    expect(path.dirname(file)).toBe(dir);
    expect(path.basename(file)).toBe('.._.._x_y.bin');
    expect(fs.readFileSync(file)).toEqual(Buffer.from([1, 2]));
  });
});
