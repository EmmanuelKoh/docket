// scripts/toggle-plugin.js — enable or disable a plugin registry record.
//
//   node scripts/toggle-plugin.js <pluginId> on|off
//
// Calls the slips.setEnabled operation as the configured owner (OWNER_ID),
// so it works with both drivers (STORE_DRIVER=json|redis).

import { OWNER_ID } from '../config.js';
import { systemCaller } from '../lib/ops/caller.js';
import { slipsSetEnabled } from '../lib/ops/slips.js';

const [pluginId, mode] = process.argv.slice(2);
if (!pluginId || !['on', 'off'].includes(mode)) {
  console.error('usage: node scripts/toggle-plugin.js <pluginId> on|off');
  process.exit(1);
}
try {
  const caller = systemCaller(OWNER_ID, 'cli:toggle-plugin');
  const { record } = await slipsSetEnabled(caller, { id: pluginId, enabled: mode === 'on' });
  console.log(`${pluginId}: enabled = ${record.enabled}`);
  // The open PGlite handle keeps the event loop alive; exit explicitly.
  process.exit(0);
} catch (err) {
  console.error(`${pluginId}: ${err.message} (owner "${OWNER_ID}")`);
  process.exit(1);
}
