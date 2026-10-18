'use client';

// The Kit page's parts, each in every state it has. The controls work, so
// hover, focus and travel can be tried live. Hover and focus cannot be
// held by markup; every other state is shown by its prop.

import { type ReactNode, useState } from 'react';
import { Body, Plate, PlateTitle } from '@/components/hardware/kit/body';
import { Fader, LeicaKey, Shutter } from '@/components/hardware/kit/controls';
import { Counter } from '@/components/hardware/kit/counter';
import { CounterWindow } from '@/components/hardware/kit/counter-window';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp, Led } from '@/components/hardware/kit/led';
import {
  Leather,
  Platen,
  PrinterBlock,
  Screen,
} from '@/components/hardware/kit/screen';
import {
  Row,
  Rows,
  RowText,
  Sheet,
  SheetRow,
  SheetRows,
} from '@/components/hardware/kit/sheet';
import { Slip, Thumb } from '@/components/hardware/kit/slip';
import { Switch } from '@/components/hardware/kit/switch';
import { Stamp } from '@/components/hardware/stamp';

type Print = { src: string; name: string; width: number; height: number };

const TEMPLATES = [
  { value: 'brief', label: 'Morning Brief' },
  { value: 'budget', label: 'Budget' },
  { value: 'kanban', label: 'Kanban' },
  { value: 'grocery', label: 'Grocery List' },
];

/** One part in one state, its state printed under it. */
function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3">
      {children}
      <Note>{name}</Note>
    </div>
  );
}

function Group({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Body as="section" aria-label={title}>
      <Plate head>
        <PlateTitle number={number}>{title}</PlateTitle>
      </Plate>
      <Plate seam className="flex flex-wrap items-end gap-x-10 gap-y-8 p-8">
        {children}
      </Plate>
    </Body>
  );
}

