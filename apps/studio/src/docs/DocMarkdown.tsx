import { Fragment, isValidElement, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isClip, posterName, resolveImg } from './screenshots';
import type { LightboxImage } from './Lightbox';
import { headingIdMaker } from './toc';
import { Button } from '@/components/ui/button';
import { FocusedScreenshot, focusedScreenshot } from './FocusedScreenshot';
import { DottedIllustration, isDottedIllustration } from './DottedIllustration';
import { CLI_PLATFORM_MARKER, cliPlatformMarkdown, type CliPlatform } from './cliPlatform';

function text(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(text).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (isValidElement<{ children?: ReactNode }>(children)) return text(children.props.children);
  return '';
}

/** Readers who ask their system for less motion get a still poster and play controls. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Heading ids, shared with the "On this page" list (toc.ts). Keyed on the heading's AST node,
 * because StrictMode renders each heading twice with the same node; a plain counter would count
 * each heading twice and every anchor would point at nothing. Same fix as apps/web DocsPage.
 */
function makeHeadingId(): (node: object | undefined, children: ReactNode) => string {
  const next = headingIdMaker();
  const assigned = new WeakMap<object, string>();
  return (node, children) => {
    const existing = node && assigned.get(node);
    if (existing) return existing;
    const id = next(text(children));
    if (node) assigned.set(node, id);
    return id;
  };
}

export function DocMarkdown({
  content,
  onImageClick,
}: {
  content: string;
  onImageClick: (image: LightboxImage) => void;
}) {
  const [platform, setPlatform] = useState<CliPlatform>('linux');
  const headingId = makeHeadingId();
  const components: Components = {
    img(props) {
      const src = typeof props.src === 'string' ? props.src : '';
      const url = resolveImg(src);
      const alt = props.alt ?? '';
      if (url && isClip(src)) {
        const poster = resolveImg(posterName(src)) ?? undefined;
        const still = prefersReducedMotion();
        return (
          <span className="my-4 block">
            <button
              type="button"
              onClick={() => onImageClick({ url, alt, poster })}
              aria-label={alt ? `Enlarge: ${alt}` : 'Enlarge clip'}
              className="group block w-full max-w-2xl cursor-zoom-in overflow-hidden rounded-md border border-border transition-colors hover:border-ring"
            >
              <video
                src={url}
                poster={poster}
                autoPlay={!still}
                loop
                muted
                playsInline
                preload={still ? 'none' : 'metadata'}
                aria-label={alt}
                className="block w-full"
              />
            </button>
            {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
          </span>
        );
      }
      if (!url) {
        if (import.meta.env.DEV) console.warn(`[docs] unresolved image: ${src}`);
        return (
          <span className="my-3 block rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            {alt ? `Screenshot unavailable: ${alt}` : 'Screenshot unavailable'}
          </span>
        );
      }
      if (isDottedIllustration(src)) {
        return <DottedIllustration url={url} alt={alt} onImageClick={onImageClick} />;
      }
      if (focusedScreenshot(src)) {
        return <FocusedScreenshot src={src} url={url} alt={alt} onImageClick={onImageClick} />;
      }
      return (
        <span className="my-4 block">
          <button
            type="button"
            onClick={() => onImageClick({ url, alt })}
            aria-label={alt ? `Zoom: ${alt}` : 'Zoom screenshot'}
            className={`group block w-full ${/^(terminal-|proof-)/.test(src) ? 'max-w-[500px]' : 'max-w-2xl'} cursor-zoom-in overflow-hidden rounded-md border border-border transition-colors hover:border-ring`}
          >
            <img src={url} alt={alt} loading="lazy" className="block w-full" />
          </button>
          {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
        </span>
      );
    },
    a(props) {
      const href = typeof props.href === 'string' ? props.href : '';
      if (/^https?:\/\//.test(href)) {
        return <a href={href} target="_blank" rel="noopener noreferrer">{props.children}</a>;
      }
      // Internal docs link (e.g. /docs/report-designer): use a router Link so it resolves
      // against the app basename (/studio) instead of a bare absolute href that drops it.
      if (href.startsWith('/')) {
        return <Link to={href}>{props.children}</Link>;
      }
      return <a href={href}>{props.children}</a>;
    },
    // Every level takes an id, in page order, so the ids match extractToc() in toc.ts.
    h1: ({ node, children }) => <h1 id={headingId(node, children)} className="scroll-mt-4">{children}</h1>,
    h2: ({ node, children }) => <h2 id={headingId(node, children)} className="scroll-mt-4">{children}</h2>,
    h3: ({ node, children }) => <h3 id={headingId(node, children)} className="scroll-mt-4">{children}</h3>,
    h4: ({ node, children }) => <h4 id={headingId(node, children)} className="scroll-mt-4">{children}</h4>,
    h5: ({ node, children }) => <h5 id={headingId(node, children)} className="scroll-mt-4">{children}</h5>,
    h6: ({ node, children }) => <h6 id={headingId(node, children)} className="scroll-mt-4">{children}</h6>,
    // Wide reference tables scroll inside themselves instead of pushing the page sideways.
    table: ({ children }) => (
      <div className="max-w-full overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
  };

  const parts = cliPlatformMarkdown(content, platform).split(CLI_PLATFORM_MARKER);
  return <>{parts.map((part, index) => <Fragment key={index}>
    {index > 0 ? <span className="my-4 flex flex-wrap gap-2" role="group" aria-label="Linux, macOS, Windows">
      {(['linux', 'mac', 'windows'] as const).map((name) => <Button key={name} size="sm"
        variant={platform === name ? 'default' : 'outline'} aria-pressed={platform === name}
        onClick={() => setPlatform(name)}>{name === 'mac' ? 'macOS' : name === 'linux' ? 'Linux' : 'Windows'}</Button>)}
    </span> : null}
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{part}</ReactMarkdown>
  </Fragment>)}</>;

}
