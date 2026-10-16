// The dashboard's loading state (design spec: shell, "Loading"). Next
// shows it in the content column the moment a page is requested, while
// the page's data loads; the nav unit beside it stays put. It sketches the
// common page in parts-kit materials: one machine body with a blank head
// plate (a faint bar where the engraved name goes), then a plate with
// three ruled rows (a blank paper thumbnail, a name bar, a shorter bar).
// No red and no motion: the kit moves only when something is pressed.

import { Body, Plate } from '@/components/hardware/kit/body';
import { Row, Rows } from '@/components/hardware/kit/sheet';

const ROWS = [0, 1, 2];
const BAR = 'block rounded-[1px] bg-[var(--pk-fill)]';

export default function DashboardLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <Body aria-hidden="true">
        <Plate head>
          <span className={`${BAR} h-3 w-32 opacity-[0.14]`} />
        </Plate>
        <Plate seam className="pb-[26px]">
          <Rows ruled>
            {ROWS.map((i) => (
              <Row
                key={i}
                className="items-start justify-start gap-5 max-[639px]:gap-4"
              >
                <span className="block h-[64px] w-[84px] shrink-0 bg-paper [filter:var(--pk-thumb-shadow)_var(--pk-paper-light)] max-[639px]:h-[52px] max-[639px]:w-[68px]" />
                <span className="flex min-w-0 grow flex-col gap-2.5 pt-1">
                  <span
                    className={`${BAR} h-3.5 w-44 max-w-full opacity-[0.12]`}
                  />
                  <span className={`${BAR} h-2.5 w-24 opacity-[0.09]`} />
                </span>
              </Row>
            ))}
          </Rows>
        </Plate>
      </Body>
    </div>
  );
}
