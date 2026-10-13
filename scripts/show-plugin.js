// scripts/show-plugin.js — inspect a plugin registry record.
//
//   node scripts/show-plugin.js <pluginId>
//
// Calls the slips.get operation as the configured owner (OWNER_ID), so it
// works with both drivers (STORE_DRIVER=json|redis). Credential values
// (message-ingest's ingestToken) are left out of config: the op shows them
// only to a signed-in user, on the Slips page.

import { OWNER_ID } from '../config.js';
import { systemCaller } from '../lib/ops/caller.js';
import { slipsGet } from '../lib/ops/slips.js';

const pluginId = process.argv[2];
if (!pluginId) {
  console.error('usage: node scripts/show-plugin.js <pluginId>');
  process.exit(1);
}

let record;
try {
  ({ record } = await slipsGet(systemCaller(OWNER_ID, 'cli:show-plugin'), { id: pluginId }));
} catch (err) {
  console.error(`${pluginId}: ${err.message} (owner "${OWNER_ID}")`);
  process.exit(1);
}
// null until the owner's first Slips page view registers the module.
if (!record) {
  console.error(`${pluginId}: not registered (owner "${OWNER_ID}")`);
  process.exit(1);
}

const { state, ...rest } = record;
console.log(JSON.stringify(rest, null, 2));

// Summarize state instead of dumping raw JSON. The espn-worldcup state is a
// map of matchId -> per-match tracking; other plugins fall back to key count.
const entries = Object.entries(state || {});
console.log(`\nstate (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}):`);

if (pluginId === 'espn-worldcup') {
  for (const [matchId, m] of entries) {
    const printed = m.printedHome !== undefined
      ? `printed ${m.printedHome}-${m.printedAway}`
      : `printed keys: ${(m.printedGoalKeys || []).length} (legacy)`;
    console.log(
      `  ${matchId}  [${m.state}]  ${m.homeScore}-${m.awayScore}  ` +
      `kickoff:${m.kickoffPrinted ? 'y' : 'n'} fulltime:${m.fulltimePrinted ? 'y' : 'n'}  ${printed}`
    );
  }
} else {
  for (const [key, value] of entries) {
    const preview = JSON.stringify(value);
    console.log(`  ${key}: ${preview.length > 100 ? preview.slice(0, 100) + '…' : preview}`);
  }
}
