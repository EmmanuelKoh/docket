// A render preview shown at the receipt's paper width, the same in every
// place a preview appears, so they read consistently. The paper is 400px
// (the 80mm / 624-dot stock); the printed image sits at 92.3% of it (the
// 576 printable dots within the paper), smooth-scaled down. On a container
// narrower than the paper (phones), the whole thing goes full width.
//
// Callers that place the preview in a row (e.g. the Overview hero) pass a
// className like "sm:w-[400px] sm:shrink-0" so it holds the paper width
// beside its neighbour instead of stretching.

const PAPER = 'w-full max-w-[400px]';

export function ReceiptPreview({
  src,
  alt = '',
  className = '',
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto ${PAPER} overflow-hidden rounded-sm border-[0.5px] border-border bg-white ${className}`}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="mx-auto mt-[3.75%] block w-[92.3%]"
      />
    </div>
  );
}

// An empty paper slip at the same width, for "no preview yet" states.
export function ReceiptPreviewEmpty({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto flex ${PAPER} items-center justify-center rounded-sm border-[0.5px] border-border bg-white ${className}`}
    >
      <p className="px-6 py-12 text-center text-[13px] text-neutral-500">
        {children}
      </p>
    </div>
  );
}
