// History's markup (app/(dashboard)/history/page.tsx reads the data). The
// deck: HISTORY engraved with the printer's lamp on the upper plate; the
// receipt counter and one key well on the lower plate, the filter keys
// (the current one held down) and the red Reprint key last, live only
// while a record that can print again is open. Under it, one record sheet
// per day (each lies a little differently, by the day's number), then the
// pager body when there is more than one page. Styles are in
// app/(dashboard)/history/history.css.

import { Body, Plate } from '@/components/hardware/kit/body';
import { CounterWindow } from '@/components/hardware/kit/counter-window';
import { Engraved, PageName } from '@/components/hardware/kit/engraved';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp, type LedState } from '@/components/hardware/kit/led';
import { Sheet } from '@/components/hardware/kit/sheet';
import {
  HistoryList,
  HistoryProvider,
  type HistoryRow,
  ReprintKey,
  ReprintStatus,
} from '@/components/history-list';

export type HistoryDay = {
  key: string;
  /** "Today", "Yesterday", "Tue 13 Oct" */
  label: string;
  /** Counted from the newest day, across pages */
  number: number;
  rows: HistoryRow[];
};

export type HistoryViewProps = {
  /** Every job under the filter, on all pages */
  count: number;
  filters: { label: string; href: string; current: boolean }[];
  /** The printer's lamp; null leaves it out */
  lamp: { state: LedState; text: string } | null;
  days: HistoryDay[];
  /** What an empty sheet says, under the current filter's name */
  empty: { title: string; text: string };
  /** Newer and Older: a link, or null on the first or last page */
  pager: {
    page: number;
    pages: number;
    newer: string | null;
    older: string | null;
  } | null;
};

const pad = (n: number, digits: number) => String(n).padStart(digits, '0');

export function HistoryView({
  count,
  filters,
  lamp,
  days,
  empty,
  pager,
}: HistoryViewProps) {
  return (
    <HistoryProvider>
      <Body as="section" aria-labelledby="history-name">
        <Plate head>
          <PageName id="history-name" className="history-deck-name">
            History
          </PageName>
          {lamp ? (
            <Lamp state={lamp.state} className="history-lamp">
              {lamp.text}
            </Lamp>
          ) : null}
        </Plate>
        <Plate seam className="history-low">
          <CounterWindow
            className="history-count"
            value={pad(count, 3)}
            label={`${count} ${count === 1 ? 'receipt' : 'receipts'}`}
            legend="Receipts"
          />
          <ReprintStatus className="history-status" />
          <KeyWell className="history-keys">
            {/* biome-ignore lint/a11y/useSemanticElements: a nested fieldset would break the keys' row in the well */}
            <span role="group" aria-label="Filter" className="history-filter">
              {filters.map((f) => (
                <Key
                  key={f.label}
                  legend={f.label}
                  href={f.href}
                  down={f.current}
                />
              ))}
            </span>
            <ReprintKey />
          </KeyWell>
        </Plate>
      </Body>

      <div className="history-sheets">
        {days.length ? (
          days.map((day) => (
            <Sheet
              key={day.key}
              index={day.number - 1}
              number={pad(day.number, 2)}
              title={day.label}
            >
              <HistoryList rows={day.rows} sheet={day.number - 1} />
            </Sheet>
          ))
        ) : (
          <Sheet title={empty.title}>
            <p className="pk-sheet-ink history-empty">{empty.text}</p>
          </Sheet>
        )}
      </div>

      {pager ? (
        <nav aria-label="Pages" className="history-pager">
          <Body>
            <Plate className="history-pager-plate">
              <span className="history-page-count">
                <Engraved aria-hidden="true">Page</Engraved>
                <CounterWindow
                  value={pad(pager.page, 2)}
                  label={`Page ${pager.page} of ${pager.pages}`}
                  legend={`Of ${pad(pager.pages, 2)}`}
                />
              </span>
              <KeyWell className="history-pager-keys">
                {pager.newer ? (
                  <Key legend="Newer" href={pager.newer} />
                ) : (
                  <Key legend="Newer" disabled />
                )}
                {pager.older ? (
                  <Key legend="Older" href={pager.older} />
                ) : (
                  <Key legend="Older" disabled />
                )}
              </KeyWell>
            </Plate>
          </Body>
        </nav>
      ) : null}
    </HistoryProvider>
  );
}
