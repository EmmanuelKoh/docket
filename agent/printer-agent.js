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
//      (or printToFile() -> write <dir>/<job id>.bin, with PRINTER_IP=file:<dir>)
//   3. POST /ack?job=ID   -> mark done (or /nack on send failure -> requeue)
//
// When the ESP32 firmware is ready it replaces this script — same /next, /ack,
// /nack contract, different transport (Wi-Fi instead of localhost).
//
// Env:
//   PRINT_SERVER   server URL          (default http://localhost:3000)
//   POLL_INTERVAL  ms between polls    (default 3000)
//   PRINTER_IP / PRINTER_PORT          the printer, via config.js (no default);
//                                      PRINTER_IP=file:<dir> is the dry-run sink

import { DEVICE_TOKEN, PRINTER_IP } from '../config.js';
import { fileSinkDir, printToFile } from '../transport/print-file.js';
import { printToNetwork } from '../transport/print-net.js';

const SERVER = process.env.PRINT_SERVER || `http://localhost:${process.env.PORT || 3000}`;
const POLL_MS = parseInt(process.env.POLL_INTERVAL, 10) || 3000;
const AUTH = { Authorization: `Bearer ${DEVICE_TOKEN}` };
const SINK_DIR = fileSinkDir(PRINTER_IP);

if (SINK_DIR === '') {
  console.error('PRINTER_IP=file: names no directory to write jobs to.');
  console.error('Put the directory after file:, e.g. PRINTER_IP=file:data/prints');
  process.exit(1);
}
if (!PRINTER_IP) {
  console.error('PRINTER_IP is not set. Set it in .env to one of:');
  console.error('  your network printer\'s address (ESC/POS over TCP on PRINTER_PORT, default 9100)');
  console.error('  file:<dir> to write each job to <dir>/<job id>.bin and ack it,');
  console.error('    with no printer, e.g. PRINTER_IP=file:data/prints');
  console.error('A serial printer (like the RP850) needs the ESP32 instead.');
  process.exit(1);
}

async function send(jobId, bytes) {
  if (SINK_DIR === null) {
    await printToNetwork(bytes);
    return 'printed';
  }
  return `wrote ${await printToFile(bytes, SINK_DIR, jobId)}`;
}

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
  console.log(`  ${jobId}: ${bytes.length} bytes, sending...`);

  try {
    console.log(`  ${jobId}: ${await send(jobId, bytes)} -> ack`);
    await fetch(`${SERVER}/ack?job=${encodeURIComponent(jobId)}`, { method: 'POST', headers: AUTH });
  } catch (err) {
    console.log(`  ${jobId}: send failed (${err.message}) -> nack`);
    await fetch(`${SERVER}/nack?job=${encodeURIComponent(jobId)}`, { method: 'POST', headers: AUTH });
  }
}

console.log(`printer agent polling ${SERVER} every ${POLL_MS / 1000}s`);
console.log(SINK_DIR === null
  ? `  printer: ${PRINTER_IP} (PRINTER_IP / PRINTER_PORT from config.js)`
  : `  dry run: writing jobs to ${SINK_DIR}`);
console.log(`  Ctrl+C to stop\n`);

async function loop() {
  while (true) {
    await poll();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
loop();
