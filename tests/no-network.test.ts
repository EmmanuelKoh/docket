// tests/no-network.test.ts — the setup file (tests/setup/no-network.ts)
// keeps every test off the network, including SDKs that use undici
// directly rather than the global fetch tests usually stub.

import http from 'node:http';
import { request } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: http.Server;
let port = 0;
beforeAll(async () => {
  server = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(() => {
  server.close();
});

describe('network guard', () => {
  it('refuses a request to a cloud host through undici', async () => {
    await expect(request('https://blob.vercel-storage.com/')).rejects.toThrow();
  });

  it('refuses a request to a cloud host through the built-in fetch', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow();
  });

  it('still allows a local test server', async () => {
    const res = await request(`http://127.0.0.1:${port}/`);
    expect(await res.body.text()).toBe('ok');
  });
});
