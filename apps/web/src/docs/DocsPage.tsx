import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
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
  NAV,
  TITLES,
  docBody,
} from './content';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function textContent(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(textContent).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
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
  const used = new Map<string, number>();
  const assigned = new WeakMap<object, string>();

  return (node, children) => {
    const existing = node && assigned.get(node);
    if (existing) return existing;

    const base = slugify(textContent(children));
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    if (node) assigned.set(node, id);
    return id;
  };
}

function markdownComponents(): Components {
  const headingId = makeHeadingId();
  return {
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

export function DocsPage() {
  const { page } = useParams();
  const [version, setVersion] = useState(DEFAULT_DOC_VERSION);
  const key = page && TITLES[page] ? page : 'getting-started';
  const body = docBody(key, version);

  // Opening another page keeps the window's scroll position, which drops the reader into the
  // middle of the new page. Same-page anchor links do not change `key`, so their smooth scroll
  // is left alone.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [key]);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
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
            {TITLES[key]}
          </h1>
        </div>
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
    </div>
  );
}
