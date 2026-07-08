// /templates — CRUD for saved templates, ported from api/templates.js at
// the same path so views/studio.html works unchanged against this app.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import {
  deleteTemplate,
  getTemplates,
  isReadOnly,
  saveTemplate,
} from '@/lib/store.js';

export async function GET(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  try {
    return Response.json(await getTemplates());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  try {
    const { name, template, data } = (await req.json().catch(() => ({}))) || {};
    if (!name || !template) {
      return Response.json(
        { error: 'name and template are required' },
        { status: 400 },
      );
    }
    try {
      const templates = await saveTemplate({ name, template, data });
      return Response.json(templates);
    } catch (err) {
      if (isReadOnly()) {
        return Response.json(
          { error: (err as Error).message, readOnly: true },
          { status: 403 },
        );
      }
      throw err;
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  try {
    const name = new URL(req.url).searchParams.get('name') || '';
    if (!name) {
      return Response.json(
        { error: 'name query parameter is required' },
        { status: 400 },
      );
    }
    try {
      const templates = await deleteTemplate(name);
      return Response.json(templates);
    } catch (err) {
      if (isReadOnly()) {
        return Response.json(
          { error: (err as Error).message, readOnly: true },
          { status: 403 },
        );
      }
      throw err;
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
