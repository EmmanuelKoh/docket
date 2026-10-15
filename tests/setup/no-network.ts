// tests/setup/no-network.ts — loaded before every test file
// (vitest.config.ts setupFiles). Tests stub global fetch, but some SDKs
// (@vercel/blob) send requests through undici directly, so a stub alone
// cannot keep them off the network. This sets undici's global dispatcher,
// which Node's own fetch also uses, to one that refuses every host except
// this machine. Tests that run a local server keep working; anything that
// tries to reach a cloud service fails at once instead of sending a request.

import { MockAgent, setGlobalDispatcher } from 'undici';

const agent = new MockAgent();
agent.disableNetConnect();
agent.enableNetConnect(
  (host: string) =>
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]'),
);
setGlobalDispatcher(agent);
