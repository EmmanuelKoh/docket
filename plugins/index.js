// plugins/index.js — explicit list of installed plugin modules.
// Static imports (not directory scanning) so Vercel's bundler traces them.
// A plugin module exports: id, defaults { schedule, config }, and
// async run({ config, state, ctx }) -> { state }. schedule is
// { every: seconds } or { at: "HH:MM", timezone } (lib/schedule.js);
// push-driven plugins export `passive: true` and no schedule.

import * as espnWorldcup from './espn-worldcup.js';
import * as morningBrief from './morning-brief.js';
import * as messageIngest from './message-ingest.js';

export const PLUGINS = [espnWorldcup, morningBrief, messageIngest];
