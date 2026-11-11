import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./screenshots', () => ({
  resolveImg: (src: string) =>
    ({ 'dashboard.png': '/assets/dashboard.png', 'tour.mp4': '/assets/tour.mp4', 'tour.png': '/assets/tour.png' })[src] ?? null,
  isClip: (src: string) => src.endsWith('.mp4'),
  posterName: (src: string) => src.replace(/\.mp4$/, '.png'),
}));

import { DocMarkdown } from './DocMarkdown';

describe('DocMarkdown', () => {
  it('renders a resolved screenshot as a zoom thumbnail and calls onImageClick', () => {
    const onImageClick = vi.fn();
    render(<DocMarkdown content={'# Title\n\n![Dash](dashboard.png)'} onImageClick={onImageClick} />);
    const img = screen.getByAltText('Dash') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/assets/dashboard.png');
    fireEvent.click(screen.getByRole('button', { name: /zoom/i }));
    expect(onImageClick).toHaveBeenCalledWith({ url: '/assets/dashboard.png', alt: 'Dash' });
  });

  it('plays a clip muted and looping, with its poster, and enlarges it on click', () => {
    const onImageClick = vi.fn();
    const { container } = render(<DocMarkdown content={'![Tour](tour.mp4)'} onImageClick={onImageClick} />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/assets/tour.mp4');
    expect(video.getAttribute('poster')).toBe('/assets/tour.png');
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /enlarge: tour/i }));
    expect(onImageClick).toHaveBeenCalledWith({ url: '/assets/tour.mp4', alt: 'Tour', poster: '/assets/tour.png' });
  });

  it('gives repeated headings distinct ids', () => {
    const { container } = render(<DocMarkdown content={'## Steps\n\ntext\n\n## Steps'} onImageClick={() => {}} />);
    const ids = [...container.querySelectorAll('h2')].map((h) => h.id);
    expect(ids).toEqual(['steps', 'steps-1']);
  });

  it('shows an unavailable placeholder for an unresolved image', () => {
    render(<DocMarkdown content={'![Missing](missing.png)'} onImageClick={() => {}} />);
    expect(screen.queryByAltText('Missing')).toBeNull();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it('opens external links in a new tab', () => {
    render(<DocMarkdown content={'[site](https://example.org)'} onImageClick={() => {}} />);
    const a = screen.getByRole('link', { name: 'site' });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders gfm strikethrough', () => {
    const { container } = render(<DocMarkdown content={'~~gone~~'} onImageClick={() => {}} />);
    expect(container.querySelector('del')).not.toBeNull();
  });
});
