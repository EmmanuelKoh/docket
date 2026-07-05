// plugins/index.js — explicit list of installed plugin modules.
// Static imports (not directory scanning) so Vercel's bundler traces them.
// A plugin module exports: id, defaults { intervalSeconds, config }, and
// async run({ config, state, ctx }) -> { state }.

import * as espnWorldcup from './espn-worldcup.js';
import * as morningBrief from './morning-brief.js';
import * as messageIngest from './message-ingest.js';

export const PLUGINS = [espnWorldcup, morningBrief, messageIngest];
