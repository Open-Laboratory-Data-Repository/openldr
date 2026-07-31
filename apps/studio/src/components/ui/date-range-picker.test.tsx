import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangePicker, defaultDateRangePresets } from './date-range-picker';
import { CALENDAR_START_MONTH } from './calendar';

// REGRESSION (two bugs, one caption row):
//
// 1. react-day-picker renders each caption dropdown as a NATIVE <select> laid invisibly over a
//    styled label by ITS OWN stylesheet. This app never imports that stylesheet, so the raw
//    <select> rendered inline BESIDE the label and every month and year appeared twice. Hiding the
//    select with opacity-0 papered over the duplication but left an unthemeable OS control doing
//    the actual work; the calendar now renders shadcn Selects instead (see calendar.tsx).
//
// 2. The prev/next `nav` is an absolutely positioned FULL-WIDTH bar at z-10 over the caption row.
//    Only its two arrows are visible, but its box covered the month/year controls underneath, so
//    every click aimed at them hit the nav and the dropdowns appeared dead.

function openCalendar() {
  render(<DateRangePicker value={null} onChange={() => {}} presets={defaultDateRangePresets()} />);
  fireEvent.click(screen.getByRole('button', { name: /pick a date range/i }));
}

describe('DateRangePicker caption dropdowns', () => {
  it('renders month and year pickers as shadcn Selects, not native <select>', () => {
    openCalendar();
    // two months on screen x (month + year)
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll('select')).toHaveLength(0);
  });

  it('labels both a month and a year picker', () => {
    openCalendar();
    expect(screen.getAllByRole('combobox', { name: /month/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('combobox', { name: /year/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the dropdowns operable — never hidden, disabled or display:none', () => {
    openCalendar();
    for (const c of screen.getAllByRole('combobox')) {
      expect(c.className).not.toMatch(/\bhidden\b/);
      expect(c.className).not.toMatch(/sr-only/);
      expect(c.className).not.toMatch(/opacity-0\b/);
      expect(c).not.toBeDisabled();
    }
  });

  it('lets clicks through the nav overlay to the dropdowns beneath it', () => {
    // jsdom does no hit-testing, so assert the mechanism: the full-width nav bar must not take
    // pointer events, and each arrow must opt back in individually. Drop either half and the
    // month/year controls stop responding to the mouse.
    openCalendar();
    const nav = document.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav!.className).toMatch(/pointer-events-none/);

    const arrows = [...nav!.querySelectorAll('button')];
    expect(arrows.length).toBeGreaterThanOrEqual(2);
    for (const a of arrows) expect(a.className).toMatch(/pointer-events-auto/);
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

describe('DateRangePicker nav arrows', () => {
  // REGRESSION: react-day-picker's Chevron is `<svg><polygon/></svg>` with NO fill attribute, so it
  // painted in SVG's default fill — BLACK — which is all but invisible on the dark theme.
  it('paints the prev/next chevrons in the button text colour, not SVG default black', () => {
    openCalendar();
    const svgs = [...document.querySelectorAll('nav button svg')];
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    for (const svg of svgs) expect(svg.getAttribute('class')).toMatch(/fill-current/);
  });

  it('does not dim the arrows below full strength', () => {
    openCalendar();
    for (const b of document.querySelectorAll('nav button')) {
      expect(b.className).toMatch(/text-foreground/);
      expect(b.className).not.toMatch(/opacity-\d/);
    }
  });
});

describe('DateRangePicker on a phone', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** jsdom has no layout, so drive the component's media query directly. */
  function stubViewport(narrow: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: narrow,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  const monthCount = () => document.querySelectorAll('[role="dialog"] table, table').length;

  it('drops to a single month — two months are ~570px wide and a phone has ~360', () => {
    stubViewport(true);
    openCalendar();
    expect(monthCount()).toBe(1);
  });

  it('still shows two months on a wide viewport', () => {
    stubViewport(false);
    openCalendar();
    expect(monthCount()).toBe(2);
  });

  it('stacks the preset rail above the calendar and wraps it rather than scrolling sideways', () => {
    stubViewport(true);
    openCalendar();
    const rail = screen.getByRole('button', { name: 'All time' }).parentElement!;
    // Column from `sm` up, wrapping row below it — the rail is 6 presets wide otherwise.
    expect(rail.className).toMatch(/flex-row/);
    expect(rail.className).toMatch(/sm:flex-col/);
    expect(rail.className).toMatch(/flex-wrap/);
    // NOT a horizontal scroll strip. PopoverContent renders through a Portal, so when this picker
    // is opened inside a modal dialog/sheet the calendar mounts outside that dialog's subtree and
    // react-remove-scroll blocks scrolling within it — presets past the right edge became
    // completely unreachable. Wrapping needs no scroll, so it survives any nesting.
    expect(rail.className).not.toMatch(/overflow-x-auto/);
  });
});

describe('DatePicker (single) caption dropdowns', () => {
  it('also offers month+year pickers — every DatePicker in the app is a data filter', async () => {
    const { DatePicker } = await import('./date-picker');
    render(<DatePicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }));
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('select')).toHaveLength(0);
  });

  it('lets the year picker reach a historical archive year', () => {
    // The options only exist while the Radix listbox is open, so assert the span that fills it:
    // the shared floor every picker navigates back to (the DISA corpus starts in 2013).
    expect(CALENDAR_START_MONTH.getFullYear()).toBeLessThanOrEqual(2013);
  });
});
