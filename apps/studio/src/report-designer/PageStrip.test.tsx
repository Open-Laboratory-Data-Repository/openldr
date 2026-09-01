import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageStrip } from './PageStrip';

describe('PageStrip', () => {
  it('never guesses: without counts it says at least 1 page and offers Load pages', () => {
    const onLoad = vi.fn();
    render(<PageStrip counts={null} loading={false} stale={false} onLoad={onLoad} />);
    expect(screen.getByText('Prints as at least 1 page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load pages' }));
    expect(onLoad).toHaveBeenCalled();
  });

  it('shows one box per physical page and the real count', () => {
    render(<PageStrip counts={{ perPage: [3], total: 3 }} loading={false} stale={false} onLoad={vi.fn()} />);
    expect(screen.getByText('Prints as 3 pages')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Physical page/)).toHaveLength(3);
  });

  it('marks a stale snapshot', () => {
    render(<PageStrip counts={{ perPage: [2], total: 2 }} loading={false} stale onLoad={vi.fn()} />);
    expect(screen.getByText('Edited since the last load')).toBeInTheDocument();
  });

  it('disables Load pages while loading', () => {
    render(<PageStrip counts={null} loading stale={false} onLoad={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Load pages' })).toBeDisabled();
  });
});
