// A slip's page (design spec: pages, Slips). Left: the slip's receipt
// feeding out of the printer at its true size (the primary template
// rendered with its sample data), with the red Print test key under it.
// Right: for a plugin's slip, its Schedule and Settings modules and its
// templates, each with a key into the Studio; for a template slip, a
// Template module, and Delete beside the title.

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { getSlip } from '@/app/_lib/slip-data';
import { BackLink } from '@/components/back-link';
import { DeleteTemplateButton } from '@/components/delete-template-button';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { PaperRoll, PaperSlip, PrinterEdge } from '@/components/hardware/paper';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row } from '@/components/hardware/row';
import { Note } from '@/components/hardware/text';
import { PrintTestButton } from '@/components/print-test-button';
import { SlipSystemPanel } from '@/components/slip-system-panel';
import { slipsRegister } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Slips' };

export default async function SlipPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  const { slug } = await params;
  await slipsRegister(caller); // a new owner's plugins and their templates
  const slip = await getSlip(caller, decodeURIComponent(slug));
  if (!slip) notFound();

  return (
    <>
      <BackLink fallback="/slips" className="-mt-3 mb-1" />
      <PageTitle
        className={slip.description ? 'mb-3' : undefined}
        actions={
          slip.kind === 'template' ? (
            <DeleteTemplateButton name={slip.slug} />
          ) : null
        }
      >
        {slip.title}
      </PageTitle>
      {slip.description ? (
        <p className="mt-0 mb-10 max-w-[60ch] text-ink-muted max-sm:mb-7">
          {slip.description}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-x-[52px] gap-y-12">
        <section
          aria-label="Preview"
          className="min-w-0 flex-[999_1_624px] min-[876px]:pl-[18px]"
        >
          <PrinterEdge />
          <PaperRoll>
            {slip.thumb ? (
              <PaperSlip
                src={slip.thumb}
                alt={`${slip.primaryTemplate || slip.title} receipt`}
                fed
                tear="new"
              />
            ) : (
              <PaperSlip fed tear="new">
                <p className="m-0 py-14 text-center text-[#4a4741]">
                  No template to preview yet.
                </p>
              </PaperSlip>
            )}
          </PaperRoll>
          <div className="mt-7">
            <PrintTestButton slug={slip.slug} />
          </div>
        </section>

        <div className="flex min-w-[280px] flex-[1_1_360px] flex-col gap-[30px] max-[400px]:min-w-0">
          {slip.kind === 'system' ? (
            <>
              <SlipSystemPanel slip={slip} />
              <Module
                number={slip.fields?.length ? '03' : '02'}
                title="Templates"
                flush
              >
                {slip.templates.map((name) => (
                  <Row key={name} tight>
                    <span className="min-w-0 truncate font-semibold">
                      {name}
                    </span>
                    <KeyGroup>
                      <PushKey
                        size="compact"
                        href={`/studio?template=${encodeURIComponent(name)}`}
                      >
                        Open in Studio
                      </PushKey>
                    </KeyGroup>
                  </Row>
                ))}
                {slip.templates.length === 0 ? (
                  <Row>
                    <Note>This slip prints without a template.</Note>
                  </Row>
                ) : null}
              </Module>
            </>
          ) : (
            <Module number="01" title="Template">
              <Note>Edit this template in Studio.</Note>
              <KeyGroup className="self-start">
                <PushKey
                  href={`/studio?template=${encodeURIComponent(slip.slug)}`}
                >
                  Open in Studio
                </PushKey>
              </KeyGroup>
            </Module>
          )}
        </div>
      </div>
    </>
  );
}
