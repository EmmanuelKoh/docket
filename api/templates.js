// api/templates.js — GET/POST/DELETE /templates
// CRUD for saved templates, backed by lib/store.js.

import { getTemplates, saveTemplate, deleteTemplate, isReadOnly } from '../lib/store.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getTemplates());
    }

    if (req.method === 'POST') {
      const { name, template, data } = req.body || {};
      if (!name || !template) {
        return res.status(400).json({ error: 'name and template are required' });
      }
      try {
        const templates = await saveTemplate({ name, template, data });
        return res.status(200).json(templates);
      } catch (err) {
        if (isReadOnly()) {
          return res.status(403).json({ error: err.message, readOnly: true });
        }
        throw err;
      }
    }

    if (req.method === 'DELETE') {
      const name = (req.query && req.query.name) || '';
      if (!name) {
        return res.status(400).json({ error: 'name query parameter is required' });
      }
      try {
        const templates = await deleteTemplate(name);
        return res.status(200).json(templates);
      } catch (err) {
        if (isReadOnly()) {
          return res.status(403).json({ error: err.message, readOnly: true });
        }
        throw err;
      }
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
