import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { screenshotUrl } from '@/landing/screenshots';

interface Shot {
  name: string;
  label: string;
  alt: string;
}

const SHOTS: Shot[] = [
  { name: 'dashboard.png', label: 'Dashboard', alt: 'The OpenLDR dashboard with order and result widgets' },
  { name: 'reports.png', label: 'Report', alt: 'An AMR resistance report, run, with its result table' },
  { name: 'query.png', label: 'Query', alt: 'The SQL workbench, with a query and its results' },
  { name: 'form-builder.png', label: 'Form builder', alt: 'The form builder editing a lab order form' },
  { name: 'terminology.png', label: 'Terminology', alt: 'The terminology browser listing code systems' },
  { name: 'report-designer.png', label: 'Report designer', alt: 'The report designer canvas laying out a page' },
  { name: 'workflows.png', label: 'Workflows', alt: 'The workflow builder wiring nodes together' },
  { name: 'marketplace.png', label: 'Marketplace', alt: 'Browsing marketplace artifacts' },
];

function Lightbox({ shot, onClose, onStep }: { shot: Shot; onClose: () => void; onStep: (delta: number) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onStep(1);
      if (event.key === 'ArrowLeft') onStep(-1);
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while the overlay is up.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onStep]);

  const url = screenshotUrl(shot.name);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shot.label}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 pb-4">
        <p className="text-sm font-medium">{shot.label}</p>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {/* Stop the click on the image itself from closing, so only the backdrop dismisses. */}
      <div className="flex min-h-0 flex-1 items-center gap-3" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label="Previous screenshot"
          onClick={() => onStep(-1)}
          className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        {url ? (
          <img src={url} alt={shot.alt} className="mx-auto max-h-full min-h-0 w-auto max-w-full rounded-lg border border-border" />
        ) : null}
        <button
          type="button"
          aria-label="Next screenshot"
          onClick={() => onStep(1)}
          className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Gallery() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openedFrom = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpenIndex(null);
    // Send focus back to the tile the reader opened, not to the top of the page.
    openedFrom.current?.focus();
  }, []);

  const step = useCallback((delta: number) => {
    setOpenIndex((current) => (current === null ? null : (current + delta + SHOTS.length) % SHOTS.length));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">See it before you install it</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Every screen below is the real application, not a mock
        </p>
      </div>

      <ul className="grid list-none grid-cols-2 gap-4 pl-0 lg:grid-cols-4">
        {SHOTS.map((shot, index) => {
          const url = screenshotUrl(shot.name);
          return (
            <li key={shot.name}>
              <button
                type="button"
                onClick={(event) => {
                  openedFrom.current = event.currentTarget;
                  setOpenIndex(index);
                }}
                className="group w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-muted-foreground/40"
              >
                {url ? (
                  <img
                    src={url}
                    alt={shot.alt}
                    // The first row is above the fold on a desktop; the rest can wait.
                    loading={index < 4 ? 'eager' : 'lazy'}
                    className="aspect-[16/10] w-full object-cover object-left-top"
                  />
                ) : null}
                <span className="block border-t border-border px-3 py-2 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                  {shot.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {openIndex === null ? null : <Lightbox shot={SHOTS[openIndex]} onClose={close} onStep={step} />}
    </div>
  );
}
