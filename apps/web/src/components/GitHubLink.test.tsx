import { render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { STAR_COUNT_ENABLED } from '@/landing/github-stars';
import { GitHubLink } from './GitHubLink';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('GitHubLink', () => {
  it('links to the repository', () => {
    render(<GitHubLink />);

    expect(screen.getByRole('link', { name: /openldr on github/i })).toHaveAttribute(
      'href',
      'https://github.com/Open-Laboratory-Data-Repository/openldr',
    );
  });

  it('draws the mark and no count', () => {
    const { container } = render(<GitHubLink />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('span.rounded-full')).toHaveLength(0);
  });

  // The landing page contacted nothing before the count existed, and must not start until the
  // count is switched on. A visitor's IP reaching GitHub on page load is the thing being prevented.
  it('makes no network request while the star count is switched off', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<GitHubLink />);

    expect(STAR_COUNT_ENABLED).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
