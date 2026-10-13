// lib/ops/templates.js: the owner's saved templates (Liquid + HTML with
// default data). The Studio lists, saves and deletes them; the Studio and
// Photo render a draft to a preview PNG; slip cards show a thumbnail of a
// stored template rendered with its stored data. Storage is lib/store.js.
// render-core loads inside the ops that render (tests/lazy-render.test.ts).
import { z } from 'zod';
import * as store from '../store.js';
import { defineOperation, OpError } from './define.js';
import { Binary } from './schema.js';

const required = msg => z.string({ error: msg }).min(1, { error: msg });
// Any JSON value, as the jsonb column takes it; the renderer gets {} for none.
const anyJson = z.unknown().optional();

const renderer = () => import('../../render/render-core.js');

export const templatesList = defineOperation({
  name: 'templates.list',
  description: 'Your saved templates: name, template source and default data.',
  permission: 'owner',
  effects: ['db.read'],
  input: z.object({}),
  run: caller => store.getTemplates(caller.ownerId),
});

export const templatesSave = defineOperation({
  name: 'templates.save',
  description: 'Create or replace a template by name: Liquid + HTML source and its default data. Returns every template.',
  permission: 'owner',
  effects: ['db.write'],
  input: z.object({
    name: required('name and template are required'),
    template: required('name and template are required'),
    data: anyJson,
  }),
  run: (caller, { name, template, data }) => store.saveTemplate(caller.ownerId, { name, template, data }),
});

// The Photo tool prints with this template, looked up by name
// (components/photo-engine.js; seeded from reference/photo-templates.json).
const PHOTO_TEMPLATE = 'Photo Print';

// Who prints with a template by name: a plugin module that declares it
// (its meta.title), or the Photo tool. null = nothing does.
async function templateUser(name) {
  if (name === PHOTO_TEMPLATE) return 'Photo';
  const { PLUGINS } = await import('../../plugins/index.js'); // only deletes need the modules
  const module = PLUGINS.find(m => m.templates?.includes(name));
  return module ? module.meta?.title || module.id : null;
}

export const templatesDelete = defineOperation({
  name: 'templates.delete',
  description: 'Delete a template by name. Returns the templates left. A template a system slip or the Photo tool prints with cannot be deleted (conflict).',
  permission: 'owner',
  effects: ['db.write'],
  destructive: true,
  input: z.object({ name: required('name query parameter is required') }),
  async run(caller, { name }) {
    const user = await templateUser(name);
    if (user) throw new OpError('conflict', `This template is used by ${user}`);
    return store.deleteTemplate(caller.ownerId, name);
  },
});

// Satori's messages for markup it cannot lay out that a draft hits while
// the author types: a <div> with two children before display:flex, a
// half-typed CSS value, an <img> without a usable src.
const LAYOUT_ERRORS = [
  /^Expected <\w+> to have explicit "display/,
  /^Failed to parse declaration/,
  /^Invalid `/,
  /^Image source/,
];

// The Studio's live preview: exactly the 1-bit image the printer would
// produce, with its size for the paper roll. The Studio previews while
// the author types, so a Liquid syntax or render error, or one of
// Satori's layout errors above, is the draft's fault (invalid, logged
// nowhere), not a server error with a stack trace.
export const templatesPreview = defineOperation({
  name: 'templates.preview',
  description: "Render a template with data to the dithered 1-bit PNG the printer would produce, without printing. A Liquid error in the template, or markup the layout engine cannot lay out (e.g. a <div> with several children and no display:flex), is invalid, with the engine's message.",
  permission: 'owner',
  effects: ['render'],
  input: z.object({ template: required('template is required'), data: anyJson }),
  output: Binary.extend({ width: z.number(), height: z.number() }),
  async run(_caller, { template, data }) {
    const { renderToPreview } = await renderer();
    try {
      const { preview, width, height } = await renderToPreview(template, data || {});
      return { contentType: 'image/png', body: preview, width, height };
    } catch (err) {
      const { LiquidError } = await import('liquidjs'); // loaded with the renderer
      if (LiquidError.is(err)) throw new OpError('invalid', err.message);
      const message = err instanceof Error ? err.message : '';
      if (LAYOUT_ERRORS.some(re => re.test(message))) throw new OpError('invalid', message.trim());
      throw err;
    }
  },
});

export const templatesThumb = defineOperation({
  name: 'templates.thumb',
  description: 'A stored template rendered with its stored default data, as a PNG.',
  permission: 'owner',
  effects: ['db.read', 'render'],
  input: z.object({ name: required('name query parameter is required') }),
  output: Binary,
  async run(caller, { name }) {
    const t = await store.getTemplate(caller.ownerId, name);
    if (!t) throw new OpError('not_found', 'template not found');
    const values = typeof t.data === 'string' ? JSON.parse(t.data || '{}') : t.data || {};
    const { renderToPreview } = await renderer();
    const { preview } = await renderToPreview(t.template, values);
    return { contentType: 'image/png', body: preview };
  },
});
