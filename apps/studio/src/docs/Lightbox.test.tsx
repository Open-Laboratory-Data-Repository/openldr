import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Lightbox } from './Lightbox';

describe('Lightbox', () => {
  it('renders nothing when image is null', () => {
    render(<Lightbox image={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows the image when open', () => {
    render(<Lightbox image={{ url: '/assets/dashboard.png', alt: 'Dash' }} onClose={() => {}} />);
    const img = screen.getByAltText('Dash') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/assets/dashboard.png');
  });
  it('retains the crop, blur and marker while enlarging a focused screenshot', () => {
    render(<Lightbox image={{ url: '/assets/open.png', alt: 'Open Dashboard', focus: 'dashboard-create-open.png' }} onClose={() => {}} />);
    const img = screen.getByAltText('Open Dashboard');
    const frame = img.parentElement!.parentElement!;
    expect(frame).toHaveStyle({ aspectRatio: '8 / 5', containerType: 'inline-size' });
    expect(img).toHaveStyle({ filter: 'blur(.25cqw)' });
    const sharp = img.nextElementSibling!.querySelector('img')!;
    expect(sharp.style.clipPath).toContain('inset(');
    expect(screen.getByText('1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(frame.parentElement).toHaveStyle({ width: '150%' });
    expect(img).toHaveStyle({ filter: 'blur(.25cqw)' });
    expect(sharp.style.clipPath).toContain('inset(');
  });
  it('keeps the themed illustration surround while zooming', () => {
    render(<Lightbox image={{ url: '/assets/start.png', alt: 'Terminal', illustration: true }} onClose={() => {}} />);
    const image = screen.getByAltText('Terminal');
    const frame = image.closest<HTMLElement>('.doc-dotted-frame')!;
    expect(frame).toHaveClass('doc-dotted-frame');
    expect(frame.parentElement!.parentElement).toHaveClass('bg-background');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(frame.parentElement).toHaveStyle({ width: '150%' });
    expect(frame.querySelector('.doc-dotted-dots')).toHaveAttribute('aria-hidden', 'true');
    expect(frame.querySelector('img')!.style.maskImage).toBe('');
  });
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<Lightbox image={{ url: '/assets/x.png', alt: 'X' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
