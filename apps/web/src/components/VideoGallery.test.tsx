import { fireEvent, render, screen, within } from '@testing-library/react';
import { VideoGallery } from './VideoGallery';
import { VIDEOS } from '@/landing/videos';

describe('VideoGallery', () => {
  it('shows every video as its own tile', () => {
    render(<VideoGallery />);

    expect(screen.getAllByRole('button')).toHaveLength(VIDEOS.length);
    expect(screen.getByText('Dashboards')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('plays the clicked video in the lightbox', () => {
    render(<VideoGallery />);

    fireEvent.click(screen.getByRole('button', { name: /^Querying the warehouse/ }));

    const dialog = screen.getByRole('dialog', { name: 'Query' });
    const video = dialog.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe(VIDEOS.find((v) => v.name === 'query')?.video);
    expect(within(dialog).getByRole('button', { name: 'Next video' })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<VideoGallery />);
    fireEvent.click(screen.getByRole('button', { name: /^Querying the warehouse/ }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('steps to the next video and wraps at the end', () => {
    render(<VideoGallery />);
    fireEvent.click(screen.getByRole('button', { name: /workflows/i })); // the last tile

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(screen.getByRole('dialog', { name: 'Dashboards' })).toBeInTheDocument();
  });
});
