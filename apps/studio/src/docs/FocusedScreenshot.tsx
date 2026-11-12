import additionalFocus from './dashboard-focus.json';
import preferencesFocus from './preferences-focus.json';
import highResolutionFocus from './high-resolution-focus.json';
import terminologyFocus from './terminology-focus.json';
import facilitiesFocus from './facilities-focus.json';
import reviewedGuidesFocus from './reviewed-guides-focus.json';
import { Button } from '@/components/ui/button';
import type { LightboxImage } from './Lightbox';

interface Rect { x: number; y: number; width: number; height: number }
interface Focus { crop: Rect; targets: Rect[]; step?: number; source?: { width: number; height: number }; markerAfter?: boolean; markerPlacement?: 'after' | 'before' | 'inside' | null; markerPlacements?: Array<'after' | 'before' | 'inside'> }

const FOCUS: Record<string, Focus> = {
  ...additionalFocus,
  ...preferencesFocus,
  ...highResolutionFocus,
  ...terminologyFocus as Record<string, Focus>,
  ...facilitiesFocus as Record<string, Focus>,
  ...reviewedGuidesFocus as Record<string, Focus>,
};

export function focusedScreenshot(src: string): boolean { return src in FOCUS; }

/** Keep the page crop in the lightbox. Container units scale blur with its width. */
export function FocusedScreenshotFrame({ src, url, alt }: { src: string; url: string; alt: string }) {
  const { crop, targets, step, source = { width: 1280, height: 800 }, markerAfter, markerPlacement, markerPlacements } = FOCUS[src];
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

export function FocusedScreenshot({ src, url, alt, onImageClick }: {
  src: string; url: string; alt: string; onImageClick: (image: LightboxImage) => void;
}) {
  return (
    <span className="my-4 block">
      <Button variant="outline" type="button" onClick={() => onImageClick({ url, alt, focus: src })}
        aria-label={`Zoom: ${alt}`} className="block h-auto w-full max-w-[500px] cursor-zoom-in overflow-hidden p-0">
        <FocusedScreenshotFrame src={src} url={url} alt={alt} />
      </Button>
      {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
    </span>
  );
}
