import { describe, it, expect, vi, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Pin a zone west of UTC with no daylight saving, before any import reads a date. Node applies a
// change to process.env.TZ at once. Vitest's default pool is child processes, and afterAll puts
// the old zone back.
const zone = vi.hoisted(() => {
  const before = process.env.TZ;
  process.env.TZ = 'America/Bogota';
  return { before };
});
afterAll(() => {
  if (zone.before === undefined) delete process.env.TZ;
  else process.env.TZ = zone.before;
});

import { DatePicker, pickerValueToDate } from './date-picker';

describe('DatePicker west of UTC', () => {
  it('runs in the pinned zone, where a bare ISO date is the evening before', () => {
    // The old parse: new Date('2026-11-20') is UTC midnight, the 19th at 19:00 in Bogota.
    expect(new Date('2026-11-20').getDate()).toBe(19);
  });

  it('shows the picked day on the trigger', () => {
    render(<DatePicker value="2026-11-20" onChange={() => {}} id="d" />);
    expect(screen.getByRole('button').textContent).toContain('20/11/2026');
  });

  it('highlights the picked day in the calendar', () => {
    render(<DatePicker value="2026-11-20" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /20\/11\/2026/ }));
    const selected = [...document.querySelectorAll<HTMLElement>('[data-day][aria-selected="true"], [data-day][data-selected="true"]')];
    expect(selected.map((el) => el.dataset.day)).toEqual(['2026-11-20']);
  });

  it('reads a bare date as local midnight and keeps the old reading for anything else', () => {
    const d = pickerValueToDate('2026-11-20');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 20, 0]);
    expect(pickerValueToDate('2026-11-20T12:00:00Z').toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });
});
