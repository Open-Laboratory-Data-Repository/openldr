import { isValidElement, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DOC_VERSIONS,
  DEFAULT_DOC_VERSION,
  GUIDE_LOCALES,
  NAV,
  TITLES,
  docBody,
  guideBody,
  resolveMedia,
  type GuideLocale,
} from './content';
import { selectLanguage } from './language';
import { extractToc, headingIdMaker, wantsToc, type TocEntry } from './toc';

function textContent(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(textContent).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (isValidElement<{ children?: ReactNode }>(children)) return textContent(children.props.children);
  return '';
}

const LANGUAGE_KEY = 'openldr.docs.lang';

/** The language last picked here, else the browser's when the docs are written in it, else English. */
function initialLocale(): GuideLocale {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'fr' || saved === 'pt') return saved;
  } catch {
    // Storage can be blocked. The browser's language still works.
  }
  const lang = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  return lang === 'fr' || lang === 'pt' ? lang : 'en';
}

function rememberLocale(locale: GuideLocale): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, locale);
  } catch {
    // Not remembered, but the page still switches.
  }
}

/** Notes shown above a page that is not fully in the reader's language, in that language. */
const NOTES: Record<GuideLocale, { englishOnly: string; partlyEnglish: string }> = {
  en: { englishOnly: '', partlyEnglish: '' },
  fr: {
    englishOnly: "Cette page n'existe qu'en anglais pour le moment.",
    partlyEnglish: "Certaines parties de cette page ne sont pas encore traduites et s'affichent en anglais.",
  },
  pt: {
    englishOnly: 'Esta página ainda só existe em inglês.',
    partlyEnglish: 'Algumas partes desta página ainda não estão traduzidas e aparecem em inglês.',
  },
};

/** A guide's own `# Title`, so a translated guide shows a translated title. */
function firstHeading(markdown: string): string | null {
  const match = /^\s*#\s+(.+)$/m.exec(markdown);
  return match ? match[1].trim() : null;
}

function scrollToHeading(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The app runs under a HashRouter, so raw docs links can collide with client
// routing. Render internal page links through react-router and same-page anchors
// through scrollIntoView so they do not replace the route hash.
/**
 * Drops the body's own leading `# Title`, which the page already prints above the article.
 *
 * This used to be a "skip the first h1" flag inside the renderer. That flag is mutable state
 * driven by render order, and React's StrictMode renders twice — the second pass reused a closure
 * whose flag was already spent, so the title rendered twice in the browser while jsdom tests,
 * which do not double-render, saw one. Editing the source instead is order-independent.
 */
export function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#[^#\n][^\n]*\n+/, '');
}

/**
 * Assigns each heading an id, suffixing a repeat so two headings never claim one anchor.
 *
 * The counter is keyed on the heading's AST node, not just bumped per call. StrictMode invokes
 * every heading component twice with the SAME node object, and a plain counter therefore counted
 * each heading twice — ids came out suffixed `-1` in the browser and every in-page anchor pointed
 * at nothing, while this app's tests, which do not double-render, saw clean ids. Keyed on the node,
 * the second invocation returns the id already assigned.
 *
 * (react-markdown v10 does not put `position` on the node it passes, so the source line is not
 * available to key on — the node's identity is.)
 */
function makeHeadingId(): (node: object | undefined, children: ReactNode) => string {
  // Same id rules as the "On this page" list (toc.ts), so every entry finds its heading.
  const next = headingIdMaker();
  const assigned = new WeakMap<object, string>();

  return (node, children) => {
    const existing = node && assigned.get(node);
    if (existing) return existing;

    const id = next(textContent(children));
    if (node) assigned.set(node, id);
    return id;
  };
}

