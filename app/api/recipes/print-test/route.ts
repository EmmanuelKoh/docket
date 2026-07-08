// POST /api/recipes/print-test?slug=X — queue a real print of the recipe's
// primary template with its stored default data. The cheap-probe path:
// the maintainer iterates on physical output, so every recipe page can
// put paper through the printer in one click.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { getRecipe } from '@/app/_lib/recipe-data';
import { createJob } from '@/lib/job-store.js';
import { getTemplates } from '@/lib/store.js';

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const slug = new URL(req.url).searchParams.get('slug') || '';
  const recipe = await getRecipe(slug);
  if (!recipe?.primaryTemplate) {
    return Response.json({ error: 'recipe not found' }, { status: 404 });
  }

  const templates = await getTemplates();
  const t = templates.find(
    (x: { name: string }) => x.name === recipe.primaryTemplate,
  );
  if (!t) {
    return Response.json(
      { error: `template "${recipe.primaryTemplate}" not in store` },
      { status: 404 },
    );
  }

  try {
    const data =
      typeof t.data === 'string' ? JSON.parse(t.data || '{}') : t.data || {};
    const result = await createJob({
      template: t.template,
      data,
      name: `${t.name} (test)`,
      source: 'test',
    });
    return Response.json({ queued: result.id });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
