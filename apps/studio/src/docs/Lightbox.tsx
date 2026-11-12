import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { isClip } from './screenshots';
import { FocusedScreenshotFrame } from './FocusedScreenshot';
import { DottedIllustrationFrame } from './DottedIllustration';

/** A screenshot, or a clip (an MP4 url, with the poster shown before it plays). */
export interface LightboxImage { url: string; alt: string; poster?: string; focus?: string; illustration?: boolean }

const MIN = 1;
const MAX = 5;
const STEP = 0.5;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, z));

export function Lightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const open = image !== null;

  useEffect(() => { if (open) setZoom(1); }, [open, image?.url]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setZoom((z) => clamp(z + (e.deltaY < 0 ? STEP : -STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  if (!image) return null;

  // A clip plays at its own size with controls, so a reader can pause on a step. No zoom.
  if (isClip(image.url)) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="h-[90vh] w-[90vw] max-w-none">
          <DialogTitle className="sr-only">{image.alt || 'Clip'}</DialogTitle>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
            <span className="text-sm text-muted-foreground">{image.alt}</span>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0d0d0d] p-2">
            <video
              src={image.url}
              poster={image.poster}
              aria-label={image.alt}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="max-h-full max-w-full"
            />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="h-[90vh] w-[90vw] max-w-none">
        <DialogTitle className="sr-only">{image.alt || 'Screenshot'}</DialogTitle>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">{image.alt}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z - STEP))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z + STEP))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Image backdrop is hardcoded near-black (not a theme token) so the viewer
            reads correctly in any theme — the same approach corlix's lightbox uses. */}
        <div ref={scrollRef} className={`min-h-0 flex-1 overflow-auto ${image.illustration ? 'bg-background' : 'bg-[#0d0d0d]'}`}>
          {image.illustration ? (
            <div className="mx-auto" onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
              style={{ width: `${zoom * 100}%`, maxWidth: 'none', cursor: zoom === 1 ? 'zoom-in' : 'zoom-out' }}>
              <DottedIllustrationFrame url={image.url} alt={image.alt} />
            </div>
          ) : image.focus ? (
            <div className="mx-auto" onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
              style={{ width: `${zoom * 100}%`, maxWidth: 'none', cursor: zoom === 1 ? 'zoom-in' : 'zoom-out' }}>
              <FocusedScreenshotFrame src={image.focus} url={image.url} alt={image.alt} />
            </div>
          ) : (
          <img
            src={image.url}
            alt={image.alt}
            draggable={false}
            onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
            className="mx-auto block h-auto"
            style={{ width: `${zoom * 100}%`, maxWidth: 'none', cursor: zoom === 1 ? 'zoom-in' : 'zoom-out' }}
          />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
