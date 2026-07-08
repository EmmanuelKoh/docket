// GET /api/templates/thumb?name=X — renders a template with its stored
// default data and returns the PNG, for slip-card previews. Rendering is
// the expensive part, so responses carry short private caching (same trade
// as the legacy /dashboard/templates/thumb).

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { getTemplates } from '@/lib/store.js';
import { renderToPreview } from '@/render/render-core.js';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const name = new URL(req.url).searchParams.get('name');
  if (!name) {
    return Response.json(
      { error: 'name query parameter is required' },
      { status: 400 },
    );
  }

  const templates = await getTemplates();
  const t = templates.find((x: { name: string }) => x.name === name);
  if (!t) return new Response(null, { status: 404 });

  try {
    const data =
      typeof t.data === 'string' ? JSON.parse(t.data || '{}') : t.data || {};
    const { preview } = await renderToPreview(t.template, data);
    return new Response(new Uint8Array(preview), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(preview.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
