// print-net.js — send ESC/POS bytes to the printer over TCP.

import net from 'net';
import { PRINTER_IP, PRINTER_PORT } from '../config.js';

/**
 * Open a TCP socket, write the bytes, close.
 * Defaults to PRINTER_IP and PRINTER_PORT from config.js.
 */
export function printToNetwork(bytes, ip = PRINTER_IP, port = PRINTER_PORT) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port }, () => {
      sock.end(bytes, resolve);
    });
    sock.on('error', reject);
    sock.setTimeout(5000, () => {
      sock.destroy(new Error('connection timed out'));
    });
  });
}
