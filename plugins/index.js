// plugins/index.js — explicit list of installed plugin modules.
// Static imports (not directory scanning) so Vercel's bundler traces them.
// A plugin module exports: id, meta, defaults { enabled, schedule?, config },
// templates, configLabels, and a trigger: run({ config, state, ctx }) ->
// { state } on a schedule ({ every: seconds } or { at: "HH:MM", timezone },
// lib/schedule.js), and/or onMessage(envelope, { config, state, ctx }) ->
// { state, reply } for pushed messages (lib/ops/messages.js). Optional
// hooks.credentials lists config keys the runner mints (lib/plugin-setup.js).
// Heavy dependencies load inside the code path that uses them, so this
// list stays light for /ingest and the Slips pages.

import * as espnWorldcup from './espn-worldcup.js';
import * as morningBrief from './morning-brief.js';
import * as messageIngest from './message-ingest.js';

export const PLUGINS = [espnWorldcup, morningBrief, messageIngest];

// Derived, never declared: a module with run() and a default schedule runs
// on the tick; one with onMessage() takes pushed messages. A module that is
// not scheduled never enters the due-index (what used to be "passive").
export const isScheduled = m => typeof m.run === 'function' && !!m.defaults?.schedule;
export const takesMessages = m => typeof m.onMessage === 'function';
export const findModule = id => PLUGINS.find(m => m.id === id) ?? null;
