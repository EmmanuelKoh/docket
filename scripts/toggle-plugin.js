// scripts/toggle-plugin.js — enable or disable a plugin registry record.
//
//   node scripts/toggle-plugin.js <pluginId> on|off
//
// Goes through the plugin-registry facade, so it works with both drivers
// (STORE_DRIVER=json|redis) and the configured owner.

import { OWNER_ID, STORE_DRIVER } from '../config.js';
import { setEnabled } from '../lib/plugin-registry.js';

const [pluginId, mode] = process.argv.slice(2);
if (!pluginId || !['on', 'off'].includes(mode)) {
  console.error('usage: node scripts/toggle-plugin.js <pluginId> on|off');
  process.exit(1);
}

const record = await setEnabled(OWNER_ID, pluginId, mode === 'on');
if (!record) {
  console.error(`plugin "${pluginId}" not found for owner "${OWNER_ID}" (${STORE_DRIVER} driver)`);
  process.exit(1);
}

console.log(`${pluginId}: enabled = ${record.enabled}`);
