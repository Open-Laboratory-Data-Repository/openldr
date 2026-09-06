import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ImportSteps } from './ImportSteps';

describe('ImportSteps', () => {
  it('names all three steps and marks the current one', () => {
    render(<ImportSteps current={2} furthest={2} onSelect={vi.fn()} />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Mapping')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mapping/ })).toHaveAttribute('aria-current', 'step');
  });

  it('lets the operator go back to an earned step', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={2} furthest={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Source/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  // A step the operator has not earned must not be clickable: jumping to Review before a file is
  // chosen would show an empty surface with no explanation.
  it('disables a step that has not been earned, and does not fire onSelect for it', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={1} furthest={1} onSelect={onSelect} />);
    const review = screen.getByRole('button', { name: /Review/ });
    expect(review).toBeDisabled();
    fireEvent.click(review);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
