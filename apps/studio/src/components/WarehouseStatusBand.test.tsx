import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';

const status = vi.fn();
let offline = 0;
vi.mock('@/api', () => ({ fetchWarehouseStatus: () => { if (offline > 0) { offline += 1; return Promise.reject(new Error('offline')); } return status(); } }));

import { WarehouseStatusBand, timeLeftParts } from './WarehouseStatusBand';

const base = { head: 1000, cursor: 1000, behind: 0, waitingRetry: 0, oldestWaitingAt: null, readAt: '2026-11-19T10:05:00Z', appliedPerSecond: null, secondsLeft: null, fallingBehind: false };

describe('WarehouseStatusBand', () => {
  beforeEach(() => { status.mockReset(); offline = 0; });

  it('says_up_to_date_when_nothing_waits', async () => {
    status.mockResolvedValue(base);
    render(<WarehouseStatusBand />);
    expect(await screen.findByText(/Up to date/)).toBeInTheDocument();
    expect(screen.queryByText(/changes behind/)).toBeNull();
  });

  it('shows_the_gap_the_time_left_and_the_rate_when_behind', async () => {
    status.mockResolvedValue({ ...base, cursor: 400, behind: 14030722, oldestWaitingAt: '2026-11-19T09:40:00Z', appliedPerSecond: 6100, secondsLeft: 2300 });
    render(<WarehouseStatusBand />);
    expect(await screen.findByText('14,030,722 changes behind.')).toBeInTheDocument();
    expect(screen.getByText('About 38 min left.')).toBeInTheDocument();
    expect(screen.getByText('6,100 changes a second')).toBeInTheDocument();
    expect(screen.getByText(/Shows records saved up to/)).toBeInTheDocument();
    expect(screen.getByText(/they show less than was saved/)).toBeInTheDocument();
  });

  it('says_falling_behind_when_the_gap_grows', async () => {
    status.mockResolvedValue({ ...base, cursor: 400, behind: 600, appliedPerSecond: 2667, fallingBehind: true });
    render(<WarehouseStatusBand />);
    expect(await screen.findByText(/Falling behind/)).toBeInTheDocument();
  });

  it('says_it_is_measuring_before_there_is_a_rate', async () => {
    status.mockResolvedValue({ ...base, cursor: 400, behind: 600 });
    render(<WarehouseStatusBand />);
    expect(await screen.findByText(/Measuring the time left/)).toBeInTheDocument();
  });

  it('names_the_records_that_wait_for_another_try', async () => {
    status.mockResolvedValue({ ...base, waitingRetry: 3 });
    render(<WarehouseStatusBand />);
    expect(await screen.findByText(/3 records were refused/)).toBeInTheDocument();
  });

  it('shows_nothing_when_the_status_cannot_be_read', async () => {
    offline = 1;
    const { container } = render(<WarehouseStatusBand />);
    await vi.waitFor(() => expect(offline).toBe(2));
    expect(container).toBeEmptyDOMElement();
  });

  it('splits_seconds_into_hours_and_minutes', () => {
    expect(timeLeftParts(40)).toEqual({ key: 'underMinute', hours: 0, minutes: 0 });
    expect(timeLeftParts(2300)).toEqual({ key: 'minutes', hours: 0, minutes: 38 });
    expect(timeLeftParts(7500)).toEqual({ key: 'hours', hours: 2, minutes: 5 });
  });
});
