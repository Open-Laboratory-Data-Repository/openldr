import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

vi.mock('@/components/ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt }: { alt: string }) => <img src="/mock.png" alt={alt} />,
}));

describe('App routes', () => {
  it('renders the screenshot-led landing route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    const heading = screen.getByRole('heading', { name: 'OpenLDR' });
    const workflow = screen.getByLabelText(/openldr ingest workflow/i);

    expect(heading).toBeInTheDocument();
    // The workflow canvas sits below the hero copy, not beside it.
    expect(heading.compareDocumentPosition(workflow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/build your own workflows/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/openldr install command/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Install OpenLDR in one line/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The pieces you need, shown directly.' })).not.toBeInTheDocument();
  });

  it('renders public docs from the docs route', () => {
    render(
      <MemoryRouter initialEntries={['/docs/install']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: /public documentation/i })).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
