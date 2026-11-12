import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Lightbox } from '@/components/Lightbox';
import { useWebsiteTheme } from '@/components/useWebsiteTheme';
import focus from './web-guide-focus.json';
interface Rect { x: number; y: number; width: number; height: number }
interface Focus { crop: Rect; targets: Rect[]; step?: number; source?: { width: number; height: number }; image?: string; lightImage?: string; markerAfter?: boolean; markerPlacement?: 'after' | 'before' | 'inside' | null; markerPlacements?: Array<'after' | 'before' | 'inside'> }


const FOCUS = focus as Record<string, Focus>;
export function hasWebFocus(src: string) { return src.startsWith('/docs-images/operator/') && src.split('/').pop()! in FOCUS; }
function FocusedScreenshotFrame({ src, url, alt }: { src: string; url: string; alt: string }) {
  const { crop, targets, step, source = { width: 1280, height: 800 }, markerAfter, markerPlacement, markerPlacements } = FOCUS[src.split('/').pop()!];
  const imageStyle = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', maxWidth: 'none', margin: 0, objectFit: 'fill' as const };
  return (
        <span className="relative block w-full overflow-hidden bg-background" style={{ aspectRatio: '8 / 5', containerType: 'inline-size' }}>
          <span className="absolute block" style={{
            width: `${source.width / crop.width * 100}%`, height: `${source.height / crop.height * 100}%`,
            left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%`,
          }}>
            <img src={url} alt={alt} loading="lazy" style={{ ...imageStyle, filter: 'blur(.25cqw)', opacity: 0.9 }} />
            {targets.map((target, index) => {
              const placement = markerPlacements?.[index] ?? markerPlacement;
              const markerPosition = placement === 'inside' ? 'right-1'
                : (placement === 'after' || (!placement && (markerAfter ?? step === 1)))
                  ? 'left-[calc(100%+3px)]' : 'right-[calc(100%+3px)]';
              const narrowMarker = placement ? 'max-[900px]:left-auto max-[900px]:right-1' : '';
              return (
              <span key={index}>
                <img src={url} alt="" aria-hidden="true" loading="lazy" style={{ ...imageStyle,
                  clipPath: `inset(${target.y / source.height * 100}% ${(source.width - target.x - target.width) / source.width * 100}% ${(source.height - target.y - target.height) / source.height * 100}% ${target.x / source.width * 100}%)`,
                }} />
                {index === 0 || markerPlacements !== undefined ? <span aria-hidden="true" className="absolute rounded-sm border-2 border-ring" style={{
                  left: `${target.x / source.width * 100}%`, top: `${target.y / source.height * 100}%`,
                  width: `${target.width / source.width * 100}%`, height: `${target.height / source.height * 100}%`,
                }}>
                  {step ? <span className={`absolute -top-1 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-ring text-[11px] text-background ${markerPosition} ${narrowMarker}`}>{step}</span> : null}
                </span> : null}
              </span>
              );
            })}
          </span>
        </span>
  );
}

export function WebFocusedScreenshot({ src, alt }: { src: string; alt: string }) {
  const theme = useWebsiteTheme();
  const entry = FOCUS[src.split('/').pop()!];
  const url = (theme === 'light' ? entry.lightImage : undefined) ?? entry.image ?? src;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <span className="web-focused-picture my-6 block">
    <Button ref={trigger} variant="ghost" className="block h-auto w-full overflow-hidden rounded-md border border-border p-0" aria-label={alt} onClick={() => setOpen(true)}>
      <FocusedScreenshotFrame src={src} url={url} alt={alt} />
    </Button>
    <span className="mt-1 block text-xs text-muted-foreground">{alt}</span>
    {open ? createPortal(<Lightbox label={alt} itemNoun="image" onClose={close}><span className="mx-auto block max-w-full" style={{width:'min(1100px, calc(100vw - 4rem), calc((100dvh - 10rem) * 1.6))'}}><FocusedScreenshotFrame src={src} url={url} alt={alt}/></span></Lightbox>, document.body) : null}
  </span>;
}
