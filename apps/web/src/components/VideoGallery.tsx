import { useCallback, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Lightbox } from '@/components/Lightbox';
import { VIDEOS, type ProductVideo } from '@/landing/videos';

function VideoLightbox({ item, onClose, onStep }: { item: ProductVideo; onClose: () => void; onStep: (delta: number) => void }) {
  return (
    <Lightbox label={item.label} itemNoun="video" onClose={onClose} onStep={onStep}>
      {/* key remounts the player on step, so the next video starts from the beginning. */}
      <video
        key={item.name}
        src={item.video}
        poster={item.poster}
        aria-label={item.description}
        controls
        autoPlay
        muted
        playsInline
        className="mx-auto max-h-full min-h-0 w-auto min-w-0 max-w-full rounded-lg border border-border"
      />
    </Lightbox>
  );
}

export function VideoGallery() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openedFrom = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpenIndex(null);
    // Send focus back to the tile the reader opened, not to the top of the page.
    openedFrom.current?.focus();
  }, []);

  const step = useCallback((delta: number) => {
    setOpenIndex((current) => (current === null ? null : (current + delta + VIDEOS.length) % VIDEOS.length));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Watch it work</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Short walkthroughs of the real application, each under a minute
        </p>
      </div>

      <ul className="grid list-none grid-cols-2 gap-4 pl-0 lg:grid-cols-4">
        {VIDEOS.map((item, index) => (
          <li key={item.name}>
            <button
              type="button"
              onClick={(event) => {
                openedFrom.current = event.currentTarget;
                setOpenIndex(index);
              }}
              className="group w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-muted-foreground/40"
            >
              <span className="relative block">
                {/* Posters are small JPEGs; the video itself loads only when opened. */}
                <img
                  src={item.poster}
                  alt={item.description}
                  loading={index < 4 ? 'eager' : 'lazy'}
                  className="aspect-video w-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full bg-background/80 p-3 text-foreground shadow-sm transition-transform group-hover:scale-110">
                    <Play aria-hidden="true" className="h-5 w-5" />
                  </span>
                </span>
              </span>
              <span className="block border-t border-border px-3 py-2 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                {item.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {openIndex === null ? null : <VideoLightbox item={VIDEOS[openIndex]} onClose={close} onStep={step} />}
    </div>
  );
}
