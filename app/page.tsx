export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-mono text-sm uppercase tracking-[0.2em]">docket</h1>
      <div className="mt-6 rounded-sm border-[0.5px] border-border bg-raised p-5">
        <p className="text-sm text-ink-muted">
          Next.js shell, phase 1. The device endpoints{' '}
          <code className="font-mono text-ink">/next</code>,{' '}
          <code className="font-mono text-ink">/ack</code>,{' '}
          <code className="font-mono text-ink">/nack</code>,{' '}
          <code className="font-mono text-ink">/tick</code> and{' '}
          <code className="font-mono text-ink">/ingest</code> are served from
          this app. The dashboard still lives in the legacy server until phase
          2.
        </p>
      </div>
    </main>
  );
}