export function KitSpecimen({ prints }: { prints: Print[] }) {
  const [pressed, setPressed] = useState(true);
  const [on, setOn] = useState(true);
  const [mode, setMode] = useState(false);
  const [fader, setFader] = useState(60);
  const [centered, setCentered] = useState(0);
  const [tpl, setTpl] = useState('budget');
  const [text, setText] = useState('Kitchen printer');
  const [first, second] = prints;

  return (
    <div className="flex flex-col gap-16">
      <Body as="section" aria-labelledby="kit-name">
        <Plate head>
          <PageName id="kit-name">Kit</PageName>
          <Lamp state="online">Online</Lamp>
        </Plate>
        <Plate seam className="p-8">
          <Note>
            Every part in every state. Edit app/kit.css or
            components/hardware/kit/ and this page reloads. /compare shows it in
            both themes.
          </Note>
        </Plate>
      </Body>

      <Group number="01" title="Keys">
        <State name="Well: rest, pressed, down, disabled, print last">
          <KeyWell label="Keys">
            <Key legend="Rest" />
            <Key
              legend="Pressed"
              pressed={pressed}
              onClick={() => setPressed((p) => !p)}
            />
            <Key legend="Down" down />
            <Key legend="Off" disabled />
            <Key legend="Print" print />
          </KeyWell>
        </State>
        <State name="Print key down, disabled">
          <KeyWell label="Print states">
            <Key legend="Print" print down />
            <Key legend="Print" print disabled />
          </KeyWell>
        </State>
        <State name="Compact well (row actions)">
          <KeyWell compact label="Row">
            <Key legend="Edit" />
            <Key legend="Cancel" />
            <Key legend="Reprint" print />
          </KeyWell>
        </State>
        <State name="Link keys, current one down">
          <KeyWell label="Links">
            <Key legend="Kit" href="/kit" down />
            <Key legend="Queue" href="/queue" />
            <Key legend="Off" href="/queue" disabled />
          </KeyWell>
        </State>
        <State name="Fill (shares the width)">
          <div className="w-[360px]">
            <KeyWell fill label="Fill">
              <Key legend="Light" />
              <Key legend="Dark" />
              <Key legend="Print" print />
            </KeyWell>
          </div>
        </State>
      </Group>

      <Group number="02" title="Push keys and release">
        <State name="Rest">
          <LeicaKey>Edit</LeicaKey>
        </State>
        <State name="Down">
          <LeicaKey down>Edit</LeicaKey>
        </State>
        <State name="Disabled">
          <LeicaKey disabled>Edit</LeicaKey>
        </State>
        <State name="Wide link">
          <LeicaKey wide href="/kit">
            Sign out
          </LeicaKey>
        </State>
        <State name="Release">
          <Shutter />
        </State>
        <State name="Release down">
          <Shutter down />
        </State>
        <State name="Release locked">
          <Shutter disabled />
        </State>
      </Group>

      <Group number="03" title="Lamps">
        <State name="Online">
          <Lamp state="online">Online</Lamp>
        </State>
        <State name="Printing">
          <Lamp state="printing">Printing</Lamp>
        </State>
        <State name="Error">
          <Lamp state="error">Failed</Lamp>
        </State>
        <State name="Offline">
          <Lamp state="offline">Offline</Lamp>
        </State>
        <State name="Red lens, off">
          <Led state="offline" lens="red" label="Record" />
        </State>
      </Group>

      <Group number="04" title="Switches and faders">
        <State name={on ? 'On' : 'Off'}>
          <Switch label="Power" checked={on} onChange={setOn} />
        </State>
        <State name="Off, disabled">
          <Switch
            label="Locked off"
            checked={false}
            disabled
            onChange={() => {}}
          />
        </State>
        <State name="On, disabled">
          <Switch label="Locked on" checked disabled onChange={() => {}} />
        </State>
        <State name={`Mode: ${mode ? 'Data' : 'Template'}`}>
          <Switch
            variant="mode"
            label="Editor mode"
            legends={['Template', 'Data']}
            checked={mode}
            onChange={setMode}
          />
        </State>
        <State name="No legends">
          <Switch label="Bare" legends={false} checked={on} onChange={setOn} />
        </State>
        <State name={`Fader ${fader}`}>
          <Fader
            aria-label="Fader"
            min={0}
            max={100}
            value={fader}
            onChange={(e) => setFader(+e.target.value)}
          />
        </State>
        <State name={`Centred fader ${centered}`}>
          <Fader
            centered
            aria-label="Centred fader"
            min={-50}
            max={50}
            value={centered}
            onChange={(e) => setCentered(+e.target.value)}
          />
        </State>
        <State name="Fader disabled">
          <Fader aria-label="Disabled fader" disabled defaultValue={30} />
        </State>
      </Group>

      <Group number="05" title="Counters">
        <State name="Counter with name drum">
          <Counter
            label="Template"
            options={TEMPLATES}
            value={tpl}
            onChange={setTpl}
            showName
            legend="Template"
          />
        </State>
        <State name="Counter, digits only">
          <Counter
            label="Template number"
            options={TEMPLATES}
            value={tpl}
            onChange={setTpl}
            showName={false}
          />
        </State>
        <State name="Counter disabled">
          <Counter
            label="Locked"
            options={TEMPLATES}
            value={tpl}
            onChange={setTpl}
            showName
            disabled
          />
        </State>
        <State name="Display window">
          <CounterWindow value="015" label="15 receipts" legend="Receipts" />
        </State>
      </Group>

      <Group number="06" title="Fields">
        <State name="Input">
          <Field
            label="Printer name"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </State>
        <State name="Hint">
          <Field
            label="Email"
            placeholder="name@example.com"
            hint="Used to sign in."
          />
        </State>
        <State name="Error">
          <Field
            label="Code"
            defaultValue="NCZX"
            error="Codes have six letters."
          />
        </State>
        <State name="Disabled">
          <Field label="Locked" defaultValue="Read only" disabled />
        </State>
        <State name="Select">
          <Field as="select" label="Template" defaultValue="budget">
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Field>
        </State>
        <State name="Textarea">
          <Field
            as="textarea"
            label="Message"
            rows={3}
            defaultValue="Call the plumber"
          />
        </State>
      </Group>

      <Group number="07" title="Lettering">
        <State name="Engraved">
          <Engraved>Kitchen printer</Engraved>
        </State>
        <State name="Engraved soft">
          <Engraved tone="soft">Last seen 2 min</Engraved>
        </State>
        <State name="Engraved red">
          <Engraved tone="red">Printing</Engraved>
        </State>
        <State name="Plate title">
          <PlateTitle number="02">Schedule</PlateTitle>
        </State>
        <State name="Note">
          <Note>Prints every morning at 07:00.</Note>
        </State>
        <State name="Note red">
          <Note tone="red">The printer did not answer.</Note>
        </State>
        <State name="Stamps">
          <span className="flex gap-4">
            <Stamp state="printed" />
            <Stamp state="canceled" />
            <Stamp state="failed" />
          </span>
        </State>
      </Group>

      <Group number="08" title="Screens and set-in parts">
        <State name="E-ink">
          <Screen kind="eink" className="w-[220px]">
            <span className="block p-4 font-mono">07:00 Daily Brief</span>
          </Screen>
        </State>
        <State name="Dark screen">
          <Screen kind="dark" className="w-[220px]">
            <span className="block p-4 font-mono">07:00 Daily Brief</span>
          </Screen>
        </State>
        <State name="Photo LCD">
          <Screen kind="lcd" className="w-[220px]">
            <span className="block p-4 font-mono">ISO 400</span>
          </Screen>
        </State>
        <State name="Editor">
          <Screen kind="editor" className="w-[220px]">
            <span className="block p-4 font-mono">{'{{ date }}'}</span>
          </Screen>
        </State>
        <State name="Leather">
          <Leather className="h-[90px] w-[220px]" />
        </State>
      </Group>

      <Group number="09" title="Sheets and rows">
        <State name="Record sheet">
          <div className="w-[420px]">
            <Sheet index={0} number="01" title="Invites">
              <SheetRows>
                <SheetRow>
                  <span className="pk-sheet-ink flex flex-col">
                    <span>jordan@example.test</span>
                    <span className="pk-sheet-sub">Expires in 6 days</span>
                  </span>
                </SheetRow>
                <SheetRow>
                  <span className="pk-sheet-ink flex flex-col">
                    <span>Open invite</span>
                    <span className="pk-sheet-sub">Anyone with the link</span>
                  </span>
                </SheetRow>
              </SheetRows>
            </Sheet>
          </div>
        </State>
        <State name="Rows, ruled">
          <div className="w-[420px]">
            <Rows ruled>
              <Row>
                <RowText title="Kitchen printer" sub="Paired Oct 14" />
                <KeyWell compact label="Kitchen printer">
                  <Key legend="Rename" />
                </KeyWell>
              </Row>
              <Row>
                <RowText title="Daily Brief" sub="07:00 every day" />
                <Switch label="Daily Brief" checked={on} onChange={setOn} />
              </Row>
            </Rows>
          </div>
        </State>
      </Group>

      <Group number="10" title="Paper">
        {first ? (
          <>
            <State name="Solo">
              <Slip
                src={first.src}
                alt={first.name}
                imageWidth={first.width}
                imageHeight={first.height}
              />
            </State>
            <State name="New (torn at the bottom)">
              <Slip
                tear="new"
                src={first.src}
                alt={first.name}
                imageWidth={first.width}
                imageHeight={first.height}
              />
            </State>
            <State name="Old (torn both ends)">
              <Slip
                tear="old"
                src={(second ?? first).src}
                alt={(second ?? first).name}
                imageWidth={(second ?? first).width}
                imageHeight={(second ?? first).height}
              />
            </State>
            <State name="Exact preview">
              <Slip
                exact
                src={first.src}
                alt={first.name}
                imageWidth={first.width}
                imageHeight={first.height}
              />
            </State>
            <State name="Printer block">
              <PrinterBlock>
                <Slip
                  tear="new"
                  src={first.src}
                  alt={first.name}
                  imageWidth={first.width}
                  imageHeight={first.height}
                />
              </PrinterBlock>
            </State>
            <State name="Platen">
              <div className="pt-[240px]">
                <Platen>
                  <Slip
                    tear="top"
                    src={first.src}
                    alt={first.name}
                    imageWidth={first.width}
                    imageHeight={first.height}
                  />
                </Platen>
              </div>
            </State>
            <State name="Thumb">
              <Thumb
                src={first.src}
                alt={first.name}
                imageWidth={first.width}
                imageHeight={first.height}
                rotate={-0.6}
              />
            </State>
          </>
        ) : (
          <Note>Print something first: the slips use your newest jobs.</Note>
        )}
      </Group>
    </div>
  );
}
