import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobInterruption } from '@/api';
import { InterruptionBadge } from './interruption-badge';

const cut = (over: Partial<JobInterruption> = {}): JobInterruption => ({
  id: 'i1', at: '2026-11-18T05:00:00.000Z', cause: 'server-restart', phase: null,
  resumedAt: '2026-11-18T05:02:00.000Z', resumedBy: 'self', continuedAs: null, ...over,
});

describe('InterruptionBadge', () => {
  it('renders nothing for a job never interrupted', () => {
    const { container } = render(<InterruptionBadge interruptions={[]} />);
    expect(container).toBeEmptyDOMElement();
    const none = render(<InterruptionBadge interruptions={undefined} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it('says how many times, and lists each cut and how it came back in the tooltip', async () => {
    render(<InterruptionBadge interruptions={[cut(), cut({ id: 'i2', resumedBy: 'person' }), cut({ id: 'i3', resumedBy: null, resumedAt: null })]} />);
    const badge = screen.getByText('Interrupted 3 times');
    await userEvent.hover(badge);
    expect((await screen.findAllByText(/Carried on by itself/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Continued by a person/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Waiting for Continue/).length).toBeGreaterThan(0);
  });

  it('says once for a single cut', () => {
    render(<InterruptionBadge interruptions={[cut()]} />);
    expect(screen.getByText('Interrupted once')).toBeInTheDocument();
  });
});
