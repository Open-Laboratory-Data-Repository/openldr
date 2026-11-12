import './DottedIllustration.css';
import { Button } from '@/components/ui/button';
import type { LightboxImage } from './Lightbox';

export function isDottedIllustration(src: string): boolean {
  return /^start-(terminal-(linux|mac|windows)-|proof-)/.test(src);
}

/** The image has a transparent margin. The page supplies the dots in its current theme. */
export function DottedIllustrationFrame({ url, alt }: { url: string; alt: string }) {
  return (
    <span className="doc-dotted-frame">
      <span className="doc-dotted-dots" aria-hidden="true" />
      <img src={url} alt={alt} loading="lazy" draggable={false} className="relative block h-auto w-full" style={{ margin: 0 }} />
    </span>
  );
}

export function DottedIllustration({ url, alt, onImageClick }: {
  url: string; alt: string; onImageClick: (image: LightboxImage) => void;
}) {
  return (
    <span className="my-4 block">
      <Button type="button" variant="ghost" aria-label={`Zoom: ${alt}`}
        onClick={() => onImageClick({ url, alt, illustration: true })}
        className="block h-auto w-full max-w-[500px] cursor-zoom-in rounded-none border-0 bg-transparent p-0 hover:bg-transparent">
        <DottedIllustrationFrame url={url} alt={alt} />
      </Button>
      {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
    </span>
  );
}
