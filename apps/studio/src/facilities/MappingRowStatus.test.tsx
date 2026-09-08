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

  // Finding 1: an aria-label is not a tooltip. A sighted mouse user sees nothing on hover
  // unless something actually renders. Focus opens a Radix Tooltip synchronously (no timer),
  // so this does not need to wait on delayDuration or simulate a real pointer hover.
  it('shows a real tooltip, not just an aria-label', () => {
    render(<MappingRowStatus state="valid" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Type/ });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/checked, nothing wrong/i);
  });

  // Neutral and stale share a gray tick. The earlier test proves the aria-label differs; this
  // proves the same is true of the thing a mouse user actually sees.
  it('gives the tooltip different text for neutral and stale, same as the aria-label', () => {
    const { unmount } = render(<MappingRowStatus state="neutral" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    fireEvent.focus(screen.getByRole('button', { name: /Type/ }));
    const neutralTip = screen.getByRole('tooltip').textContent;
    unmount();

    render(<MappingRowStatus state="stale" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    fireEvent.focus(screen.getByRole('button', { name: /Type/ }));
    const staleTip = screen.getByRole('tooltip').textContent;

    expect(neutralTip).not.toEqual(staleTip);
  });

  // Finding 2: a null `detail` on an invalid row must not assert a cause it does not know.
  // `collides` is one possible cause; unrecognised values from a per-field check are another.
  // Naming the wrong one is worse than a vague message.
  it('does not blame a collision when the cause of an invalid row is not known', () => {
    render(<MappingRowStatus state="invalid" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    const label = screen.getByRole('button').getAttribute('aria-label');
    expect(label).not.toMatch(/already claims this field/i);
  });
});
