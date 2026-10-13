// tests/ops/templates.test.ts — the template ops (lib/ops/templates.js)
// where they hold logic: a thumbnail of a template the owner does not have
// is not_found (the route answers 404), never a render; a preview of a
// draft with a Liquid error or a Satori layout error is invalid (the
// route answers 400 and logs nothing), since the Studio previews while the
// author types. A template a plugin declares or the Photo tool prints
// with cannot be deleted (conflict, naming who uses it).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as thumbRoute } from '@/app/api/templates/thumb/route';
import { POST as previewRoute } from '@/app/preview/route';
import { DELETE as deleteRoute } from '@/app/templates/route';
import { userCaller } from '@/lib/ops/caller.js';
import { slipsRegister } from '@/lib/ops/slips.js';
import {
  templatesDelete,
  templatesList,
  templatesPreview,
  templatesSave,
  templatesThumb,
} from '@/lib/ops/templates.js';
import { PLUGINS } from '@/plugins/index.js';

// PRINT_WIDTH and FONT_DIR forced to their defaults (as
// tests/job-kind.test.ts does), so a developer's .env cannot change what
// renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-templates`;
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

function account() {
  const id = `owner-${randomUUID()}`;
  return { id, caller: userCaller({ userId: id, role: 'user' }) };
}

describe('templates.thumb', () => {
  it('raises not_found for a template the owner does not have; the route answers 404', async () => {
    const a = account();
    const other = account();
    // Another owner's template of the same name is not this owner's.
    await templatesSave(other.caller, {
      name: 'Note',
      template: '<div>{{ title }}</div>',
      data: { title: 'x' },
    });

    await expect(
      templatesThumb(a.caller, { name: 'Note' }),
    ).rejects.toMatchObject({
      name: 'OpError',
      code: 'not_found',
      message: 'template not found',
    });

    const res = await thumbRoute(
      new Request('http://docket.test/api/templates/thumb?name=Note', {
        headers: { 'x-test-user': `${a.id}:user` },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'template not found' });
  });
});

describe('templates.preview', () => {
  const preview = (a: ReturnType<typeof account>, template: string) =>
    previewRoute(
      new Request('http://docket.test/preview', {
        method: 'POST',
        headers: { 'x-test-user': `${a.id}:user` },
        body: JSON.stringify({ template, data: { who: 'x' } }),
      }),
    );

  it('raises invalid for a Liquid or Satori layout error; the route answers 400 and logs nothing', async () => {
    const a = account();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const draft of [
        '<div>{{ who </div>', // unclosed output: parse error
        '<div>{% if who %}</div>', // unclosed tag: parse error
        '<div>{{ who | append }}</div>', // filter missing its argument: render error
        '<div><span>{{ who }}</span><span>b</span></div>', // two children, no display:flex
        '<div style="display:flex;transform: rota">{{ who }}</div>', // half-typed CSS value
        '<div style="display:flex"><img src="logo.png" width="8" height="8"/></div>', // relative src
      ]) {
        const err = await templatesPreview(a.caller, { template: draft }).catch(
          (e) => e,
        );
        expect(err, draft).toMatchObject({ name: 'OpError', code: 'invalid' });
        expect(err.message, draft).toBeTruthy();

        const res = await preview(a, draft);
        expect(res.status, draft).toBe(400);
        expect(await res.json(), draft).toEqual({ error: err.message });
      }
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('still renders a valid draft to a PNG', async () => {
    const a = account();
    const res = await preview(
      a,
      '<div style="display:flex;font-size:28px">{{ who }}</div>',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Number(res.headers.get('x-image-width'))).toBe(576);
  });
});

describe('templates.delete', () => {
  const names = async (a: ReturnType<typeof account>) =>
    ((await templatesList(a.caller)) as { name: string }[]).map((t) => t.name);

  it("refuses every plugin's templates and the Photo tool's with conflict, naming the user", async () => {
    const a = account();
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    await slipsRegister(a.caller); // seeds the plugin and Photo templates
    quiet.mockRestore();
    const used: [string, string][] = [['Photo Print', 'Photo']];
    for (const m of PLUGINS as unknown as {
      templates?: string[];
      meta: { title: string };
    }[]) {
      for (const name of m.templates || []) used.push([name, m.meta.title]);
    }
    expect(used.map(([name]) => name)).toEqual(
      expect.arrayContaining(['WC Goal', 'Daily Brief', 'Task']),
    );
    const before = await names(a);
    for (const [name] of used) expect(before, name).toContain(name);

    for (const [name, title] of used) {
      await expect(
        templatesDelete(a.caller, { name }),
        name,
      ).rejects.toMatchObject({
        name: 'OpError',
        code: 'conflict',
        message: `This template is used by ${title}`,
      });
    }
    expect(await names(a)).toEqual(before);

    // The Studio's DELETE /templates answers 409 with the message.
    const res = await deleteRoute(
      new Request('http://docket.test/templates?name=WC%20Goal', {
        method: 'DELETE',
        headers: { 'x-test-user': `${a.id}:user` },
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This template is used by World Cup watcher',
    });
    expect(await names(a)).toEqual(before);
  });

  it('still deletes a template nothing prints with', async () => {
    const a = account();
    await templatesSave(a.caller, {
      name: 'Note',
      template: '<div>{{ title }}</div>',
      data: { title: 'x' },
    });
    // A near miss of a protected name is an ordinary template.
    await templatesSave(a.caller, {
      name: 'Photo Print copy',
      template: '<div>{{ title }}</div>',
      data: { title: 'x' },
    });
    expect(await names(a)).toEqual(
      expect.arrayContaining(['Note', 'Photo Print copy']),
    );
    const left = (await templatesDelete(a.caller, { name: 'Note' })) as {
      name: string;
    }[];
    expect(left.map((t) => t.name)).not.toContain('Note');
    await templatesDelete(a.caller, { name: 'Photo Print copy' });
    expect(await names(a)).not.toContain('Photo Print copy');
  });
});
