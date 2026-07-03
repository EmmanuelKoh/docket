// heartbeat.js — the pulse that drives the plugin registry. POSTs /tick on an
// interval; the server decides which plugins are enabled and due and runs
// them. This replaces running agent/espn-poller.js (retired to reference/) —
// the poller's logic now lives in plugins/espn-worldcup.js.
//
// This is your Mac standing in for the ESP32. Run it alongside the server
// and printer agent:
//
//   node agent/heartbeat.js
//
// Env:
//   PRINT_SERVER        server URL        (default http://localhost:3000)
//   HEARTBEAT_SECONDS   seconds per tick  (default 30, via config.js)
//   DEVICE_TOKEN        Bearer token      (via config.js)

import { HEARTBEAT_SECONDS, DEVICE_TOKEN } from "../config.js";

// const SERVER = process.env.PRINT_SERVER || `http://localhost:${process.env.PORT || 3000}`;
const SERVER = `http://localhost:${process.env.PORT || 3000}`;
const AUTH = { Authorization: `Bearer ${DEVICE_TOKEN}` };

async function tick() {
  let resp;
  try {
    resp = await fetch(`${SERVER}/tick`, { method: "POST", headers: AUTH });
  } catch (err) {
    console.log(`  server unreachable (${err.message})`);
    return;
  }

  if (resp.status === 401) {
    console.log(
      "  server rejected device token (check DEVICE_TOKEN on both ends)"
    );
    return;
  }

  let body;
  try {
    body = await resp.json();
  } catch {
    console.log(`  unexpected /tick response (${resp.status})`);
    return;
  }

  // Quiet on not-due/disabled; log only when something happened.
  for (const r of body.results || []) {
    if (r.status === "ran") console.log(`  ${r.id}: ran`);
    else if (r.status === "running")
      console.log(`  ${r.id}: still running, skipped`);
    else if (r.status === "error") console.log(`  ${r.id}: error — ${r.error}`);
  }
}

console.log(`heartbeat ticking ${SERVER}/tick every ${HEARTBEAT_SECONDS}s`);
console.log(`  Ctrl+C to stop\n`);

async function loop() {
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, HEARTBEAT_SECONDS * 1000));
  }
}
loop();
