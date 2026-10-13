// /templates — CRUD for saved templates (lib/ops/templates.js), used by the
// Studio (components/studio-editor.tsx) and the Photo tool.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import {
  templatesDelete,
  templatesList,
  templatesSave,
} from '@/lib/ops/templates.js';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  return json(() => templatesList(caller));
}

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const body = (await req.json().catch(() => null)) || {};
  return json(() =>
    templatesSave(caller, {
      name: body.name,
      template: body.template,
      data: body.data,
    }),
  );
}

export async function DELETE(req: Request) {
  const caller = await requestCaller(req);
  const name = new URL(req.url).searchParams.get('name') ?? '';
  return json(() => templatesDelete(caller, { name }));
}
