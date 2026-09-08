import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { MappingRowStatus } from './MappingRowStatus';

describe('MappingRowStatus', () => {
  // The operator's decision: always clickable, so a re-check is never gated on the app agreeing
  // that something changed.
  it.each(['neutral', 'valid', 'invalid', 'stale'] as const)('is clickable in the %s state', (state) => {
    const onCheck = vi.fn();
    render(<MappingRowStatus state={state} label="Type" busy={false} detail={null} onCheck={onCheck} />);
    const button = screen.getByRole('button', { name: /Type/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('names its state in the accessible name, so the icon is not the only carrier', () => {
    render(<MappingRowStatus state="invalid" label="Type" busy={false} detail="3 values are not recognised" onCheck={vi.fn()} />);
    expect(screen.getByRole('button', { name: /not recognised/i })).toBeInTheDocument();
  });

  // Neutral and stale share a gray tick by the operator's own decision. The tooltip is what tells
  // them apart, so it has to differ even though the glyph does not.
  it('gives neutral and stale different words for the same glyph', () => {
    const { rerender } = render(<MappingRowStatus state="neutral" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    const neutral = screen.getByRole('button', { name: /Type/ }).getAttribute('aria-label');
    rerender(<MappingRowStatus state="stale" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    const stale = screen.getByRole('button', { name: /Type/ }).getAttribute('aria-label');
    expect(neutral).not.toEqual(stale);
  });

  it('does not fire a second check while one is running', () => {
    const onCheck = vi.fn();
    render(<MappingRowStatus state="neutral" label="Type" busy detail={null} onCheck={onCheck} />);
    fireEvent.click(screen.getByRole('button', { name: /Type/ }));
    expect(onCheck).not.toHaveBeenCalled();
  });
});
