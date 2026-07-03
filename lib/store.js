// lib/store.js — template storage facade.
// Same interface, two drivers: json (local dev, data/templates.json) and
// redis (hosted, Upstash). Selected by STORE_DRIVER; callers never know
// which is active. All functions are async except isReadOnly.

import { STORE_DRIVER } from '../config.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/templates-redis.js')
  : await import('./stores/templates-json.js');

export const isReadOnly = impl.isReadOnly;
export const getTemplates = impl.getTemplates;
export const saveTemplate = impl.saveTemplate;
export const deleteTemplate = impl.deleteTemplate;
