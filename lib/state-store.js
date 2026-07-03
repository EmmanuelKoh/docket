// lib/state-store.js — poller/plugin state facade.
// getState(name) / setState(name, value) — same interface, two drivers:
// json (data/{name}-state.json) and redis (Upstash). Selected by
// STORE_DRIVER; callers never know which is active.

import { STORE_DRIVER } from '../config.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/state-redis.js')
  : await import('./stores/state-json.js');

export const getState = impl.getState;
export const setState = impl.setState;
