import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';

describe('Hero', () => {
  it('presents OpenLDR with clear CTAs and the dashboard in a window frame', () => {
    const { container } = render(<Hero />, { wrapper: MemoryRouter });

    expect(screen.getByRole('heading', { name: 'OpenLDR' })).toBeInTheDocument();
    expect(screen.getByText(/self-hosted laboratory data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read the docs/i })).toHaveAttribute('href', '/docs');
    // The workflow canvas moved to its own section below the hero.
    expect(screen.queryByLabelText(/openldr ingest workflow/i)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OpenLDR dashboard overview' })).toBeInTheDocument();
    expect(container.querySelectorAll('figure .rounded-full')).toHaveLength(3);
  });

  it('scrolls to install without changing the hash when Get started is clicked', () => {
    const originalHash = window.location.hash;
    const scrollIntoView = vi.fn();
    const install = document.createElement('section');
    install.id = 'install';
    install.scrollIntoView = scrollIntoView;
    document.body.append(install);
    window.location.hash = '#/';

    try {
      render(<Hero />, { wrapper: MemoryRouter });
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(window.location.hash).toBe('#/');
    } finally {
      window.location.hash = originalHash;
      install.remove();
    }
  });
});