/** A clip (`x.mp4`) plays muted on a loop, with its `x.png` poster. A screenshot opens full size. */
function DocMedia({ src, alt }: { src: string; alt: string }) {
  const url = resolveMedia(src);
  if (!url) {
    return (
      <span className="my-3 block rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        {alt ? `Screenshot unavailable: ${alt}` : 'Screenshot unavailable'}
      </span>
    );
  }
  if (/\.mp4$/i.test(src)) {
    const still = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return (
      <span className="my-4 block">
        <video
          src={url}
          poster={resolveMedia(src.replace(/\.mp4$/i, '.png')) ?? undefined}
          autoPlay={!still}
          loop
          muted
          playsInline
          controls
          preload={still ? 'none' : 'metadata'}
          aria-label={alt}
          className="block w-full rounded-md border border-border"
        />
        {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
      </span>
    );
  }
  return (
    <span className="my-4 block">
      <a href={url} target="_blank" rel="noreferrer noopener" aria-label={alt ? `Open full size: ${alt}` : 'Open full size'}>
        <img src={url} alt={alt} className="block w-full rounded-md border border-border" />
      </a>
      {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
    </span>
  );
}

function markdownComponents(): Components {
  const headingId = makeHeadingId();
  return {
    img({ src, alt }) {
      return <DocMedia src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />;
    },
    h4({ children, node }) {
      return <h4 id={headingId(node, children)} className="scroll-mt-20">{children}</h4>;
    },
    h1({ children, node }) {
      return <h1 id={headingId(node, children)} className="scroll-mt-20">{children}</h1>;
    },
    h2({ children, node }) {
      return <h2 id={headingId(node, children)} className="scroll-mt-20">{children}</h2>;
    },
    h3({ children, node }) {
      return <h3 id={headingId(node, children)} className="scroll-mt-20">{children}</h3>;
    },
    table({ children }: ComponentProps<'table'>) {
      return (
        <div className="max-w-full overflow-x-auto">
          <table>{children}</table>
        </div>
      );
    },
    a({ href, children }: ComponentProps<'a'>) {
      if (href?.startsWith('#')) {
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(href.slice(1))?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              });
            }}
          >
            {children}
          </a>
        );
      }
      if (href && href.startsWith('/')) {
        // A shared guide links to in-app pages. The website only has some of them, so a link
        // to one it lacks reads as plain text instead of landing on the wrong page.
        const docsSlug = href.match(/^\/docs\/([^/#?]+)/)?.[1];
        if (docsSlug && !TITLES[docsSlug]) return <span>{children}</span>;
        return <Link to={href}>{children}</Link>;
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };
}

function NavLink({ slug, active, nested }: { slug: string; active: string; nested?: boolean }) {
  const isActive = slug === active;
  return (
    <Link
      to={`/docs/${slug}`}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'block rounded-md px-3 py-2 text-sm no-underline transition-colors',
        nested ? 'ml-3' : '',
        isActive
          ? 'bg-accent text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {TITLES[slug]}
    </Link>
  );
}

function OnThisPage({ entries }: { entries: TocEntry[] }) {
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={(event) => {
              event.preventDefault();
              scrollToHeading(entry.id);
            }}
            className={[
              'block border-l-2 border-transparent py-1 text-xs text-muted-foreground no-underline hover:text-foreground',
              entry.level === 3 ? 'pl-6 pr-2' : 'px-3',
            ].join(' ')}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DocsPage() {
  const { page } = useParams();
  const [version, setVersion] = useState(DEFAULT_DOC_VERSION);
  const [locale, setLocale] = useState<GuideLocale>(initialLocale);
  const key = page && TITLES[page] ? page : 'getting-started';
  // A studio section shows its long guide, shared with the app, in the reader's language.
  const guide = guideBody(key, version, locale);
  // The site's own pages hold all three languages; keep only the reader's.
  const own = guide ? null : docBody(key, version);
  const view = useMemo(() => (own == null ? null : selectLanguage(own, locale)), [own, locale]);
  const body = guide?.body ?? view?.markdown ?? null;
  const note = locale === 'en'
    ? ''
    : guide
      ? guide.localeUsed !== locale ? NOTES[locale].englishOnly : ''
      : view && !view.translated ? NOTES[locale].englishOnly : view?.partlyEnglish ? NOTES[locale].partlyEnglish : '';
  const title = guide && guide.localeUsed === locale && locale !== 'en' ? firstHeading(guide.body) ?? TITLES[key] : TITLES[key];
  const changeLocale = (value: string): void => {
    setLocale(value as GuideLocale);
    rememberLocale(value as GuideLocale);
  };
  const toc = useMemo(() => (body ? extractToc(stripLeadingH1(body)) : []), [body]);
  const showToc = wantsToc(toc);

  // Opening another page keeps the window's scroll position, which drops the reader into the
  // middle of the new page. Same-page anchor links do not change `key`, so their smooth scroll
  // is left alone.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [key]);

  return (
    <div
      className={[
        'mx-auto grid gap-8 px-6 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]',
        showToc ? 'max-w-7xl xl:grid-cols-[16rem_minmax(0,1fr)_13rem]' : 'max-w-6xl',
      ].join(' ')}
    >
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase text-primary">Documentation</p>
        </div>
        <Select value={version} onValueChange={setVersion}>
          <SelectTrigger className="h-8 w-full gap-1 px-2 text-xs" aria-label="Documentation version">
            {/* The trigger spreads its children apart, so without ml-auto the version floats in
                the middle instead of sitting beside the chevron. Radix's SelectValue drops a
                className, hence the wrapper. */}
            <span className="text-muted-foreground">Version</span>
            <span className="ml-auto">
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {DOC_VERSIONS.map((docVersion) => (
              <SelectItem key={docVersion} value={docVersion} className="text-xs">
                {docVersion}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={locale} onValueChange={changeLocale}>
          <SelectTrigger className="mt-2 h-8 w-full gap-1 px-2 text-xs" aria-label="Documentation language">
            <span className="text-muted-foreground">Language</span>
            <span className="ml-auto">
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {GUIDE_LOCALES.map((option) => (
              <SelectItem key={option.id} value={option.id} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <nav aria-label="Public documentation" className="mt-4 space-y-1 border-t border-border pt-4">
          {NAV.map((item) => (
            <div key={item.slug} className="space-y-1">
              <NavLink slug={item.slug} active={key} />
              {item.children?.map((child) => (
                <NavLink key={child} slug={child} active={key} nested />
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <article className="doc-content min-w-0 max-w-3xl" aria-labelledby="doc-title">
        <div className="mb-6 border-b border-border pb-4">
          <p className="text-xs font-medium text-muted-foreground">OpenLDR {version}</p>
          {/* The page's own h1. The sidebar's "Documentation" is a label, not a heading, so the
              open doc's title is the top of the outline. */}
          <h1 id="doc-title" className="mt-1 text-3xl font-semibold">
            {title}
          </h1>
        </div>
        {note && <p className="mb-4 text-xs text-muted-foreground">{note}</p>}
        {showToc && (
          // Narrow screens have no right-hand column, so the list folds up above the article.
          <details className="mb-6 rounded-md border border-border px-3 py-2 xl:hidden">
            <summary className="cursor-pointer text-sm font-medium">On this page</summary>
            <div className="mt-2">
              <OnThisPage entries={toc} />
            </div>
          </details>
        )}
        {body == null ? (
          <p className="text-muted-foreground">This page is not available for version {version}.</p>
        ) : (
          <div className="doc-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
              {stripLeadingH1(body)}
            </ReactMarkdown>
          </div>
        )}
      </article>
      {showToc && (
        <nav
          aria-label="On this page"
          className="hidden max-h-[calc(100dvh-6rem)] overflow-y-auto xl:sticky xl:top-20 xl:block xl:self-start"
        >
          <p className="px-3 pb-2 text-xs font-semibold uppercase text-primary">On this page</p>
          <OnThisPage entries={toc} />
        </nav>
      )}
    </div>
  );
}
