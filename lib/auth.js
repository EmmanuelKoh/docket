// lib/auth.js — device token check for device-facing endpoints
// (/next, /ack, /nack). One token, one user for now; the mechanism is what
// makes this multi-user-ready. The printer agent sends
// Authorization: Bearer <DEVICE_TOKEN> on every request.

import { DEVICE_TOKEN } from '../config.js';

// Returns true if authorized; otherwise writes a 401 response and returns false.
export function requireDeviceToken(req, res) {
  const header = req.headers?.authorization || '';
  if (header !== `Bearer ${DEVICE_TOKEN}`) {
    res.status(401).json({ error: 'missing or invalid device token' });
    return false;
  }
  return true;
}
