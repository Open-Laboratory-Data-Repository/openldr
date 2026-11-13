import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsPage, stripLeadingH1 } from './DocsPage';

function renderDocs(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:page" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsPage', () => {
  it('keeps the restored sign-in crop and theme identical when enlarged', async () => {
    document.documentElement.dataset.theme = 'dark';
    renderDocs('/docs/install');
    const trigger = screen.getByRole('button', { name: 'Enter labadmin and your generated App sign-in password in these two fields.' });
    expect(within(trigger).getByRole('img')).toHaveAttribute('src', '/docs-images/install/credentials.png');
    fireEvent.click(trigger);
    const enlarged = screen.getByRole('dialog');
    expect(within(enlarged).getByRole('img')).toHaveAttribute('src', '/docs-images/install/credentials.png');
    const clips = (element: HTMLElement) => [...element.querySelectorAll('img')].map(image => image.style.clipPath);
    expect(clips(enlarged)).toEqual(clips(trigger));
    document.documentElement.dataset.theme = 'light';
    await waitFor(() => {
      expect(within(trigger).getByRole('img')).toHaveAttribute('src', '/docs-images/install/credentials-light.png');
      expect(within(enlarged).getByRole('img')).toHaveAttribute('src', '/docs-images/install/credentials-light.png');
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    delete document.documentElement.dataset.theme;
  });

  it('follows the section reached by page scrolling', async () => {
    renderDocs('/docs/requirements');
    const headings = [...document.querySelectorAll<HTMLElement>('.doc-markdown h2')];
    const positions = headings.map((_, index) => index < 2 ? -400 + index * 450 : 2000 + index * 100);
    headings.forEach((heading, index) => { heading.getBoundingClientRect = () => ({ top: positions[index], bottom: positions[index] + 30, left: 0, right: 600, width: 600, height: 30, x: 0, y: positions[index], toJSON() {} }); });
    fireEvent.scroll(window);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: headings[1].textContent! })).toHaveAttribute('aria-current', 'location'));
    positions[2] = 80;
    fireEvent.scroll(window);
    await waitFor(() => expect(within(nav).getByRole('link', { name: headings[2].textContent! })).toHaveAttribute('aria-current', 'location'));
    expect(within(nav).getByRole('link', { name: headings[1].textContent! })).not.toHaveAttribute('aria-current');
  });

  it('lists only the sections of the standalone page in On this page, not its numbered steps', () => {
    renderDocs('/docs/standalone');
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(nav).getAllByRole('link').map(link => link.textContent);
    const sections = [...document.querySelectorAll<HTMLElement>('.doc-markdown h2')].map(heading => heading.textContent);
    expect(sections).toContain('Build it');
    expect(links).toEqual(sections);
    for (const step of document.querySelectorAll<HTMLElement>('.doc-markdown h3')) {
      expect(links).not.toContain(step.textContent);
    }
  });

  it('renders the installer illustration without stripping its media identifier', () => {
    renderDocs('/docs/getting-started');
    expect(screen.getByRole('img', { name: /Illustration of installer output/ })).toBeInTheDocument();
    expect(screen.queryByText(/Screenshot unavailable/)).toBeNull();
  });


  it('leaves the studio user guides to the in-app docs', () => {
    renderDocs('/docs/dashboard');
    const nav = screen.getByRole('navigation', { name: /public documentation/i });
    for (const name of [
      'Dashboards', 'Reports', 'Custom queries', 'Workflows', 'Forms', 'Facilities', 'Test catalog', 'Patients',
      'Activity and payload history', 'Laboratory setup', 'Data exposure', 'Setup checks', 'User preferences',
      // Short pages about studio screens. The in-app guides hold the same text in en, fr and pt.
      'Workflow canvas navigation', 'Workflow webhooks', 'Query names', 'Export and import queries', 'Query groups',
      'Dashboard refresh', 'Dashboard query limits', 'Query result paging', 'Connector query deadlines',
      'Report schedules', 'Marketplace permission checks', 'Layouts', 'Plugin cards and side panels',
    ]) {
      expect(within(nav).queryByRole('link', { name })).toBeNull();
    }
    // An in-app slug is not a website page, so it falls back to Getting started.
    expect(screen.getByRole('link', { name: 'Getting started' })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.doc-markdown video')).toBeNull();
  });

  it('renders links to pages only the in-app docs have as plain text', () => {
    renderDocs('/docs/getting-started');
    const article = document.querySelector('.doc-markdown') as HTMLElement;
    for (const link of within(article).queryAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^\/docs\/(dashboard|reports|query|workflows|forms|facilities|patients)$/);
    }
  });

  it('translates the sidebar and the title with the page', () => {
    window.localStorage.setItem('openldr.docs.lang', 'fr');
    renderDocs('/docs/upgrading');
    const nav = screen.getByRole('navigation', { name: /public documentation/i });
    expect(within(nav).getByRole('link', { name: 'Mises à niveau planifiées' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: "Fournisseurs d'authentification" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Mises à niveau planifiées' })).toBeInTheDocument();
    expect(screen.queryByText(/pas encore traduites|qu'en anglais/)).toBeNull();
    window.localStorage.removeItem('openldr.docs.lang');
  });

  it('offers the language picker on every page', () => {
    renderDocs('/docs/install');
    expect(screen.getByRole('combobox', { name: 'Documentation language' })).toBeInTheDocument();
  });

  it('opens the current documentation version and keeps the previous version selectable', () => {
    renderDocs('/docs/requirements');
    expect(screen.getByLabelText('Documentation version')).toHaveTextContent('0.1.8');
    fireEvent.keyDown(screen.getByLabelText('Documentation version'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: '0.1.0' }));
    expect(screen.getByLabelText('Documentation version')).toHaveTextContent('0.1.0');
    expect(screen.getByRole('heading', { level: 1, name: 'Requirements' })).toBeInTheDocument();
  });
  it('shows authentication provider guidance in one language at a time, and switches', () => {
    renderDocs('/docs/auth-providers');
    expect(screen.getByRole('heading', { level: 1, name: 'Authentication providers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Authentication providers' })).toHaveAttribute('aria-current', 'page');
    // The page's own English section, with no language headings and no French or Portuguese copy.
    expect(screen.getByRole('heading', { name: 'Choose authentication and administration' })).toBeInTheDocument();
    for (const name of ['English', 'Français', 'Português']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: "Choisir l'authentification et l'administration" })).toBeNull();
    expect([...document.querySelectorAll('.doc-markdown pre code')].filter(node => node.textContent?.trim() === './openldr user assign-role SUBJECT lab_admin')).toHaveLength(1);

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Documentation language' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Français' }));
    expect(screen.getByRole('heading', { name: "Choisir l'authentification et l'administration" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Choose authentication and administration' })).toBeNull();
    expect([...document.querySelectorAll('.doc-markdown pre code')].filter(node => node.textContent?.trim() === './openldr user assign-role SUBJECT lab_admin')).toHaveLength(1);
    expect(window.localStorage.getItem('openldr.docs.lang')).toBe('fr');
    window.localStorage.removeItem('openldr.docs.lang');
  });





  it('renders a professional docs shell for a public doc page', () => {
    renderDocs('/docs/install');

    expect(screen.getByRole('navigation', { name: /public documentation/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Documentation version')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'page');
    for (const table of screen.getAllByRole('table')) expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(screen.getAllByRole('heading', { name: 'Install' })).toHaveLength(1);
  });

  it('falls back to getting started when the route slug is unknown', () => {
    renderDocs('/docs/not-a-page');

    expect(screen.getByRole('link', { name: 'Getting started' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('scrolls same-page markdown anchor links without replacing the router hash', () => {
    const originalHash = window.location.hash;
    const scrollIntoView = vi.fn();

    try {
      renderDocs('/docs/environment');
      const adapters = document.getElementById('adapters');
      expect(adapters).not.toBeNull();
      if (!adapters) throw new Error('Adapters heading was not rendered');
      expect(adapters).toHaveClass('scroll-mt-20');
      adapters.scrollIntoView = scrollIntoView;
      window.location.hash = '#/docs/environment';

      fireEvent.click(within(document.querySelector('.doc-markdown') as HTMLElement).getByRole('link', { name: 'Adapters' }));

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(window.location.hash).toBe('#/docs/environment');
    } finally {
      window.location.hash = originalHash;
    }
  });

  it('names the page once, with the open doc as the top heading', () => {
    renderDocs('/docs/install');

    expect(screen.queryByText('Public docs')).not.toBeInTheDocument();
    expect(screen.queryByText(/install, configure, deploy/i)).not.toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Install' })).toBeInTheDocument();
  });

  // The old "skip the first h1" flag was spent by StrictMode's second render pass, so the browser
  // showed the title twice while this suite, which does not double-render, saw one.
  it('prints the title once even when React renders twice', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/docs/install']}>
          <Routes>
            <Route path="/docs/:page" element={<DocsPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getAllByRole('heading', { name: 'Install' })).toHaveLength(1);
  });

  it('scrolls back to the top when the reader opens another page', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);

    try {
      renderDocs('/docs/install');
      scrollTo.mockClear();

      fireEvent.click(screen.getByRole('link', { name: 'Development' }));

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves the scroll position alone for a same-page anchor', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);

    try {
      renderDocs('/docs/environment');
      scrollTo.mockClear();
      const adapters = document.getElementById('adapters');
      if (!adapters) throw new Error('Adapters heading was not rendered');
      adapters.scrollIntoView = vi.fn();

      fireEvent.click(within(document.querySelector('.doc-markdown') as HTMLElement).getByRole('link', { name: 'Adapters' }));

      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('stripLeadingH1', () => {
    it('drops the leading title the page already prints', () => {
      expect(stripLeadingH1('# Install\n\nBody text\n')).toBe('Body text\n');
    });

    it('leaves a body that does not open with a title', () => {
      expect(stripLeadingH1('Body text\n\n# Later heading\n')).toBe('Body text\n\n# Later heading\n');
    });

    it('keeps a later h1, which is real content', () => {
      expect(stripLeadingH1('# Install\n\n# Second\n')).toBe('# Second\n');
    });

    it('does not mistake an h2 for the title', () => {
      expect(stripLeadingH1('## Prerequisites\n\nBody\n')).toBe('## Prerequisites\n\nBody\n');
    });
  });

  // Ids used to come from a counter that ticked once per heading render. StrictMode renders each
  // heading twice, so every id came out suffixed `-1` in the browser and every anchor pointed at
  // nothing — while this suite, which does not double-render, saw clean ids.
  it('keeps anchor ids unsuffixed when React renders twice', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/docs/environment']}>
          <Routes>
            <Route path="/docs/:page" element={<DocsPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(document.getElementById('adapters')).not.toBeNull();
    expect(document.getElementById('adapters-1')).toBeNull();
  });

  it('deduplicates generated heading ids for repeated markdown headings', () => {
    renderDocs('/docs/install');

    expect(document.getElementById('1-install-using-your-connection-details')).not.toBeNull();
    expect(document.getElementById('1-install-using-your-connection-details-1')).not.toBeNull();
    expect(document.querySelectorAll('[id="1-install-using-your-connection-details"]')).toHaveLength(1);
  });
});
