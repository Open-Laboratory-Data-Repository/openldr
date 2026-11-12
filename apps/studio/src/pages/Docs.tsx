import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Download, ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../shell/AppShell';
import { isNarrowViewport, useIsNarrowViewport } from '@/lib/viewport';
import {
  DOC_GROUPS,
  DOC_GUIDES,
  DOC_VERSIONS,
  DEFAULT_DOC_VERSION,
  list,
  resolve,
  type DocAudience,
  type DocSection,
  type Locale,
} from '../docs/registry';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildIndex, searchDocs } from '../docs/search';
import { DocMarkdown } from '../docs/DocMarkdown';
import { Lightbox, type LightboxImage } from '../docs/Lightbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { exportDocs, type ExportFormat, type ExportScope } from '../docs/export/download';
import { extractToc, wantsToc, type TocEntry } from '../docs/toc';

/**
 * Scroll the reading pane to a heading. Same-page only, so the route never changes.
 *
 * Screenshots load lazily and have no size until they do, so a picture above the heading can
 * load after the jump and push the heading down out of view. For a moment after the jump,
 * any change in the article's size scrolls the heading back to the top.
 */
function goToHeading(id: string): void {
  const heading = document.getElementById(id);
  if (!heading) return;
  heading.scrollIntoView({ block: 'start' });
  const article = heading.closest('.doc-content');
  if (!article || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => heading.scrollIntoView({ block: 'start' }));
  // The reader scrolling on their own ends it at once.
  const stop = () => {
    observer.disconnect();
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(type, stop);
  };
  for (const type of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(type, stop, { passive: true });
  observer.observe(article);
  window.setTimeout(stop, 1500);
}

/** The heading the reader is in: the last one whose top has scrolled past the pane's top. */
function useActiveHeading(pane: RefObject<HTMLDivElement | null>, entries: TocEntry[]): string | null {
  const [active, setActive] = useState<string | null>(entries[0]?.id ?? null);
  useEffect(() => {
    const el = pane.current;
    if (!el || entries.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top + 24;
      let current = entries[0].id;
      for (const entry of entries) {
        const heading = document.getElementById(entry.id);
        if (heading && heading.getBoundingClientRect().top <= top) current = entry.id;
      }
      // The final heading may be too close to the page end to reach the pane's top.
      if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight
        && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) current = entries[entries.length - 1].id;
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pane, entries]);
  return active;
}

/** The right-hand "On this page" list. Only on wide screens; narrow ones get the toolbar menu. */
function OnThisPage({ entries, active, pane }: {
  entries: TocEntry[]; active: string | null; pane: RefObject<HTMLDivElement | null>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const reveal = useCallback((target: HTMLElement | null) => {
    const list = listRef.current;
    if (!list || !target || !list.clientHeight) return;
    const bounds = list.getBoundingClientRect();
    const item = target.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const followActive = () => reveal(list.querySelector<HTMLElement>('[aria-current="location"]'));
    followActive();
    const observer = new ResizeObserver(followActive);
    observer.observe(list);
    if (pane.current) observer.observe(pane.current);
    return () => observer.disconnect();
  }, [active, entries, pane, reveal]);
  return (
    <nav aria-label="On this page" className="sticky top-0 hidden max-h-[calc(100dvh-9rem)] w-56 shrink-0 self-start xl:flex xl:flex-col">
      <div className="shrink-0 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
        On this page
      </div>
      {/* Only code and keyboard focus move this list. Wheel input scrolls the article. */}
      <div ref={listRef} className="min-h-0 overflow-hidden" onFocus={(event) => reveal(event.target)}>
        {entries.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.id}`}
            aria-current={entry.id === active ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              goToHeading(entry.id);
            }}
            className={`block border-l-2 py-1 text-xs no-underline transition-colors ${
              entry.level === 3 ? 'pl-6 pr-3' : 'px-3'
            } ${
              entry.id === active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.text}
          </a>
        ))}
      </div>
    </nav>
  );
}

