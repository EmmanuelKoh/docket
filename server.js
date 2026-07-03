// server.js — local dev server for the design studio + print queue.
// Zero new dependencies: plain Node http + fs.
//
// Routes:
//   POST /preview    -> api/preview.js
//   * /jobs          -> api/jobs.js      (create + list print jobs)
//   GET /next        -> api/next.js      (device: fetch next job)
//   POST /ack        -> api/ack.js       (device: mark done)
//   POST /nack       -> api/nack.js      (device: requeue)
//   * /templates     -> api/templates.js
//   GET /*           -> public/ (static files)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT, 10) || 3000;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Lazy-load API handlers so module init (font loading etc.) only happens once.
let handlers;
async function loadHandlers() {
  if (!handlers) {
    handlers = {
      preview:   (await import('./api/preview.js')).default,
      templates: (await import('./api/templates.js')).default,
      jobs:      (await import('./api/jobs.js')).default,
      next:      (await import('./api/next.js')).default,
      ack:       (await import('./api/ack.js')).default,
      nack:      (await import('./api/nack.js')).default,
    };
  }
}

// Read request body as JSON.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// Parse query string from URL.
function parseQuery(urlStr) {
  const idx = urlStr.indexOf('?');
  if (idx < 0) return {};
  const params = {};
  new URLSearchParams(urlStr.slice(idx)).forEach((v, k) => { params[k] = v; });
  return params;
}

// Adapt Node res to the Vercel-style res.status().json()/send() pattern.
function wrapRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  const origSetHeader = res.setHeader.bind(res);
  res.json = obj => {
    origSetHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = body => {
    if (Buffer.isBuffer(body)) res.end(body);
    else if (typeof body === 'string') res.end(body);
    else res.end();
    return res;
  };
  return res;
}

// Serve a static file from public/.
function serveStatic(reqPath, res) {
  let filePath = path.join(PUBLIC, reqPath === '/' ? 'index.html' : reqPath);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// Route helper: attach body/query and dispatch to handler.
async function route(handler, req, res, { body = false } = {}) {
  if (body) req.body = await readBody(req);
  else req.body = req.body || {};
  req.query = parseQuery(req.url);
  return handler(req, wrapRes(res));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-Job-Id');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  try {
    await loadHandlers();

    if (url === '/preview')   return route(handlers.preview, req, res, { body: true });
    if (url === '/jobs')      return route(handlers.jobs, req, res, { body: req.method === 'POST' });
    if (url === '/next')      return route(handlers.next, req, res);
    if (url === '/ack')       return route(handlers.ack, req, res);
    if (url === '/nack')      return route(handlers.nack, req, res);
    if (url === '/templates') return route(handlers.templates, req, res, { body: req.method === 'POST' });

    serveStatic(url, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Receipt Design Studio → http://localhost:${PORT}`);
});
