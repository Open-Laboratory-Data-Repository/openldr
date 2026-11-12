import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Lightbox } from '@/components/Lightbox';
import { Button } from '@/components/ui/button';
import { VideoThumbnail } from '@/components/VideoThumbnail';
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
  // Set on /watch/:video, the link the README uses for each poster.
  const { video: linkedVideo } = useParams();
  const navigate = useNavigate();
  const linkedIndex = VIDEOS.findIndex((item) => item.name === linkedVideo);
  const [openIndex, setOpenIndex] = useState<number | null>(linkedIndex >= 0 ? linkedIndex : null);
  const openedFrom = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  // The landing stays mounted when the hash changes from / to /watch/:video, so the initial
  // state above is not enough. Behind the overlay, put the section on screen, so closing the
  // video leaves the reader here.
  useEffect(() => {
    if (linkedIndex < 0) return;
    setOpenIndex(linkedIndex);
    sectionRef.current?.scrollIntoView?.({ block: 'start' });
  }, [linkedIndex]);

  const close = useCallback(() => {
    setOpenIndex(null);
    // Drop /watch/:video, so a reload does not reopen the video.
    if (linkedVideo) navigate('/', { replace: true });
    // Send focus back to the tile the reader opened, not to the top of the page.
    openedFrom.current?.focus();
  }, [linkedVideo, navigate]);

  const step = useCallback((delta: number) => {
    setOpenIndex((current) => (current === null ? null : (current + delta + VIDEOS.length) % VIDEOS.length));
  }, []);

  return (
    <div id="videos" ref={sectionRef} className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Watch it work</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Short walkthroughs of the real application, each under a minute
        </p>
      </div>

      <ul className="grid list-none grid-cols-2 gap-4 pl-0 lg:grid-cols-4">
        {VIDEOS.map((item, index) => (
          <li key={item.name}>
            <Button
              variant="ghost"
              type="button"
              onClick={(event) => {
                openedFrom.current = event.currentTarget;
                setOpenIndex(index);
              }}
              className="group flex h-auto w-full flex-col items-stretch gap-0 overflow-hidden whitespace-normal rounded-lg border border-border bg-card p-0 text-left transition-colors hover:border-muted-foreground/40"
            >
              <span className="relative block">
                <VideoThumbnail item={item} />
                <span className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-110">
                  <Play aria-hidden="true" className="h-4 w-4" />
                </span>
              </span>
              <span className="block border-t border-border px-3 py-2 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                {item.label}
              </span>
            </Button>
          </li>
        ))}
      </ul>

      {openIndex === null ? null : <VideoLightbox item={VIDEOS[openIndex]} onClose={close} onStep={step} />}
    </div>
  );
}
