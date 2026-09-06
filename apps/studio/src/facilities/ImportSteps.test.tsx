import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ImportSteps } from './ImportSteps';

describe('ImportSteps', () => {
  it('names all three steps and marks the current one', () => {
    render(<ImportSteps current={2} furthest={2} allowBack onSelect={vi.fn()} />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Mapping')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mapping/ })).toHaveAttribute('aria-current', 'step');
  });

  it('lets the operator go back to an earned step', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={2} furthest={2} allowBack onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Source/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  // A step the operator has not earned must not be clickable: jumping to Review before a file is
  // chosen would show an empty surface with no explanation.
  it('disables a step that has not been earned, and does not fire onSelect for it', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={1} furthest={1} allowBack onSelect={onSelect} />);
    const review = screen.getByRole('button', { name: /Review/ });
    expect(review).toBeDisabled();
    fireEvent.click(review);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Round-2 fix: the strip is now the ONLY back affordance (the sheet's action row no longer
  // renders its own Back button), so `allowBack` has to actually gate it — an operator must not be
  // able to jump back to the source inputs while a run is mid-flight (`canGoBack` is false for
  // exactly that case; see stepModel.ts).
  it('does not let the operator click an earlier step when allowBack is false, and does not fire onSelect', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={3} furthest={3} allowBack={false} onSelect={onSelect} />);
    const source = screen.getByRole('button', { name: /Source/ });
    expect(source).toBeDisabled();
    fireEvent.click(source);
    expect(onSelect).not.toHaveBeenCalled();
    // The current step (and anything else already earned) stays reachable — only stepping BACK is
    // refused, never the step the operator is already on.
    expect(screen.getByRole('button', { name: /Review/ })).toBeEnabled();
  });
});
