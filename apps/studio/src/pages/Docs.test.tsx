import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { Docs } from './Docs';

const registry = vi.hoisted(() => {
  const groups = [
    { id: 'start', title: 'Start here' },
    { id: 'daily-work', title: 'Daily work' },
    { id: 'data-design', title: 'Data and design' },
    { id: 'administration', title: 'Administration' },
    { id: 'more', title: 'More' },
  ];

  const guideData = [
    ['start-here', 'Start Here', 'start', ['dashboard', 'reports', 'advanced-docs']],
    ['dashboard', 'Dashboard', 'daily-work', ['reports', 'workflows']],
    ['reports', 'Reports', 'daily-work', ['dashboard', 'audit']],
    ['workflows', 'Workflows', 'data-design', ['reports', 'connectors', 'audit']],
    ['forms', 'Forms', 'data-design', ['terminology', 'marketplace']],
    ['terminology', 'Terminology', 'data-design', ['forms', 'audit']],
    ['users', 'Users and Roles', 'administration', ['audit', 'settings']],
    ['audit', 'Audit', 'administration', ['users', 'workflows']],
    ['settings', 'Settings', 'administration', ['connectors', 'marketplace']],
    ['connectors', 'Connectors', 'administration', ['settings', 'workflows', 'marketplace']],
    ['marketplace', 'Marketplace', 'administration', ['settings', 'connectors', 'forms']],
    ['advanced-docs', 'Advanced Docs — Coming soon', 'more', ['start-here', 'settings']],
  ] as const;

  const guides = guideData.map(([slug, title, group, relatedSlugs], index) => ({
    slug,
    title,
    group,
    summary: slug === 'workflows' ? 'Create and run workflows.' : `Guide for ${title}.`,
    audience: ['all-users'],
    requiredRoles: slug === 'users' ? ['lab_admin'] : [],
    estimatedMinutes: slug === 'start-here' ? 8 : index + 5,
    difficulty: slug === 'advanced-docs' ? 'advanced' : 'beginner',
    relatedSlugs,
    screenshotNames: [],
    status: slug === 'advanced-docs' ? 'coming-soon' : 'published',
  }));

  const sections = guides.map((guide) => ({
    ...guide,
    content:
      guide.slug === 'advanced-docs'
        ? '# Advanced Docs — Coming soon\n\nThe separate advanced web app does not exist yet.'
        : guide.slug === 'workflows'
          ? '# Workflows\n\nCreate workflow procedures for training.'
        : guide.slug === 'audit'
          ? '# Audit\n\n## First part\n\n### 1. Open the list\n\nOne.\n\n## Second part\n\n### 1. Inspect the row\n\nTwo.\n\n## Third part\n\n### 1. Finish the task\n\nThree.'
        : `# ${guide.title}\n\nStep-by-step content for ${guide.title}.`,
    localeUsed: 'en',
  }));

  return { groups, guides, sections };
});

