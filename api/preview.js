// api/preview.js — POST /preview
// Renders a Liquid template + data through the real render core and returns
// the 1-bit dithered PNG (exactly what the printer would produce).

import { renderToPreview } from '../render/render-core.js';
import { requireSessionApi } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  if (!requireSessionApi(req, res)) return;

  const { template, data } = req.body || {};
  if (!template) {
    return res.status(400).json({ error: 'template is required' });
  }

  try {
    const result = await renderToPreview(template, data || {});
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Image-Width', String(result.width));
    res.setHeader('X-Image-Height', String(result.height));
    return res.status(200).send(result.preview);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
