import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangePicker, defaultDateRangePresets } from './date-range-picker';

// REGRESSION: react-day-picker renders each caption dropdown as
//   <span dropdown_root><select dropdown/><span caption_label>January ⌄</span></span>
// and relies on its OWN stylesheet to lay the native <select> invisibly over the styled label.
// This app styles the picker purely through `classNames` and never imports that stylesheet, so
// the raw <select> rendered inline BESIDE the label and every month and year appeared twice —
// once styled, once as an unstyled OS control overlapping the prev/next arrows.

function openCalendar() {
  render(<DateRangePicker value={null} onChange={() => {}} presets={defaultDateRangePresets()} />);
  fireEvent.click(screen.getByRole('button', { name: /pick a date range/i }));
}

describe('DateRangePicker caption dropdowns', () => {
  it('renders month and year dropdowns as real <select> elements', () => {
    openCalendar();
    const selects = document.querySelectorAll('select');
    // two months on screen x (month + year)
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every native <select> transparent, so the label is not duplicated on screen', () => {
    openCalendar();
    const selects = [...document.querySelectorAll('select')];
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s.className).toMatch(/opacity-0/);
      expect(s.className).toMatch(/absolute/);
    }
  });

  it('keeps the dropdowns operable — never hidden or display:none', () => {
    // `sr-only`/`hidden` would fix the visual duplication and silently break the control.
    openCalendar();
    for (const s of document.querySelectorAll('select')) {
      expect(s.className).not.toMatch(/\bhidden\b/);
      expect(s.className).not.toMatch(/sr-only/);
      expect(s).not.toBeDisabled();
    }
  });

  it('reserves caption padding so the nav arrows cannot overlap the dropdowns', () => {
    openCalendar();
    const caption = document.querySelector('[class*="px-9"]');
    expect(caption).not.toBeNull();
  });

  it('offers an All time preset that reaches historical archives', () => {
    // Guards the BUG 9 fix: with only relative windows, 2013-2016 lab data is unreachable.
    const all = defaultDateRangePresets().find((p) => p.label === 'All time');
    expect(all).toBeDefined();
    expect(new Date(all!.range.from).getFullYear()).toBeLessThanOrEqual(2000);
  });
});

describe('DatePicker (single) caption dropdowns', () => {
  it('also offers month+year dropdowns — every DatePicker in the app is a data filter', async () => {
    const { DatePicker } = await import('./date-picker');
    render(<DatePicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }));
    const selects = [...document.querySelectorAll('select')];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const s of selects) expect(s.className).toMatch(/opacity-0/);
  });

  it('lets the year dropdown reach a historical archive year', async () => {
    const { DatePicker } = await import('./date-picker');
    render(<DatePicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }));
    const years = [...document.querySelectorAll('select')]
      .flatMap((s) => [...s.querySelectorAll('option')].map((o) => o.textContent));
    expect(years).toContain('2013');
  });
});
