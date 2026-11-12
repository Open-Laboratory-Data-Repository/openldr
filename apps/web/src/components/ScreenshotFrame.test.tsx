import { render, screen, waitFor } from '@testing-library/react';
import { ScreenshotFrame } from './ScreenshotFrame';

vi.mock('@/landing/screenshots', () => ({
  screenshotUrl: (name: string) => ({
    'dashboard-overview.png': '/assets/dashboard.png',
    'dashboard-overview-light.png': '/assets/dashboard-light.png',
  })[name] ?? null,
}));

describe('ScreenshotFrame', () => {
  it('switches the single displayed capture when the website theme changes', async () => {
    const original = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'dark';
    try {
      render(<ScreenshotFrame name="dashboard-overview.png" alt="Dashboard" />);
      const image = screen.getByRole('img', { name: 'Dashboard' });
      expect(image).toHaveAttribute('src', '/assets/dashboard.png');
      document.documentElement.dataset.theme = 'light';
      await waitFor(() => expect(image).toHaveAttribute('src', '/assets/dashboard-light.png'));
      document.documentElement.dataset.theme = 'dark';
      await waitFor(() => expect(image).toHaveAttribute('src', '/assets/dashboard.png'));
      expect(screen.getAllByRole('img', { name: 'Dashboard' })).toHaveLength(1);
    } finally {
      if (original) document.documentElement.dataset.theme = original;
      else delete document.documentElement.dataset.theme;
    }
  });
  it('renders a real screenshot with eager loading when priority is true', () => {
    render(
      <ScreenshotFrame
        name="dashboard-overview.png"
        alt="OpenLDR dashboard overview"
        caption="Dashboard overview"
        priority
      />,
    );

    const image = screen.getByRole('img', { name: 'OpenLDR dashboard overview' });
    expect(image).toHaveAttribute('src', '/assets/dashboard.png');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveClass('object-contain');
    expect(image).not.toHaveClass('object-cover');
    expect(screen.getByText('Dashboard overview')).toBeInTheDocument();
    expect(image.closest('figure')).toHaveClass('m-0');
  });

  it('renders a quiet unavailable state when the screenshot URL is absent', () => {
    render(<ScreenshotFrame name="sync-settings-card.png" alt="Distributed Sync settings" />);

    expect(screen.getByRole('img', { name: /screenshot unavailable: distributed sync settings/i })).toBeInTheDocument();
  });
});
