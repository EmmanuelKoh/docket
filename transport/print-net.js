// print-net.js — send ESC/POS bytes to the printer over TCP.
//
// Thermal printers sleep after idle periods. The TCP stack accepts data into
// its kernel buffer even while the controller is asleep, so sock.end()
// resolves without error — but the printer never processes the bytes.
//
// Fix: open ONE connection, send DLE EOT (real-time status request), and wait
// for the 1-byte response. If the printer responds, it's awake — send the
// payload on the same socket. If not, send ESC @ to wake it, pause, and
// re-probe on a fresh connection. Only then send the real job.
//
// Using a single connection for probe + send avoids the RST packet that
// sock.destroy() sends when closing the probe connection, which could
// interfere with the printer's TCP stack.

import net from 'net';
import { PRINTER_IP, PRINTER_PORT } from '../config.js';

const DLE_EOT = Buffer.from([0x10, 0x04, 0x01]); // DLE EOT 1 — printer status
const ESC_INIT = Buffer.from([0x1b, 0x40]);        // ESC @ — initialize printer

const PROBE_TIMEOUT_MS = 2000;
const WAKE_PAUSE_MS = 1500;
const MAX_WAKE_ATTEMPTS = 3;
const SEND_TIMEOUT_MS = 5000;

/**
 * Open a connection, send DLE EOT, and wait for the 1-byte status response.
 * If the printer responds, resolve with { status, sock } (socket kept open).
 * If timeout or error, destroy the socket and resolve with { status: null }.
 */
function probeKeepAlive(ip, port) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host: ip, port }, () => {
      sock.write(DLE_EOT);
    });
    sock.on('data', data => {
      // Printer is awake — clear the timeout and keep the socket open.
      sock.setTimeout(0);
      resolve({ status: data[0], sock });
    });
    sock.setTimeout(PROBE_TIMEOUT_MS, () => {
      sock.destroy();
      resolve({ status: null, sock: null });
    });
    sock.on('error', () => {
      sock.destroy();
      resolve({ status: null, sock: null });
    });
  });
}

/**
 * Send ESC @ (init) on a throwaway connection to wake the controller.
 */
function wake(ip, port) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port }, () => {
      sock.end(ESC_INIT, resolve);
    });
    sock.on('error', reject);
    sock.setTimeout(5000, () => {
      sock.destroy(new Error('wake timed out'));
    });
  });
}

/**
 * Send the payload on an existing socket, then close it.
 */
function sendOnSocket(sock, bytes) {
  return new Promise((resolve, reject) => {
    sock.setTimeout(SEND_TIMEOUT_MS, () => {
      sock.destroy(new Error('send timed out'));
    });
    sock.on('error', reject);
    sock.end(bytes, resolve);
  });
}

/**
 * Ensure the printer is awake, then send the data — all on one connection.
 *
 * 1. Probe with DLE EOT — if a response comes back, the printer is awake.
 *    Send the payload on the SAME socket (no RST, no second connection).
 * 2. If no response, send ESC @ on a throwaway connection to wake it,
 *    pause, and re-probe.
 * 3. Retry up to MAX_WAKE_ATTEMPTS times.
 */
export async function printToNetwork(bytes, ip = PRINTER_IP, port = PRINTER_PORT) {
  for (let i = 0; i < MAX_WAKE_ATTEMPTS; i++) {
    const { status, sock } = await probeKeepAlive(ip, port);
    if (status !== null && sock) {
      // Printer is awake — send on this same connection.
      await sendOnSocket(sock, bytes);
      return;
    }
    // Printer didn't respond — wake it.
    await wake(ip, port);
    await new Promise(r => setTimeout(r, WAKE_PAUSE_MS));
  }

  // Last-resort probe after all wake attempts.
  const { status, sock } = await probeKeepAlive(ip, port);
  if (status !== null && sock) {
    await sendOnSocket(sock, bytes);
    return;
  }

  throw new Error('printer did not respond after ' + MAX_WAKE_ATTEMPTS + ' wake attempts');
}
