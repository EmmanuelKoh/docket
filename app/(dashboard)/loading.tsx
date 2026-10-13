// The dashboard's loading state (design spec: shell, "Loading"). Next
// shows it in the content column the moment a page is requested, while
// the page's data loads; the sidebar and header around it stay put. It
// sketches the common page grammar in flat blocks: a title block, then
// one list container of three ledger rows (thumbnail frame, name bar,
// rail bar), hairline-separated. Blocks are --hairline on --raised, no
// red, a slow opacity pulse only where motion is welcome.

const ROWS = [0, 1, 2];

export default function DashboardLoading() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <div>
          <div className="h-4 w-28 bg-hairline" />
          <div className="mt-2 h-3 w-48 max-w-full bg-hairline" />
        </div>
        <div className="border-[0.5px] border-border bg-raised">
          {ROWS.map((i) => (
            <div
              key={i}
              className={`flex items-start gap-4 px-4 py-4 sm:gap-6 sm:px-5 ${i > 0 ? 'border-t-[0.5px] border-t-hairline' : ''}`}
            >
              <div className="h-16 w-24 shrink-0 border-[0.5px] border-border bg-page sm:h-[86px] sm:w-[130px]" />
              <div className="min-w-0 grow pt-1">
                <div className="flex items-center justify-between gap-6">
                  <div className="h-3 w-40 max-w-full bg-hairline" />
                  <div className="hidden h-3 w-20 shrink-0 bg-hairline sm:block" />
                </div>
                <div className="mt-2.5 h-2.5 w-24 bg-hairline" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
