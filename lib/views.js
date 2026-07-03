// lib/views.js — server-side rendering for dashboard pages and htmx
// fragments, using LiquidJS (already a dependency — the same engine the
// render core uses for receipts).
//
// outputEscape: every {{ value }} is HTML-escaped by default; the layout
// injects pre-rendered page content with {{ content | raw }}.

import path from 'path';
import { fileURLToPath } from 'url';
import { Liquid } from 'liquidjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, '..', 'views');

const engine = new Liquid({
  root: VIEWS_DIR,
  extname: '.liquid',
  cache: true,
  outputEscape: 'escape',
});

// Render a view template to an HTML string.
export function renderView(name, data = {}) {
  return engine.renderFile(name, data);
}

// Render a full page: the section view wrapped in the layout.
export async function renderPage(view, { title, active, ...data }) {
  const content = await engine.renderFile(view, data);
  return engine.renderFile('layout', { title, active, content });
}
