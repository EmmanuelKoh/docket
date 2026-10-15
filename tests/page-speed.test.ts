// tests/page-speed.test.ts — dashboard page speed, on the page side. The
// dashboard layout waits on nothing but the session: the panel's printer
// line is a Suspense slot that reads printers.overview and jobs.queueSize
// (never a job listing), and Home takes its printer state and waiting
// count from the same reads, with one bounded listing of today's prints.
// loading.tsx is the skeleton Next shows meanwhile.
// Slip previews carry their template's updatedAt (and the deploy's short
// commit hash, when set) as ?v=, so a save or a deploy changes the URL.
// Studio links are client-side (next/link).

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getSlip, listSlips, thumbSrc } from '@/app/_lib/slip-data';
import { type Caller, userCaller } from '@/lib/ops/caller.js';
import { jobsCreateRaw, jobsList, jobsQueueSize } from '@/lib/ops/jobs.js';
import { printersOverview } from '@/lib/ops/printers.js';
import { slipsRegister } from '@/lib/ops/slips.js';
import { templatesList, templatesSave } from '@/lib/ops/templates.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/page-speed`;
});

// Pages and the layout read the session through getCaller; here it is
// whoever the test says.
const session = vi.hoisted(() => ({ caller: null as Caller | null }));
vi.mock('@/app/_lib/caller', () => ({
  getCaller: async () => session.caller,
  requestCaller: async () => session.caller,
}));
// Pages read the viewer's time zone from a cookie; no request here.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
// The real ops, watched.
vi.mock('@/lib/ops/jobs.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ops/jobs.js')>();
  return {
    ...real,
    jobsList: vi.fn(real.jobsList),
    jobsQueueSize: vi.fn(real.jobsQueueSize),
  };
});
vi.mock('@/lib/ops/printers.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ops/printers.js')>();
  return { ...real, printersOverview: vi.fn(real.printersOverview) };
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ROOT = path.resolve(__dirname, '..');
const account = () => {
  const caller = userCaller({ userId: `owner-${randomUUID()}`, role: 'user' });
  session.caller = caller;
  return caller;
};
const listCalls = () => vi.mocked(jobsList).mock.calls;
const sizeCalls = () => vi.mocked(jobsQueueSize).mock.calls;
const overviewCalls = () => vi.mocked(printersOverview).mock.calls;
const clearCalls = () => {
  vi.mocked(jobsList).mockClear();
  vi.mocked(jobsQueueSize).mockClear();
  vi.mocked(printersOverview).mockClear();
};

// What printers.overview answers for an account with one printer.
const onePrinter = (caller: Caller, online: boolean) => ({
  devices: [
    {
      id: 'device-1',
      name: 'Kitchen printer',
      pairedAt: new Date().toISOString(),
      role: 'owner',
      primaryOwnerId: caller.ownerId,
      members: [],
    },
  ],
  status: { lastSeenAt: new Date().toISOString(), online },
});

// Two queued jobs and one a printer holds.
async function threeLive(caller: Caller) {
  for (let i = 0; i < 3; i++) {
    await jobsCreateRaw(caller, {
      bytes: Buffer.from([0x1b, 0x40, 0x0a]).toString('base64'),
      png: Buffer.from('png').toString('base64'),
      width: 576,
      height: 1,
      name: `live ${i}`,
      source: 'test',
    });
  }
  const { getQueue } = await import('@/lib/queue/index.js');
  expect(await (await getQueue()).claim(caller.ownerId as string)).toBeTruthy();
}

// Depth-first search of a React element tree (props.children and any
// element-valued prop) for elements whose type is `type`.
function findAll(node: unknown, type: unknown, out: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, type, out);
  } else if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    for (const v of Object.values(node.props as object)) findAll(v, type, out);
  }
  return out;
}