vi.mock('../docs/registry', () => ({
  DOC_GROUPS: registry.groups,
  DOC_GUIDES: registry.guides,
  DOC_VERSIONS: ['0.1.0'],
  DEFAULT_DOC_VERSION: '0.1.0',
  list: vi.fn((locale: string) =>
    registry.sections.map((section) => ({ ...section, localeUsed: locale === 'en' ? 'en' : 'en' })),
  ),
  resolve: vi.fn((locale: string, slug: string) => {
    const section = registry.sections.find((candidate) => candidate.slug === slug);
    return section ? { ...section, localeUsed: locale === 'en' ? 'en' : 'en' } : null;
  }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:slug" element={<Docs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsLayout', () => {
  it('groups the documentation sidebar and excludes retired guides', () => {
    renderAt('/docs');
    const nav = screen.getByRole('navigation', { name: 'Documentation sections' });

    expect(within(nav).getByText('Start here')).toBeInTheDocument();
    expect(within(nav).getByText('Daily work')).toBeInTheDocument();
    expect(within(nav).getByText('Data and design')).toBeInTheDocument();
    expect(within(nav).getByText('Administration')).toBeInTheDocument();
    expect(within(nav).getByText('More')).toBeInTheDocument();
    expect(within(nav).queryByText(/DHIS2/i)).toBeNull();
  });

  it('renders Start Here by default at /docs', () => {
    renderAt('/docs');
    expect(screen.getByRole('heading', { level: 1, name: 'Start Here' })).toBeInTheDocument();
  });

  it('shows metadata, next navigation, and related guides for the active guide', () => {
    renderAt('/docs');

    expect(screen.getByText('About 8 minutes')).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('All users')).toBeInTheDocument();
    expect(screen.getByText('No special role')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next: Dashboard/i })).toHaveAttribute(
      'href',
      '/docs/dashboard',
    );
    const related = screen.getByRole('heading', { level: 2, name: 'Related guides' }).parentElement!;
    expect(related).toBeInTheDocument();
    expect(within(related).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/docs/reports',
    );
  });

  it('renders the advanced docs placeholder guide', () => {
    renderAt('/docs/advanced-docs');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Advanced Docs — Coming soon' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
  });

  it('shows a flat search result group while searching', () => {
    renderAt('/docs');
    fireEvent.change(screen.getByLabelText('Search documentation'), {
      target: { value: 'create workflow' },
    });

    const nav = screen.getByRole('navigation', { name: 'Documentation sections' });
    expect(within(nav).getByText('Search results')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Workflows' })).toBeInTheDocument();
    expect(within(nav).queryByText('Daily work')).toBeNull();
  });

  it('shows a not-found panel for an unknown or retired slug', () => {
    renderAt('/docs/dhis2');
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('lists the sections of a long page on the right and opens a #heading link there', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
    try {
      renderAt('/docs/audit#third-part');
      const list = screen.getByRole('navigation', { name: 'On this page' });
      expect(within(list).getByRole('link', { name: 'Second part' })).toHaveAttribute('href', '#second-part');
      await waitFor(() => expect(scrolled).toContain('third-part'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('lists task headings while retaining numbered steps in the article and links', async () => {
    renderAt('/docs/audit');
    const list = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(list).getAllByRole('link').map((link) => link.textContent)).toEqual(['First part', 'Second part', 'Third part']);
    expect(screen.getByRole('heading', { level: 3, name: '1. Open the list' })).toHaveAttribute('id', '1-open-the-list');
    const trigger = screen.getByRole('button', { name: 'On this page' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['First part', 'Second part', 'Third part']);
  });

  it('keeps the active task visible without scrolling the article to its heading', async () => {
    renderAt('/docs/audit');
    const list = screen.getByRole('navigation', { name: 'On this page' });
    const first = within(list).getByRole('link', { name: 'First part' });
    const third = within(list).getByRole('link', { name: 'Third part' });
    const scroller = first.parentElement!;
    const pane = screen.getByRole('heading', { level: 1, name: 'Audit' }).closest('.overflow-y-auto')!;
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 200, x: 0, y: top, width: 200, height: bottom-top, toJSON: () => ({}) });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => rect(0, 100));
    vi.spyOn(first, 'getBoundingClientRect').mockImplementation(() => rect(0, 20));
    vi.spyOn(third, 'getBoundingClientRect').mockImplementation(() => rect(160, 180));
    vi.spyOn(pane, 'getBoundingClientRect').mockImplementation(() => rect(0, 500));
    const secondHeading = screen.getByRole('heading', { level: 2, name: 'Second part' });
    const thirdHeading = screen.getByRole('heading', { level: 2, name: 'Third part' });
    vi.spyOn(secondHeading, 'getBoundingClientRect').mockImplementation(() => rect(400, 420));
    const thirdRect = vi.spyOn(thirdHeading, 'getBoundingClientRect').mockImplementation(() => rect(500, 520));
    fireEvent.scroll(pane);
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'location'));
    (pane as HTMLElement).scrollTop = 222;
    thirdRect.mockImplementation(() => rect(10, 30));
    fireEvent.scroll(pane);
    await waitFor(() => expect(third).toHaveAttribute('aria-current', 'location'));
    expect(scroller.scrollTop).toBe(80);
    expect(pane.scrollTop).toBe(222);
  });

  it('exposes a download menu in the toolbar', () => {
    renderAt('/docs');
    expect(screen.getByRole('button', { name: 'Download documentation' })).toBeInTheDocument();
  });

  it('collapses and expands the sidebar', () => {
    renderAt('/docs');
    expect(screen.getByRole('navigation', { name: 'Documentation sections' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse documentation sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Documentation sections' })).toBeNull();
    expect(screen.queryByLabelText('Search documentation')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand documentation sidebar' }));
    expect(screen.getByRole('navigation', { name: 'Documentation sections' })).toBeInTheDocument();
  });

  it('does not render a language Select in the toolbar (locale derives from app language)', () => {
    renderAt('/docs');
    expect(screen.queryByLabelText('Language')).toBeNull();
  });
});

describe('DocsLayout locale derivation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('defaults to English content when app language is en', () => {
    renderAt('/docs');
    expect(screen.getByRole('heading', { level: 1, name: 'Start Here' })).toBeInTheDocument();
    expect(screen.queryByText(/Shown in English/)).toBeNull();
  });

  it('uses English fallback when app language is fr', async () => {
    await i18n.changeLanguage('fr');
    renderAt('/docs');
    expect(screen.getByText(/Shown in English/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Start Here' })).toBeInTheDocument();
  });
});

// jsdom has no matchMedia; fake one whose width can change after render. It applies the
// max-width in the query, so a page that passes its own breakpoint is checked against it.
let viewportWidth = 1280;
const viewportListeners = new Set<() => void>();
function fakeMatchMedia(): void {
  viewportWidth = 1280;
  viewportListeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() { return viewportWidth <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity); },
    media: query,
    addEventListener: (_: string, fn: () => void) => viewportListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => viewportListeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
}
const resizeTo = (w: number) => act(() => { viewportWidth = w; viewportListeners.forEach((fn) => fn()); });

describe('DocsLayout narrow viewport', () => {
  beforeEach(fakeMatchMedia);
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

  it('collapses the sidebar when the viewport narrows after a wide load', () => {
    renderAt('/docs');
    expect(screen.getByRole('button', { name: 'Collapse documentation sidebar' })).toBeInTheDocument();
    resizeTo(375);
    expect(screen.getByRole('button', { name: 'Expand documentation sidebar' })).toBeInTheDocument();
  });
});
