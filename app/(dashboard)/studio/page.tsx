// Studio: the template editor, built as a teleprinter (design spec:
// pages, Studio). The editor itself is components/studio-editor.tsx.
//
// The page reads the templates (templates.list) so the first render shows
// the code, and honours the URL contract the slip pages use:
// /studio?template=Name opens that template, ?new=1 opens New template.
// The lamp is the printer's state (printers.overview and jobs.queueSize,
// shared with the nav's printer line through React cache); it streams in,
// so the page does not wait on it.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getCaller } from '@/app/_lib/caller';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { Lamp } from '@/components/hardware/kit/led';
import { StudioEditor, type StudioTemplate } from '@/components/studio-editor';
import type { Caller } from '@/lib/ops/caller.js';
import { templatesList } from '@/lib/ops/templates.js';
import './studio.css';

export const metadata: Metadata = { title: 'Studio' };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? '';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const caller = await getCaller();
  if (!caller?.ownerId) redirect('/login');
  const params = await searchParams;
  const wanted = one(params.template);
  const startNew = one(params.new) !== '';

  // null: the read failed, and the editor asks /templates itself
  let templates: StudioTemplate[] | null = null;
  try {
    const rows = (await templatesList(caller, {})) as StudioTemplate[];
    templates = rows.map(({ name, template, data }) => ({
      name,
      template,
      data,
    }));
  } catch (err) {
    console.error('[studio] templates', err);
  }

  return (
    <StudioEditor
      // a new ?template= or ?new= is a fresh editor
      key={`${wanted}\n${startNew}`}
      initialTemplates={templates}
      initialName={wanted}
      startNew={startNew}
      lamp={
        <Suspense fallback={null}>
          <StudioLamp caller={caller} />
        </Suspense>
      }
    />
  );
}

// The printer's LED and state, engraved at the right of the head plate.
// A failed read shows nothing rather than breaking the page.
async function StudioLamp({ caller }: { caller: Caller }) {
  try {
    const printer = await printerSummary(caller);
    if (!printer.name) return <Lamp state="offline">No printer</Lamp>;
    return <Lamp state={printer.state}>{printerStateText(printer.state)}</Lamp>;
  } catch (err) {
    console.error('[studio] printer', err);
    return null;
  }
}
