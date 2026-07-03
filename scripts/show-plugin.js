// scripts/show-plugin.js — inspect a plugin registry record.
//
//   node scripts/show-plugin.js <pluginId>
//
// Goes through the plugin-registry facade, so it works with both drivers
// (STORE_DRIVER=json|redis) and the configured owner.

import { OWNER_ID, STORE_DRIVER } from '../config.js';
import { getPlugin } from '../lib/plugin-registry.js';

const pluginId = process.argv[2];
if (!pluginId) {
  console.error('usage: node scripts/show-plugin.js <pluginId>');
  process.exit(1);
}

const record = await getPlugin(OWNER_ID, pluginId);
if (!record) {
  console.error(`plugin "${pluginId}" not found for owner "${OWNER_ID}" (${STORE_DRIVER} driver)`);
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