describe('the dashboard layout', () => {
  it('waits on no store read: the printer line is a Suspense slot', async () => {
    const caller = account();
    const { default: DashboardLayout } = await import(
      '@/app/(dashboard)/layout'
    );
    const { PrinterStatus } = await import('@/app/(dashboard)/printer-status');
    const { AppSidebar } = await import('@/components/app-sidebar');
    clearCalls();

    const shell = await DashboardLayout({ children: null });
    expect(listCalls()).toEqual([]);
    expect(sizeCalls()).toEqual([]);
    expect(overviewCalls()).toEqual([]);

    const [sidebar] = findAll(shell, AppSidebar);
    const slot = (sidebar.props as { status: ReactElement }).status;
    expect(slot.type).toBe(Suspense);
    const [line] = findAll(slot, PrinterStatus);
    expect((line.props as { caller: Caller }).caller).toBe(caller);
  });

  it('the printer line reads printers.overview and jobs.queueSize, never a job listing', async () => {
    const caller = account();
    const { PrinterStatus } = await import('@/app/(dashboard)/printer-status');
    const line = async () =>
      renderToStaticMarkup((await PrinterStatus({ caller })) as ReactElement);

    clearCalls();
    expect(await line()).toContain('No printer');
    expect(overviewCalls()).toEqual([[caller]]);
    expect(sizeCalls()).toEqual([[caller]]);
    expect(listCalls()).toEqual([]);

    vi.mocked(printersOverview).mockResolvedValueOnce(onePrinter(caller, true));
    const online = await line();
    expect(online).toContain('Kitchen printer');
    expect(online).toContain('Online');
    expect(online).toContain('hw-led--on');

    // a printer that holds a job is printing: red LED, red word
    await threeLive(caller);
    vi.mocked(printersOverview).mockResolvedValueOnce(onePrinter(caller, true));
    const printing = await line();
    expect(printing).toContain('Printing');
    expect(printing).toContain('hw-led--red');
    expect(printing).toMatch(/class="[^"]*text-red[^"]*">Printing</);

    // not seen for 90 seconds: offline, whatever it held
    vi.mocked(printersOverview).mockResolvedValueOnce(
      onePrinter(caller, false),
    );
    const offline = await line();
    expect(offline).toContain('Offline');
    expect(offline).not.toMatch(/hw-led--(on|red)/);
    expect(listCalls()).toEqual([]);
  });

  it('a failed read shows no printer line instead of breaking the shell', async () => {
    const { PrinterStatus } = await import('@/app/(dashboard)/printer-status');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(printersOverview).mockRejectedValueOnce(new Error('neon down'));
    expect(await PrinterStatus({ caller: account() })).toBeNull();
    expect(logged).toHaveBeenCalledWith('[printer status]', expect.any(Error));
    logged.mockRestore();
  });
});

describe('Home', () => {
  it('lists today from one bounded read and takes the printer and waiting count from the shared reads', async () => {
    const caller = account();
    await threeLive(caller);
    const { default: HomePage } = await import('@/app/(dashboard)/page');
    clearCalls();

    const html = renderToStaticMarkup(await HomePage());
    expect(listCalls()).toEqual([
      [caller, { limit: 20, status: ['inflight', 'done'] }],
    ]);
    expect(sizeCalls()).toEqual([[caller]]);
    expect(overviewCalls()).toEqual([[caller]]);
    // the job a printer holds feeds out of the printer, captioned Printing
    expect(html).toContain('Printing');
    expect(html).toContain('2 waiting');
    expect(html).toContain('No printer yet');
    // the printed title, not a stat grid
    expect(html).toMatch(/<h1 class="hw-title[^"]*"[^>]*>Today<\/h1>/);
  });
});

describe('loading.tsx', () => {
  it('is a skeleton announced as loading: a module with three rows, still and never red', async () => {
    const { default: DashboardLoading } = await import(
      '@/app/(dashboard)/loading'
    );
    const html = renderToStaticMarkup(DashboardLoading());
    expect(html).toMatch(/^<div role="status"/);
    expect(html).toContain('<span class="sr-only">Loading</span>');
    expect(html).toContain('class="hw-plate"');
    expect(html.match(/class="hw-row[ "]/g)).toHaveLength(3);
    expect(html).not.toMatch(/text-red|bg-red|hw-led--red|key-red|flag/);
    expect(html).not.toMatch(/animate-/); // E moves only when pressed
  });
});

