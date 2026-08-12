import { fireEvent, render, screen, within } from '@testing-library/react';
import { Gallery } from './Gallery';
import { PUBLIC_SCREENSHOT_NAMES } from '@/landing/screenshots';

describe('Gallery', () => {
  it('shows every screen as its own tile', () => {
    render(<Gallery />);

    const tiles = screen.getAllByRole('button');
    expect(tiles).toHaveLength(PUBLIC_SCREENSHOT_NAMES.length);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
  });

  it('opens the clicked screen full size', () => {
    render(<Gallery />);

    fireEvent.click(screen.getByRole('button', { name: /query/i }));

    const dialog = screen.getByRole('dialog', { name: 'Query' });
    expect(within(dialog).getByRole('img')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<Gallery />);
    fireEvent.click(screen.getByRole('button', { name: /query/i }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('steps to the next screen and wraps at the end', () => {
    render(<Gallery />);
    fireEvent.click(screen.getByRole('button', { name: /marketplace/i })); // the last tile

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(screen.getByRole('dialog', { name: 'Dashboard' })).toBeInTheDocument();
  });

  // Eight full-size PNGs is about a megabyte; only the first row is on screen at first paint.
  it('defers loading the screens below the first row', () => {
    const { container } = render(<Gallery />);
    const images = [...container.querySelectorAll('li img')];

    expect(images.slice(0, 4).every((img) => img.getAttribute('loading') === 'eager')).toBe(true);
    expect(images.slice(4).every((img) => img.getAttribute('loading') === 'lazy')).toBe(true);
  });
});
