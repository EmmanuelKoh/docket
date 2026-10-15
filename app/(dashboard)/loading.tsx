// The dashboard's loading state (design spec: shell, "Loading"). Next
// shows it in the content column the moment a page is requested, while
// the page's data loads; the panel around it stays put. It sketches the
// common page grammar in E materials: a faint block where the printed
// title goes, then a module with a blank label plate and three rows on
// dashed rules (a white paper thumbnail, a name bar, a shorter line
// bar). No red and no motion: E moves only when something is pressed.

const ROWS = [0, 1, 2];

export default function DashboardLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="flex flex-col gap-7 sm:gap-10">
        <div className="h-[43px] w-48 max-w-full rounded-[2px] bg-ink/[0.07] sm:h-[58px] sm:w-56" />
        <div className="hw-module hw-panel max-w-[720px]">
          <div className="hw-plate">
            <span className="block h-2.5 w-20 rounded-[1px] bg-plate-ink/25" />
          </div>
          <div className="hw-module-body">
            {ROWS.map((i) => (
              <div key={i} className="hw-row items-start justify-start gap-4">
                <div className="h-[54px] w-[72px] shrink-0 bg-paper shadow-[0_0_0_1px_rgba(30,28,24,0.12),0_1px_2px_rgba(30,28,24,0.12)]" />
                <div className="flex min-w-0 grow flex-col gap-2.5 pt-1">
                  <div className="h-3.5 w-44 max-w-full rounded-[1px] bg-ink/[0.1]" />
                  <div className="h-3 w-24 rounded-[1px] bg-ink/[0.07]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
