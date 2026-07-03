// lib/plugin-registry.js — plugin registry storage facade.
// A registry record describes one installed plugin for one owner:
//   { id, ownerId, enabled, intervalSeconds, lastRunAt, config, state,
//     lastError, lastErrorAt }
//
// Same interface, two drivers, selected by STORE_DRIVER (json: data/plugins.json,
// redis: Upstash). Callers never know which is active. The run-lock functions
// are the overlap guard used by /tick so a slow plugin is never run twice
// concurrently.

import { STORE_DRIVER } from '../config.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/plugins-redis.js')
  : await import('./stores/plugins-json.js');

export const listPlugins = impl.listPlugins;
export const getPlugin = impl.getPlugin;
export const upsertPlugin = impl.upsertPlugin;
export const setEnabled = impl.setEnabled;
export const updateState = impl.updateState;
export const updateConfig = impl.updateConfig;
export const tryAcquireRunLock = impl.tryAcquireRunLock;
export const releaseRunLock = impl.releaseRunLock;
