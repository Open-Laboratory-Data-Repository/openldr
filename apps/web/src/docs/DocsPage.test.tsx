import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('renders a professional docs shell for a public doc page', () => {
    renderDocs('/docs/install');

    expect(screen.getByRole('navigation', { name: /public documentation/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Documentation version')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
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

      fireEvent.click(screen.getByRole('link', { name: 'Adapters' }));

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

      fireEvent.click(screen.getByRole('link', { name: 'Adapters' }));

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

  it('deduplicates generated heading ids for repeated markdown headings', () => {
    renderDocs('/docs/install');

    expect(document.getElementById('demo-evaluation')).not.toBeNull();
    expect(document.getElementById('demo-evaluation-1')).not.toBeNull();
    expect(document.querySelectorAll('[id="demo-evaluation"]')).toHaveLength(1);
  });
});
