// tests/job-kind.test.ts — every job records what it is: kind 'template'
// (re-renderable) or 'raw' (caller-rendered bytes, e.g. Tape), and the
// encoding its bytes use. The reported encoding must match the framing
// the bytes actually carry.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTapeRenderer } from '@/components/tape-renderer.js';
import { createJob, createRawJob, getJob, listJobs } from '@/lib/job-store.js';
import { ENCODER, renderToEscpos } from '@/render/render-core.js';

// Own DATA_DIR subfolder; PRINT_WIDTH and FONT_DIR forced to their
// defaults as tests/golden-escpos.test.ts does, so a developer's .env
// cannot change what renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/job-kind`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const TEXT =
  '<div style="display:flex;flex-direction:column;font-size:28px"><div>Buy milk</div><div>Call the bank</div></div>';
// The golden test's synthetic field: 1000 dithered rows, chunked + rotated.
const GRAY =
  '<div style="display:flex;width:576px;height:1000px;background:#808080"></div>';

const RASTER = {
  mode: 'raster',
  rotate: 0,
  flushCut: false,
  encoder: ENCODER,
};
const CHUNKED = {
  mode: 'chunked',
  rotate: 180,
  flushCut: true,
  encoder: ENCODER,
};

const ESC_INIT = [0x1b, 0x40];
const GS_V0 = [0x1d, 0x76, 0x30, 0x00];
const LINE_SPACING_0 = [0x1b, 0x33, 0x00];
const GS_STAR = [0x1d, 0x2a];
const FLUSH_CUT = [0x1d, 0x56, 0x42, 0x0c];

const at = (b: Uint8Array, i: number, n: number) => [...b.subarray(i, i + n)];
const tail = (b: Uint8Array, n: number) => [...b.subarray(b.length - n)];
const owner = () => `owner-${randomUUID()}`;

describe('render-core reports its encoding', () => {
  it('a text template is a raster job', async () => {
    const r = await renderToEscpos(TEXT, {});
    expect(r.encoding).toEqual(RASTER);
  });

  it('the 1000-row gray field is chunked, rotated 180 with a flush cut', {
    timeout: 60_000,
  }, async () => {
    const r = await renderToEscpos(GRAY, {});
    expect(r.encoding).toEqual(CHUNKED);
  });
});

describe('the reported mode matches the byte framing', () => {
  it('raster: GS v 0 at byte 2', async () => {
    const { bytes, encoding } = await renderToEscpos(TEXT, {});
    expect(encoding.mode).toBe('raster');
    expect(at(bytes, 0, 2)).toEqual(ESC_INIT);
    expect(at(bytes, 2, 4)).toEqual(GS_V0);
    expect(tail(bytes, 4)).not.toEqual(FLUSH_CUT);
  });

  it('chunked: ESC 3 0 at byte 2, GS * chunks, flush cut last', {
    timeout: 60_000,
  }, async () => {
    const { bytes, encoding } = await renderToEscpos(GRAY, {});
    expect(encoding.mode).toBe('chunked');
    expect(at(bytes, 0, 2)).toEqual(ESC_INIT);
    expect(at(bytes, 2, 3)).toEqual(LINE_SPACING_0);
    expect(at(bytes, 5, 2)).toEqual(GS_STAR);
    expect(tail(bytes, 4)).toEqual(FLUSH_CUT);
  });

  it('tape: the renderer prints one upright raster, as the print route reports', () => {
    const bytes = createTapeRenderer({}).toEscpos();
    expect(at(bytes, 0, 2)).toEqual(ESC_INIT);
    expect(at(bytes, 2, 4)).toEqual(GS_V0);
    expect(tail(bytes, 4)).not.toEqual(FLUSH_CUT);
  });
});

describe('stored job kind and encoding', () => {
  it('createJob stores kind template with the render encoding', async () => {
    const o = owner();
    const { id } = await createJob(o, {
      template: TEXT,
      data: {},
      name: 'text',
      source: 'test',
    });
    const job = await getJob(o, id);
    expect(job?.kind).toBe('template');
    expect(job?.encoding).toEqual(RASTER);
  });

  it('createRawJob gives kind raw, with the encoding when one is passed', async () => {
    const o = owner();
    const raw = {
      name: 'raw',
      source: 'test',
      bytes: Buffer.from([0x1b, 0x40, 0x0a]),
      png: Buffer.from('png'),
      width: 576,
      height: 1,
    };
    const plain = await createRawJob(o, raw);
    const tape = await createRawJob(o, {
      ...raw,
      encoding: { ...RASTER, encoder: 'tape-renderer/1' },
    });

    const plainJob = await getJob(o, plain.id);
    expect(plainJob?.kind).toBe('raw');
    expect(plainJob?.encoding).toBeNull();
    expect(plainJob?.template).toBeNull();
    expect((await getJob(o, tape.id))?.encoding).toEqual({
      ...RASTER,
      encoder: 'tape-renderer/1',
    });
  });

  it('listJobs exposes kind and hasTemplate, and no image URL locally', async () => {
    const o = owner();
    const t = await createJob(o, {
      template: TEXT,
      data: {},
      name: 'text',
      source: 'test',
    });
    const r = await createRawJob(o, {
      name: 'raw',
      source: 'test',
      bytes: Buffer.from([0x1b, 0x40]),
      png: Buffer.from('png'),
      width: 576,
      height: 1,
    });
    const byId = Object.fromEntries(
      (await listJobs(o, 10)).map((j) => [j.id, j]),
    );
    // Local rows keep the PNG inline: no public URL (/api/jobs/png serves it).
    expect(byId[t.id]).toMatchObject({
      kind: 'template',
      hasTemplate: true,
      imageUrl: null,
    });
    expect(byId[r.id]).toMatchObject({
      kind: 'raw',
      hasTemplate: false,
      imageUrl: null,
    });
  });
});
