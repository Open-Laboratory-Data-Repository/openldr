import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/lib/cn';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/** Selectable span for the caption year dropdown, shared by every date surface. Wide enough for
 *  real laboratory archives — a national repository holds a decade or more of history — without
 *  making the dropdown unusable. Any picker that omits these gets prev/next month arrows only,
 *  which costs one click per month to reach an old date (the 2013-2016 DISA corpus is ~150). */
export const CALENDAR_START_MONTH = new Date(2000, 0, 1);
export const CALENDAR_END_MONTH = new Date(new Date().getFullYear() + 1, 11, 31);

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        // `months` is the positioning context for `nav` below: in react-day-picker v10, the
        // Nav element (holding both prev/next buttons) renders once as a sibling *before* the
        // Month blocks, not nested inside `month_caption` as it was in v8. Without an explicit
        // `relative` ancestor here, the buttons' `absolute` positioning falls back to a distant
        // positioned ancestor (e.g. the popover), landing on top of the day grid instead of the
        // caption row.
        months: 'relative flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        // `px-9` reserves the width of the absolutely-positioned prev/next buttons at either end
        // of the caption row (h-7 w-7 inside `nav`'s px-1). Without it the caption content — which
        // is much wider under `captionLayout="dropdown"` than a plain "January 2026" label — runs
        // underneath the arrows.
        month_caption: 'flex h-9 items-center justify-center px-9',
        caption_label: 'text-sm font-medium',
        // Pinned to the top of `months` (same height as `month_caption`) so it overlays only the
        // caption row, never the grid below.
        nav: 'absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-between px-1',
        button_previous:
          'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-input',
        button_next:
          'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-input',
        // --- captionLayout="dropdown" (date-range-picker) -------------------------------------
        // react-day-picker renders each dropdown as
        //   <span dropdown_root><select dropdown/><span caption_label>January ⌄</span></span>
        // and relies on ITS OWN stylesheet to lay the native <select> invisibly over the styled
        // label. This app styles the picker entirely through `classNames` and never imports that
        // stylesheet, so without the three rules below the raw <select> renders inline *beside*
        // the label — every month and year appeared TWICE, once as an unstyled OS control.
        dropdowns: 'flex items-center gap-1.5',
        dropdown_root: 'relative inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent',
        // The real control: full-bleed over its root and transparent, so it stays keyboard- and
        // pointer-operable while only `caption_label` is visible. Do not swap this for
        // `sr-only`/`hidden` — that would make the dropdowns unclickable.
        dropdown: 'absolute inset-0 h-full w-full cursor-pointer opacity-0',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
        day_button: cn(
          'h-9 w-9 p-0 font-normal inline-flex items-center justify-center rounded-md',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'aria-selected:opacity-100',
        ),
        selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-accent text-accent-foreground',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';