describe('slip previews', () => {
  it('carry the template updatedAt as v, and a save changes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const caller = account();
      vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
      await templatesSave(caller, {
        name: 'Note & Co',
        template: '<div>{{ title }}</div>',
        data: { title: 'a' },
      });
      const versionOf = async () => {
        const [t] = (await templatesList(caller)) as { updatedAt: string }[];
        return Date.parse(t.updatedAt);
      };
      const first = await versionOf();
      const thumb = async () =>
        (await listSlips(caller)).find((s) => s.slug === 'Note & Co')?.thumb;
      expect(await thumb()).toBe(
        `/api/templates/thumb?name=Note+%26+Co&v=${first}`,
      );
      expect((await getSlip(caller, 'Note & Co'))?.thumb).toBe(await thumb());

      vi.setSystemTime(Date.parse('2026-10-12T10:00:00Z'));
      await templatesSave(caller, {
        name: 'Note & Co',
        template: '<div>{{ title }}!</div>',
        data: { title: 'a' },
      });
      const second = await versionOf();
      expect(second).not.toBe(first);
      expect(await thumb()).toBe(
        `/api/templates/thumb?name=Note+%26+Co&v=${second}`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a system slip's preview is versioned by its primary template", async () => {
    const caller = account();
    await slipsRegister(caller); // seeds the plugins' templates
    const brief = (await templatesList(caller)) as {
      name: string;
      updatedAt: string;
    }[];
    const daily = brief.find((t) => t.name === 'Daily Brief');
    if (!daily) throw new Error('Daily Brief was not seeded');
    const slip = await getSlip(caller, 'morning-brief');
    expect(slip?.thumb).toBe(
      thumbSrc('Daily Brief', Date.parse(daily.updatedAt)),
    );
    expect(slip?.thumb).toMatch(/[?&]v=\d+$/);
    expect(
      (await listSlips(caller)).find((s) => s.slug === 'morning-brief')?.thumb,
    ).toBe(slip?.thumb);
  });

  it('without a version the URL has none (the route then caches briefly)', () => {
    expect(thumbSrc('Note')).toBe('/api/templates/thumb?name=Note');
    expect(thumbSrc('Note', null, 'abc1234')).toBe(
      '/api/templates/thumb?name=Note',
    );
    expect(thumbSrc(null)).toBeNull();
  });

  it("the version carries the deploy's short commit hash when Vercel sets one", async () => {
    expect(thumbSrc('Note', 1700000000000, 'abc1234')).toBe(
      '/api/templates/thumb?name=Note&v=1700000000000-abc1234',
    );
    vi.stubEnv(
      'VERCEL_GIT_COMMIT_SHA',
      '0123456789abcdef0123456789abcdef01234567',
    );
    vi.resetModules();
    try {
      const { DEPLOY_VERSION } = await import('@/config.js');
      expect(DEPLOY_VERSION).toBe('0123456');
      const fresh = await import('@/app/_lib/slip-data');
      expect(fresh.thumbSrc('Note', 1700000000000)).toBe(
        '/api/templates/thumb?name=Note&v=1700000000000-0123456',
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('Studio links', () => {
  it('are next/link everywhere: no plain <a> to /studio in app/ or components/', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          if (/<a\s[^>]*href=\{?[`'"]\/studio/.test(src)) {
            offenders.push(path.relative(ROOT, p));
          }
        }
      }
    };
    walk(path.join(ROOT, 'app'));
    walk(path.join(ROOT, 'components'));
    expect(offenders).toEqual([]);

    // and the ones the plan names are Links
    for (const f of [
      'app/(dashboard)/slips/page.tsx',
      'app/(dashboard)/slips/[slug]/page.tsx',
    ]) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      // a Link, or a link key (PushKey with href renders a Link)
      expect(src, f).toMatch(/<(Link|PushKey)\s[^>]*href=\{?[`'"]\/studio/);
    }
  });
});