const AUDIENCE_LABELS: Record<DocAudience, string> = {
  'all-users': 'All users',
  'lab-users': 'Lab users',
  'lab-managers': 'Lab managers',
  administrators: 'Administrators',
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function GuideLink({
  section,
  activeSlug,
  onSelect,
}: {
  section: DocSection;
  activeSlug: string;
  onSelect?: () => void;
}) {
  return (
    <Link
      to={`/docs/${section.slug}`}
      onClick={onSelect}
      aria-current={section.slug === activeSlug ? 'page' : undefined}
      className={`block border-l-2 px-3 py-2 text-sm no-underline transition-colors ${
        section.slug === activeSlug
          ? 'border-primary bg-accent text-primary'
          : 'border-transparent text-foreground/85 hover:bg-accent hover:text-foreground'
      }`}
    >
      <span>{section.title}</span>
      {section.status === 'coming-soon' && (
        <Badge variant="outline" className="ml-2 align-middle text-[10px]">
          Coming soon
        </Badge>
      )}
    </Link>
  );
}

export function Docs() {
  const { slug } = useParams();
  const { i18n, t } = useTranslation();
  const locale: Locale = (['en', 'fr', 'pt'] as const).includes(i18n.language as Locale)
    ? (i18n.language as Locale)
    : 'en';
  const [query, setQuery] = useState('');
  // Collapse the docs table-of-contents by default on phone-width screens so the article gets the
  // full width; desktop opens expanded as before.
  const [collapsed, setCollapsed] = useState(
    isNarrowViewport,
  );
  // Close phone navigation on a route change or when the viewport first narrows.
  const narrow = useIsNarrowViewport();
  useEffect(() => { if (narrow) setCollapsed(true); }, [narrow, slug]);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [version, setVersion] = useState(DEFAULT_DOC_VERSION);
  const contentRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => list(locale, version), [locale, version]);
  const index = useMemo(() => buildIndex(sections), [sections]);
  const hits = useMemo(() => searchDocs(index, query), [index, query]);
  const sectionBySlug = useMemo(
    () => new Map(sections.map((candidate) => [candidate.slug, candidate])),
    [sections],
  );

  const defaultSlug = sections[0]?.slug ?? 'start-here';
  const activeSlug = slug ?? defaultSlug;
  const section = resolve(locale, activeSlug, version);
  // Reset the reading pane to the top whenever the active guide changes.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSlug]);
  // A link such as /docs/dashboard#load-the-sample-data opens that page at that heading.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() => goToHeading(decodeURIComponent(hash.slice(1))));
    return () => cancelAnimationFrame(frame);
  }, [activeSlug, hash]);
  const toc = useMemo(() => (section ? extractToc(section.content).filter((entry) => entry.level === 2) : []), [section?.content]);
  const showToc = wantsToc(toc);
  const activeHeading = useActiveHeading(contentRef, showToc ? toc : []);
  const navSections = useMemo(() => {
    if (!query.trim()) return sections;
    return hits
      .map((hit) => sectionBySlug.get(hit.slug))
      .filter((candidate): candidate is DocSection => candidate != null);
  }, [hits, query, sectionBySlug, sections]);
  const orderedSections = useMemo(
    () =>
      DOC_GUIDES.map((guide) => sectionBySlug.get(guide.slug)).filter(
        (candidate): candidate is DocSection => candidate != null,
      ),
    [sectionBySlug],
  );
  const activeIndex = orderedSections.findIndex((candidate) => candidate.slug === activeSlug);
  const previousSection = activeIndex > 0 ? orderedSections[activeIndex - 1] : null;
  const nextSection =
    activeIndex >= 0 && activeIndex < orderedSections.length - 1
      ? orderedSections[activeIndex + 1]
      : null;
  const relatedSections = section
    ? section.relatedSlugs
        .filter((relatedSlug) => relatedSlug !== section.slug)
        .map((relatedSlug) => sectionBySlug.get(relatedSlug))
        .filter((candidate): candidate is DocSection => candidate != null)
    : [];

  const onExport = (scope: ExportScope, format: ExportFormat) => {
    if (!section) return;
    setExportError(null);
    exportDocs({ scope, format, active: section, all: sections }).catch(() => {
      setExportError(`Could not export this page as ${format.toUpperCase()}.`);
    });
  };

  const navigation = (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          className={narrow ? 'h-11 w-11 shrink-0' : undefined}
          onClick={() => setCollapsed((c) => !c)}
          aria-label={
            collapsed ? 'Expand documentation sidebar' : 'Collapse documentation sidebar'
          }
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
        {!collapsed && (
          <Input
            className="min-w-0"
            placeholder="Search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search documentation"
          />
        )}
      </div>
      {!collapsed && (
        <div className="shrink-0 border-b border-border px-2 py-2">
          <Select value={version} onValueChange={setVersion}>
            <SelectTrigger
              className="h-8 w-full gap-1 px-2 text-xs"
              aria-label="Documentation version"
            >
              <span className="text-muted-foreground">Version</span>
              <span className="ml-auto text-right"><SelectValue /></span>
            </SelectTrigger>
            <SelectContent align="start">
              {DOC_VERSIONS.map((docVersion) => (
                <SelectItem key={docVersion} value={docVersion} className="text-xs">
                  {docVersion}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!collapsed && (
        <nav
          aria-label="Documentation sections"
          className="flex flex-1 flex-col overflow-y-auto py-1"
        >
          {query.trim() ? (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Search results
              </div>
              {navSections.map((navSection) => (
                <GuideLink
                  key={navSection.slug}
                  section={navSection}
                  activeSlug={activeSlug}
                  onSelect={() => { if (narrow) setCollapsed(true); }}
                />
              ))}
            </>
          ) : (
            DOC_GROUPS.map((group) => ({
              group,
              items: navSections.filter((navSection) => navSection.group === group.id),
            }))
              .filter((entry) => entry.items.length > 0)
              .map(({ group, items }, idx) => (
                <div
                  key={group.id}
                  className={`pb-1${idx > 0 ? ' mt-1 border-t border-border pt-2' : ''}`}
                >
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    {group.titles?.[locale] ?? group.title}
                  </div>
                  {items.map((navSection) => (
                    <GuideLink
                      key={navSection.slug}
                      section={navSection}
                      activeSlug={activeSlug}
                      onSelect={() => { if (narrow) setCollapsed(true); }}
                    />
                  ))}
                </div>
              ))
          )}
          {navSections.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No results.</p>
          )}
        </nav>
      )}
    </>
  );

  return (
    <AppShell title="Documentation" fullBleed>
      {/* Edge-to-edge: no outer frame or padding — structure comes only from the
          sidebar border-r and the matching h-12 header separators (corlix style). */}
      <div className="ui-scope flex min-h-0 flex-1 overflow-hidden">
        {/* Inner sidebar — a border-r column (not a card), collapsible. */}
        {narrow ? (
          <Sheet open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
            <aside className="flex w-12 shrink-0 flex-col border-r border-border">
              <div className="flex h-12 shrink-0 items-center justify-center border-b border-border">
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Expand documentation sidebar">
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
              </div>
            </aside>
            <SheetContent
              hideClose
              aria-describedby={undefined}
              className="left-0 right-auto h-dvh w-72 max-w-[calc(100vw-3rem)] gap-0 overflow-hidden border-l-0 border-r p-0"
            >
              <SheetTitle className="sr-only">{t('nav.docs')}</SheetTitle>
              {navigation}
            </SheetContent>
          </Sheet>
        ) : (
          <aside
            className={`flex shrink-0 flex-col border-r border-border transition-[width] duration-200 ease-in-out ${collapsed ? 'w-12' : 'w-64'}`}
          >
            {navigation}
          </aside>
        )}

        {/* Content — borderless; the toolbar matches the sidebar header height (h-12)
            so the two bottom borders line up across the page. */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-2">
            {exportError && (
              <span role="status" aria-live="polite" className="mr-auto text-xs text-destructive">
                {exportError}
              </span>
            )}
            {showToc && (
              // Every task remains available, including those outside the pinned panel's view.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="On this page">
                    <ListTree className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[70dvh] max-w-[80vw] overflow-y-auto">
                  {toc.map((entry) => (
                    <DropdownMenuItem
                      key={entry.id}
                      className={entry.level === 3 ? 'pl-6 text-xs' : 'text-sm'}
                      onSelect={() => goToHeading(entry.id)}
                    >
                      {entry.text}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Download documentation">
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(['page', 'all'] as ExportScope[]).map((scope) => (
                  <DropdownMenuSub key={scope}>
                    <DropdownMenuSubTrigger>
                      {scope === 'page' ? 'This page' : 'All docs'}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'md')}>
                        Markdown (.md)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'pdf')}>
                        PDF (.pdf)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'docx')}>
                        Word (.docx)
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
            <div className="flex gap-8">
            <div className="min-w-0 flex-1">
            {!section ? (
              <p className="text-sm text-muted-foreground">
                Documentation page not found.{' '}
                <Link to="/docs" className="text-primary">
                  All docs
                </Link>
              </p>
            ) : (
              <>
                {section.localeUsed !== locale && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Shown in English — not yet translated.
                  </p>
                )}
                <div className="mb-4 flex flex-wrap gap-2" aria-label="Guide metadata">
                  {section.audience.map((audience) => (
                    <Badge key={audience} variant="secondary">
                      {AUDIENCE_LABELS[audience]}
                    </Badge>
                  ))}
                  {section.requiredRoles.length === 0 ? (
                    <Badge variant="outline">No special role</Badge>
                  ) : (
                    section.requiredRoles.map((role) => (
                      <Badge key={role} variant="outline">
                        {role}
                      </Badge>
                    ))
                  )}
                  <Badge variant="outline">About {section.estimatedMinutes} minutes</Badge>
                  <Badge variant="outline">{titleCase(section.difficulty)}</Badge>
                </div>
                <div className="doc-content">
                  <DocMarkdown content={section.content} onImageClick={setLightbox} />
                </div>
                {(previousSection || nextSection || relatedSections.length > 0) && (
                  <div className="mt-8 border-t border-border pt-4">
                    <div className="flex flex-wrap justify-between gap-3">
                      {previousSection ? (
                        <Link to={`/docs/${previousSection.slug}`} className="text-sm text-primary">
                          Previous: {previousSection.title}
                        </Link>
                      ) : (
                        <span />
                      )}
                      {nextSection && (
                        <Link to={`/docs/${nextSection.slug}`} className="text-sm text-primary">
                          Next: {nextSection.title}
                        </Link>
                      )}
                    </div>
                    {relatedSections.length > 0 && (
                      <div className="mt-4">
                        <h2 className="text-base font-semibold">Related guides</h2>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {relatedSections.map((relatedSection) => (
                            <Link
                              key={relatedSection.slug}
                              to={`/docs/${relatedSection.slug}`}
                              className="rounded-md border border-border px-3 py-1 text-sm text-primary no-underline hover:bg-accent"
                            >
                              {relatedSection.title}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            </div>
            {showToc && <OnThisPage entries={toc} active={activeHeading} pane={contentRef} />}
            </div>
          </div>
        </section>
      </div>
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </AppShell>
  );
}
