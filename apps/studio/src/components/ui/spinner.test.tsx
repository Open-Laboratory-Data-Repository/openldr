import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LoadingState } from './spinner';

describe('LoadingState', () => {
  it('shows the spinner and the label, and no stripes', () => {
    const { container } = render(<LoadingState label="Loading runs" className="min-h-[16rem]" />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByText('Loading runs')).toBeInTheDocument();
    // Stripes mean empty, so a loading state draws no hatch pattern.
    expect(container.querySelector('pattern')).toBeNull();
    expect(container.firstElementChild).toHaveClass('min-h-[16rem]');
  });
});
