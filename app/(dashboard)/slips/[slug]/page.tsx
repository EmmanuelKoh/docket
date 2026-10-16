// A slip's page (design spec: pages, Slips): one machine. The slip's
// receipt (the primary template rendered with its sample data) stands at
// real size out of the platen in the head plate, between the engraved
// name and the Back key with the printer lamp. The front plate says what
// the slip is (or when a template was last saved) and carries its key
// well, the red Print test last; a template slip's well also holds Edit
// (into the Studio) and a two-step Delete. For a plugin's slip, the
// Schedule and Settings plates follow (one Save), then its templates,
// each with a key into the Studio.

import '../slips.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { getSlip } from '@/app/_lib/slip-data';
import { dayLabel, viewerTimeZone } from '@/app/_lib/time';
import { BackLink } from '@/components/back-link';
import { DeleteTemplateButton } from '@/components/delete-template-button';
import { Body, Plate, PlateTitle } from '@/components/hardware/kit/body';
import { Note, PageName } from '@/components/hardware/kit/engraved';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp } from '@/components/hardware/kit/led';
import { Platen } from '@/components/hardware/kit/screen';
import { Row, Rows, RowText } from '@/components/hardware/kit/sheet';
import { Slip } from '@/components/hardware/kit/slip';
import { PrintTestButton } from '@/components/print-test-button';
import { SlipSystemPanel } from '@/components/slip-system-panel';
import { slipsRegister } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Slips' };

// "Edited today", "Edited yesterday", "Edited Tue 13 Oct"
function editedLabel(at: number, tz: string, now: number) {
  const day = dayLabel(at, tz, now);
  return `Edited ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
}

export default async function SlipPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  const { slug } = await params;
  await slipsRegister(caller); // a new owner's plugins and their templates
  const [slip, tz, printer] = await Promise.all([
    getSlip(caller, decodeURIComponent(slug)),
    viewerTimeZone(),
    printerSummary(caller).catch(() => null),
  ]);
  if (!slip) notFound();
  const system = slip.kind === 'system';
  const edited = slip.editedAt
    ? editedLabel(slip.editedAt, tz, Date.now())
    : '';
  const about = slip.description || edited;
  const templatesNumber = slip.fields?.length ? '03' : '02';

  return (
    <>
      <div className="sl-rise">
        {slip.thumb ? (
          <Slip
            src={slip.thumb}
            alt={`${slip.primaryTemplate || slip.title} receipt`}
            tear="top"
            loading="eager"
          />
        ) : (
          <Slip tear="top">
            <p className="sl-blank">No template to preview yet.</p>
          </Slip>
        )}
      </div>

      <Body as="article" aria-labelledby="slip-name" className="sl-body">
        <Plate head className="sl-head">
          <PageName id="slip-name" className="sl-name">
            {slip.title}
          </PageName>
          <Platen />
          <div className="sl-head-side">
            <BackLink fallback="/slips" />
            {printer?.name ? (
              <Lamp state={printer.state}>
                {printerStateText(printer.state)}
              </Lamp>
            ) : null}
          </div>
        </Plate>

        <Plate seam className="sl-front">
          {about ? <Note>{about}</Note> : null}
          {system ? (
            <PrintTestButton slug={slip.slug} />
          ) : (
            <PrintTestButton slug={slip.slug}>
              <DeleteTemplateButton name={slip.slug}>
                <Key
                  legend="Edit"
                  href={`/studio?template=${encodeURIComponent(slip.slug)}`}
                />
              </DeleteTemplateButton>
            </PrintTestButton>
          )}
        </Plate>

        {system ? (
          <>
            <SlipSystemPanel slip={slip} />
            <Plate seam as="section" aria-labelledby="slip-templates">
              <h2 id="slip-templates" className="sl-plate-name">
                <PlateTitle number={templatesNumber}>
                  <span className="pk-engr">Templates</span>
                </PlateTitle>
              </h2>
              {slip.templates.length ? (
                <Rows ruled>
                  {slip.templates.map((name) => (
                    <Row key={name}>
                      <RowText title={name} />
                      <KeyWell compact label={name}>
                        <Key
                          legend="Open in Studio"
                          width={176}
                          href={`/studio?template=${encodeURIComponent(name)}`}
                        />
                      </KeyWell>
                    </Row>
                  ))}
                </Rows>
              ) : (
                <Note>This slip prints without a template.</Note>
              )}
            </Plate>
          </>
        ) : null}
      </Body>
    </>
  );
}
