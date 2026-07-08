// A recipe's page. Left: the preview stage (the primary template rendered
// through the real pipeline, on white) with Print test beneath it. Right:
// for system recipes, the toggle + PARAMETERS panel; for template
// recipes, a quiet info card. Below: TEMPLATES (each opens the Studio)
// and, for system recipes, the STATE debug record.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeleteTemplateButton } from '@/components/delete-template-button';
import { PrintTestButton } from '@/components/print-test-button';
import { RecipeSystemPanel } from '@/components/recipe-system-panel';
import { getRecipe } from '../../../_lib/recipe-data';

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n…` : s;

export default async function RecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await getRecipe(decodeURIComponent(slug));
  if (!recipe) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/recipes" className="text-xs text-ink-faint hover:text-ink">
          ← recipes
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-base font-medium text-ink">
              {recipe.title}
            </h1>
            <p className="mt-0.5 max-w-xl text-xs text-ink-muted">
              {recipe.description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-[4px] border-[0.5px] border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-ink-muted">
              {recipe.kind}
            </span>
            <span className="rounded-[4px] border-[0.5px] border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-ink-muted">
              liquid
            </span>
            {recipe.kind === 'template' ? (
              <DeleteTemplateButton name={recipe.slug} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* preview stage */}
        <section className="rounded-md border-[0.5px] border-border bg-raised p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            Preview
          </div>
          <div className="mt-3 flex justify-center rounded-sm border-[0.5px] border-border bg-white p-4">
            {recipe.primaryTemplate ? (
              <img
                src={`/api/templates/thumb?name=${encodeURIComponent(recipe.primaryTemplate)}`}
                alt={recipe.primaryTemplate}
                className="w-full max-w-[420px]"
              />
            ) : (
              <p className="py-10 text-sm text-ink-faint">
                No template in the store yet — it seeds on the first tick.
              </p>
            )}
          </div>
          <div className="mt-3 flex justify-center">
            <PrintTestButton slug={recipe.slug} />
          </div>
        </section>

        {/* controls */}
        {recipe.kind === 'system' ? (
          <RecipeSystemPanel initial={recipe} />
        ) : (
          <section className="h-fit rounded-md border-[0.5px] border-border bg-raised px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              Template
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              A stored template. Edit the Liquid source and default data in the
              Studio; print it from there or with Print test.
            </p>
            <a
              href={`/studio?template=${encodeURIComponent(recipe.slug)}`}
              className="mt-3 inline-block text-xs text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Open in Studio →
            </a>
          </section>
        )}
      </div>

      {/* templates */}
      <section>
        <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
          Templates
        </div>
        <div className="mt-2 rounded-md border-[0.5px] border-border bg-raised">
          {recipe.templates.length ? (
            recipe.templates.map((name, i) => (
              <div
                key={name}
                className={`flex items-center justify-between px-5 py-3 ${i > 0 ? 'border-t-[0.5px] border-t-hairline' : ''}`}
              >
                <span className="font-mono text-[13px] text-ink">{name}</span>
                <a
                  href={`/studio?template=${encodeURIComponent(name)}`}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  Open in Studio →
                </a>
              </div>
            ))
          ) : (
            <p className="px-5 py-4 text-sm text-ink-faint">
              No templates declared.
            </p>
          )}
        </div>
      </section>

      {/* state */}
      {recipe.kind === 'system' ? (
        <section>
          <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            State
          </div>
          <div className="mt-2 rounded-md border-[0.5px] border-border bg-raised px-5 py-4">
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-muted">
              {clip(JSON.stringify(recipe.state || {}, null, 2), 1200)}
            </pre>
          </div>
        </section>
      ) : null}
    </div>
  );
}
