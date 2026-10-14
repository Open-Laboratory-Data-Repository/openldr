import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface LightboxProps {
  label: string;
  /** What one item is called, for the arrow buttons: "screenshot", "video". */
  itemNoun: string;
  onClose: () => void;
  onStep: (delta: number) => void;
  children: ReactNode;
}

// Full-size overlay for the landing's video section.
export function Lightbox({ label, itemNoun, onClose, onStep, children }: LightboxProps) {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 pb-4">
        <p className="text-sm font-medium">{label}</p>
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

      {/* Stop the click on the media itself from closing, so only the backdrop dismisses. */}
      <div className="flex min-h-0 flex-1 items-center gap-3" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label={`Previous ${itemNoun}`}
          onClick={() => onStep(-1)}
          className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        {children}
        <button
          type="button"
          aria-label={`Next ${itemNoun}`}
          onClick={() => onStep(1)}
          className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
