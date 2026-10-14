// tests/brief-feeds.test.ts — the morning brief's calendar addresses are
// owner input, so they are fetched under the image guard's address rules
// (render/image-guard.js fetchPublic), never with a plain fetch: http or
// https on the default port, every resolved address public, the
// connection pinned to the addresses checked, each redirect checked the
// same way, 10 seconds and 5 MB. webcal:// is https://. A refused feed
// throws like a failed one, so the tick runner records lastError. DNS and
// the transport are swapped out through imageDeps; the global fetch
// records any call, and none may happen for a feed.

import http from 'node:http';
import type net from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FEED_LIMITS, feedUrl, run } from '@/plugins/morning-brief.js';
import { imageDeps } from '@/render/image-guard.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/brief-feeds`;
});

const fetched: string[] = [];
beforeAll(() => {
  vi.stubGlobal('fetch', (input: unknown) => {
    fetched.push(String(input));
    throw new Error('network access is disabled in tests');
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const ICS =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//docket test//EN\r\nEND:VCALENDAR\r\n';

type Address = { address: string; family: number };
type Reply = { status: number; headers: Record<string, string>; body: Buffer };

const DNS: Record<string, Address[]> = {
  'public.test': [{ address: '93.184.216.34', family: 4 }],
  'six.test': [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }],
  'internal.test': [{ address: '10.0.0.5', family: 4 }],
  'loopback.test': [{ address: '127.0.0.1', family: 4 }],
  'cgnat.test': [{ address: '100.64.1.1', family: 4 }],
  'mixed.test': [
    { address: '93.184.216.34', family: 4 },
    { address: '192.168.1.10', family: 4 },
  ],
  'mapped.test': [{ address: '::ffff:192.168.1.1', family: 6 }],
  'translated.test': [{ address: '::ffff:0:7f00:1', family: 6 }],
  'ula.test': [{ address: 'fd00::1', family: 6 }],
};

let replies: Record<string, Reply> = {};
const requests: { url: string; addresses: Address[]; maxBytes: number }[] = [];

beforeEach(() => {
  replies = {};
  requests.length = 0;
  fetched.length = 0;
  vi.spyOn(imageDeps, 'lookup').mockImplementation(async (host: string) => {
    const found =
      DNS[host] ??
      (/^[\d.]+$|:/.test(host)
        ? [{ address: host, family: host.includes(':') ? 6 : 4 }]
        : null);
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  });
  vi.spyOn(imageDeps, 'request').mockImplementation(
    async (
      url: URL,
      { addresses, maxBytes }: { addresses: Address[]; maxBytes: number },
    ) => {
      requests.push({ url: url.href, addresses, maxBytes });
      return (
        replies[url.href] ?? {
          status: 200,
          headers: { 'content-type': 'text/calendar' },
          body: Buffer.from(ICS),
        }
      );
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

function context() {
  const jobs: unknown[] = [];
  return {
    jobs,
    ctx: {
      getTemplate: async () => ({
        template: '<div style="display:flex">x</div>',
      }),
      createJob: async (job: unknown) => {
        jobs.push(job);
        return { id: 'job-1' };
      },
      log: () => {},
    },
  };
}

// Runs the brief on one feed; resolves to the error it throws, or null.
async function briefWith(address: string) {
  const { ctx, jobs } = context();
  try {
    await run({
      config: {
        icsUrls: [address],
        timezone: 'UTC',
        latitude: null,
        longitude: null,
      },
      state: {},
      ctx: ctx as never,
    });
    expect(jobs).toHaveLength(1);
    return null;
  } catch (err) {
    expect(jobs).toEqual([]);
    return err as Error;
  }
}

describe('feeds the brief refuses', () => {
  it('a host that is or resolves to a non-public address, with no request made', async () => {
    for (const address of [
      'http://127.0.0.1/cal.ics',
      'http://loopback.test/cal.ics',
      'https://169.254.169.254/latest/meta-data/',
      'http://[::1]/cal.ics',
      'http://[::ffff:127.0.0.1]/cal.ics',
      'http://[::ffff:0:7f00:1]/cal.ics',
      'http://[fd00::1]/cal.ics',
      'http://[fe80::1]/cal.ics',
      'http://0.0.0.0/cal.ics',
      'http://224.0.0.1/cal.ics',
      'https://internal.test/cal.ics',
      'webcal://internal.test/cal.ics',
      'http://cgnat.test/cal.ics',
      'http://mixed.test/cal.ics',
      'http://mapped.test/cal.ics',
      'http://translated.test/cal.ics',
      'http://ula.test/cal.ics',
    ]) {
      const err = await briefWith(address);
      expect(err?.message, address).toMatch(
        /^calendar feed: .* is not public$/,
      );
    }
    expect(requests).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it('another scheme or port, or a user and password', async () => {
    for (const address of [
      'ftp://public.test/cal.ics',
      'file:///etc/passwd',
      'http://public.test:8080/cal.ics',
      'https://public.test:8443/cal.ics',
      'https://user:pw@public.test/cal.ics',
    ]) {
      const err = await briefWith(address);
      expect(err?.message, address).toBe(
        'calendar feed: only https or http on the default port',
      );
    }
    expect((await briefWith('not a url'))?.message).toBe(
      'calendar feed address is not a URL',
    );
    expect(requests).toEqual([]);
  });

  it('a redirect to a private host, checked before it is followed', async () => {
    replies['https://public.test/cal.ics'] = {
      status: 302,
      headers: { location: 'http://internal.test/cal.ics' },
      body: Buffer.alloc(0),
    };
    const err = await briefWith('https://public.test/cal.ics');
    expect(err?.message).toBe(
      'calendar feed: internal.test resolves to 10.0.0.5, which is not public',
    );
    expect(requests.map((r) => r.url)).toEqual(['https://public.test/cal.ics']);
  });

  it('a feed over 5 MB, and one that takes too long', async () => {
    replies['https://public.test/big.ics'] = {
      status: 200,
      headers: {},
      body: Buffer.alloc(FEED_LIMITS.maxBytes + 1),
    };
    expect((await briefWith('https://public.test/big.ics'))?.message).toBe(
      'calendar feed: response is over the size limit',
    );
    expect(requests[0].maxBytes).toBe(5 * 1024 * 1024);

    const saved = FEED_LIMITS.timeoutMs;
    FEED_LIMITS.timeoutMs = 50;
    try {
      vi.mocked(imageDeps.request).mockImplementation(
        () => new Promise(() => {}),
      );
      expect(
        (await briefWith('https://public.test/slow.ics'))?.message,
      ).toMatch(/^calendar feed: .*(timeout|aborted)/i);
    } finally {
      FEED_LIMITS.timeoutMs = saved;
    }
  });

  it('an answer that is not 200 fails as before', async () => {
    replies['https://public.test/gone.ics'] = {
      status: 404,
      headers: {},
      body: Buffer.alloc(0),
    };
    expect((await briefWith('https://public.test/gone.ics'))?.message).toBe(
      'calendar feed 404',
    );
  });
});

describe('feeds the brief fetches', () => {
  it('https, http and webcal, connecting only to the checked addresses', async () => {
    for (const [address, url, host] of [
      ['https://public.test/a.ics', 'https://public.test/a.ics', 'public.test'],
      ['http://public.test/b.ics', 'http://public.test/b.ics', 'public.test'],
      ['webcal://six.test/c.ics', 'https://six.test/c.ics', 'six.test'],
      [
        'WEBCALS://public.test/d.ics',
        'https://public.test/d.ics',
        'public.test',
      ],
    ]) {
      requests.length = 0;
      expect(await briefWith(address), address).toBeNull();
      expect(requests).toEqual([
        { url, addresses: DNS[host], maxBytes: FEED_LIMITS.maxBytes },
      ]);
    }
    expect(fetched).toEqual([]);
  });

  it('follows a redirect to another public host', async () => {
    replies['https://public.test/old.ics'] = {
      status: 301,
      headers: { location: 'http://six.test/new.ics' },
      body: Buffer.alloc(0),
    };
    expect(await briefWith('https://public.test/old.ics')).toBeNull();
    expect(requests.map((r) => r.url)).toEqual([
      'https://public.test/old.ics',
      'http://six.test/new.ics',
    ]);
  });

  it('maps webcal:// to https://', () => {
    expect(feedUrl(' webcal://example.test/x.ics ').href).toBe(
      'https://example.test/x.ics',
    );
    expect(feedUrl('http://example.test/x.ics').href).toBe(
      'http://example.test/x.ics',
    );
  });
});

describe('the http transport', () => {
  it('connects to the pinned address over http, not to what the hostname resolves to', async () => {
    vi.mocked(imageDeps.request).mockRestore(); // the real transport
    const server = http.createServer((_req, res) => res.end(ICS));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as net.AddressInfo;
    try {
      const res = await imageDeps.request(
        new URL(`http://no-such-host.invalid:${port}/cal.ics`),
        {
          addresses: [{ address: '127.0.0.1', family: 4 }],
          signal: AbortSignal.timeout(5000),
          maxBytes: 1024,
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe(ICS);
    } finally {
      server.close();
    }
  });
});
