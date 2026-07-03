// printer-agent.js — the local "device" that polls the server for print jobs
// and sends them to the thermal printer over TCP.
//
// This is your Mac standing in for the ESP32. Run it alongside the server:
//
//   node agent/printer-agent.js
//
// Flow each cycle:
//   1. GET /next          -> 204 (empty) or 200 + ESC/POS bytes + X-Job-Id
//   2. printToNetwork()   -> send bytes to the printer over TCP
//   3. POST /ack?job=ID   -> mark done (or /nack on send failure -> requeue)
//
// When the ESP32 firmware is ready it replaces this script — same /next, /ack,
// /nack contract, different transport (Wi-Fi instead of localhost).
//
// Env:
//   PRINT_SERVER   server URL          (default http://localhost:3000)
//   POLL_INTERVAL  ms between polls    (default 3000)
//   PRINTER_IP / PRINTER_PORT          read by printToNetwork via config.js

import { printToNetwork } from '../transport/print-net.js';
import { DEVICE_TOKEN } from '../config.js';

const SERVER = process.env.PRINT_SERVER || `http://localhost:${process.env.PORT || 3000}`;
const POLL_MS = parseInt(process.env.POLL_INTERVAL, 10) || 3000;
const AUTH = { Authorization: `Bearer ${DEVICE_TOKEN}` };

async function poll() {
  let resp;
  try {
    resp = await fetch(`${SERVER}/next`, { headers: AUTH });
  } catch (err) {
    console.log(`  server unreachable (${err.message})`);
    return;
  }

  if (resp.status === 401) {
    console.log('  server rejected device token (check DEVICE_TOKEN on both ends)');
    return;
  }
  if (resp.status === 204) return; // nothing queued

  const jobId = resp.headers.get('X-Job-Id');
  const bytes = Buffer.from(await resp.arrayBuffer());
  console.log(`  ${jobId}: ${bytes.length} bytes, sending to printer...`);

  try {
    await printToNetwork(bytes);
    console.log(`  ${jobId}: printed -> ack`);
    await fetch(`${SERVER}/ack?job=${encodeURIComponent(jobId)}`, { method: 'POST', headers: AUTH });
  } catch (err) {
    console.log(`  ${jobId}: send failed (${err.message}) -> nack`);
    await fetch(`${SERVER}/nack?job=${encodeURIComponent(jobId)}`, { method: 'POST', headers: AUTH });
  }
}

console.log(`printer agent polling ${SERVER} every ${POLL_MS / 1000}s`);
console.log(`  printer: PRINTER_IP / PRINTER_PORT from config.js`);
console.log(`  Ctrl+C to stop\n`);

async function loop() {
  while (true) {
    await poll();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
loop();
