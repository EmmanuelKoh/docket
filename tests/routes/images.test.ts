// tests/routes/images.test.ts — how the dashboard's images are cached and
// addressed. A slip preview with a version (?v=, the template's
// updatedAt) is kept by the browser for good, one without keeps the short
// cache. Job PNGs from /jobs?png are private.
// Locally (inline rows) every job image goes through /api/jobs/png: the
// Queue poll's rows say so.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as jobPngRoute } from '@/app/api/jobs/png/route';
import { GET as queueRoute } from '@/app/api/queue/route';
import { GET as thumbRoute } from '@/app/api/templates/thumb/route';
import { GET as jobsRoute } from '@/app/jobs/route';
import { userCaller } from '@/lib/ops/caller.js';
import { jobsCreateRaw } from '@/lib/ops/jobs.js';
import { templatesSave } from '@/lib/ops/templates.js';

// Own DATA_DIR subfolder; PRINT_WIDTH and FONT_DIR at their defaults as
// tests/golden-escpos.test.ts does, so a developer's .env cannot change
// what renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/routes-images`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;
const get = (
  route: (req: Request) => Promise<Response>,
  path: string,
  who: string | null,
) =>
  route(
    new Request(`http://docket.test${path}`, {
      headers: who ? { 'x-test-user': `${who}:user` } : {},
    }),
  );

const PNG = Buffer.from('a png');
async function rawJob(o: string) {
  const { id } = await jobsCreateRaw(userCaller({ userId: o, role: 'user' }), {
    bytes: Buffer.from([0x1b, 0x40, 0x0a]).toString('base64'),
    png: PNG.toString('base64'),
    width: 576,
    height: 1,
    name: 'raw',
    source: 'test',
  });
  return id;
}

describe('GET /api/templates/thumb', () => {
  it('caches a versioned preview for good, an unversioned one briefly', async () => {
    const o = owner();
    await templatesSave(userCaller({ userId: o, role: 'user' }), {
      name: 'Note',
      template: '<div style="display:flex">{{ title }}</div>',
      data: { title: 'hello' },
    });

    const versioned = await get(
      thumbRoute,
      '/api/templates/thumb?name=Note&v=1760000000000',
      o,
    );
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get('content-type')).toBe('image/png');
    expect(versioned.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    );

    const plain = await get(thumbRoute, '/api/templates/thumb?name=Note', o);
    expect(plain.status).toBe(200);
    expect(plain.headers.get('cache-control')).toBe('private, max-age=300');
  });

  it('caches no refusal', async () => {
    const o = owner();
    const missing = await get(
      thumbRoute,
      '/api/templates/thumb?name=Nope&v=1',
      o,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBeNull();
    const anonymous = await get(
      thumbRoute,
      '/api/templates/thumb?name=Note&v=1',
      null,
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBeNull();
  });
});

describe('job images, local', () => {
  it('GET /jobs?png sends the PNG for private caching only', async () => {
    const o = owner();
    const id = await rawJob(o);
    const res = await get(jobsRoute, `/jobs?png=${id}`, o);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it('rows have no public URL, so pages load them through /api/jobs/png', async () => {
    const o = owner();
    const id = await rawJob(o);

    const listed = await (await get(jobsRoute, '/jobs?limit=5', o)).json();
    expect(listed).toMatchObject([{ id, imageUrl: null }]);

    const queue = await (await get(queueRoute, '/api/queue', o)).json();
    expect(queue.jobs).toMatchObject([
      { id, image: `/api/jobs/png?job=${id}` },
    ]);

    const png = await get(jobPngRoute, `/api/jobs/png?job=${id}`, o);
    expect(png.status).toBe(200);
    expect(Buffer.from(await png.arrayBuffer())).toEqual(PNG);
  });
});
