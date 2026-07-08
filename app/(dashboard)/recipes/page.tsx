// Recipes — everything the printer can produce, grouped by category
// (uppercase label + count + rule). Cards follow the Templates-page
// grammar: the top of the real rendered receipt as the hero (white,
// top-cropped, dashed bottom edge), mono name, quiet sub. The card IS the
// button. "New template" opens the Studio blank.

import Link from 'next/link';
import { groupByCategory, listRecipes } from '../../_lib/recipe-data';

export default async function RecipesPage() {
  const recipes = await listRecipes();
  const groups = groupByCategory(recipes);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-medium text-ink">Recipes</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {recipes.length} recipe{recipes.length === 1 ? '' : 's'} · system
            recipes run on a schedule, templates print from the Studio
          </p>
        </div>
        <a
          href="/studio?new=1"
          className="shrink-0 whitespace-nowrap rounded-md border-[0.5px] border-border bg-raised px-3 py-1.5 text-xs text-ink hover:border-ink-faint"
        >
          New template
        </a>
      </div>

      {groups.map((group) => (
        <section key={group.category}>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              {group.category}
            </span>
            <span className="font-mono text-[11px] text-ink-faint">
              {group.recipes.length}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {group.recipes.map((r) => (
              <Link
                key={r.slug}
                href={`/recipes/${encodeURIComponent(r.slug)}`}
                className="group overflow-hidden rounded-md border-[0.5px] border-border bg-raised transition-colors hover:border-ink-faint"
              >
                <div className="h-[170px] overflow-hidden border-b border-dashed border-dash bg-white">
                  {r.primaryTemplate ? (
                    <img
                      src={`/api/templates/thumb?name=${encodeURIComponent(r.primaryTemplate)}`}
                      alt=""
                      loading="lazy"
                      className="w-full object-cover object-top"
                    />
                  ) : null}
                </div>
                <div className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[13px] text-ink">
                      {r.title}
                    </span>
                    {r.kind === 'system' ? (
                      <span
                        className={`shrink-0 rounded-[4px] border-[0.5px] border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] ${r.enabled ? 'text-ink-muted' : 'text-ink-faint'}`}
                      >
                        {r.enabled ? 'enabled' : 'off'}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-xs text-ink-muted">
                    {r.description}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
