import additionalFocus from './dashboard-focus.json';
import preferencesFocus from './preferences-focus.json';
import { Button } from '@/components/ui/button';
import type { LightboxImage } from './Lightbox';

interface Rect { x: number; y: number; width: number; height: number }
interface Focus { crop: Rect; targets: Rect[]; step?: number; source?: { width: number; height: number }; markerAfter?: boolean }

const FOCUS: Record<string, Focus> = {
  ...additionalFocus,
  ...preferencesFocus,
  'dashboard-create-open.png': {
    crop: { x: 0, y: 0, width: 640, height: 400 },
    targets: [{ x: 0, y: 48, width: 239, height: 52 }], step: 1,
  },
  'dashboard-create-menu.png': {
    crop: { x: 640, y: 0, width: 640, height: 400 },
    targets: [{ x: 1224, y: 54, width: 48, height: 48 }], step: 2,
  },
  'dashboard-create-new.png': {
    crop: { x: 640, y: 0, width: 640, height: 400 },
    targets: [{ x: 1101, y: 95, width: 166, height: 48 }], step: 3,
  },
  'dashboard-create-result.png': {
    crop: { x: 200, y: 0, width: 640, height: 400 },
    targets: [{ x: 248, y: 84, width: 240, height: 52 }, { x: 240, y: 141, width: 1040, height: 659 }],
  },
};

export function focusedScreenshot(src: string): boolean { return src in FOCUS; }

/** The same crop, blur and markers are used on the page and in the lightbox. */
export function FocusedScreenshotFrame({ src, url, alt }: { src: string; url: string; alt: string }) {
  const { crop, targets, step, source = { width: 1280, height: 800 }, markerAfter } = FOCUS[src];
  const imageStyle = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', maxWidth: 'none', margin: 0, objectFit: 'fill' as const };
  return (
        <span className="relative block w-full overflow-hidden bg-background" style={{ aspectRatio: '8 / 5' }}>
          <span className="absolute block" style={{
            width: `${source.width / crop.width * 100}%`, height: `${source.height / crop.height * 100}%`,
            left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%`,
          }}>
            <img src={url} alt={alt} loading="lazy" style={{ ...imageStyle, filter: 'blur(1.25px)', opacity: 0.9 }} />
            {targets.map((target, index) => (
              <span key={index}>
                <img src={url} alt="" aria-hidden="true" loading="lazy" style={{ ...imageStyle,
                  clipPath: `inset(${target.y / source.height * 100}% ${(source.width - target.x - target.width) / source.width * 100}% ${(source.height - target.y - target.height) / source.height * 100}% ${target.x / source.width * 100}%)`,
                }} />
                {index === 0 ? <span aria-hidden="true" className="absolute rounded-sm border-2 border-ring" style={{
                  left: `${target.x / source.width * 100}%`, top: `${target.y / source.height * 100}%`,
                  width: `${target.width / source.width * 100}%`, height: `${target.height / source.height * 100}%`,
                }}>
                  {step ? <span className={`absolute -top-1 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-ring text-[11px] text-background ${(markerAfter ?? step === 1) ? 'left-[calc(100%+3px)]' : 'right-[calc(100%+3px)]'}`}>{step}</span> : null}
                </span> : null}
              </span>
            ))}
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
