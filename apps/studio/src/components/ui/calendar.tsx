import * as React from 'react';
import { DayPicker, type DropdownProps } from 'react-day-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { cn } from '@/lib/cn';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/** Caption month/year picker.
 *
 *  react-day-picker's own `Dropdown` renders a NATIVE `<select>` and expects its stylesheet to lay
 *  that select invisibly over a styled label. This app never imports that stylesheet and uses
 *  shadcn/Radix controls everywhere, so we replace the component outright rather than trying to
 *  hide OS chrome: the user gets the same dropdown as every other select in Studio, and the native
 *  control (which cannot be themed to match) disappears entirely.
 *
 *  Both `MonthsDropdown` and `YearsDropdown` render through `components.Dropdown`, so this single
 *  override covers the month AND the year picker. RDP hands us a native-select `onChange` and only
 *  ever reads `event.target.value` from it, so a minimal synthetic event is a faithful call. */
function CalendarDropdown({ options, value, onChange, disabled, 'aria-label': ariaLabel }: DropdownProps) {
  const selected = options?.find((o) => o.value === value);
  return (
    <Select
      value={value === undefined ? undefined : String(value)}
      disabled={disabled}
      onValueChange={(next) => onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>)}
    >
      <SelectTrigger aria-label={ariaLabel} className="h-7 gap-1 px-2 text-sm font-medium hover:bg-accent">
        {/* Radix only mounts the items while the popover is open, so it cannot derive the closed
            trigger's text from `value` alone — pass the label explicitly. */}
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      {/* The year list spans the whole archive window (see CALENDAR_START_MONTH), so it has to scroll. */}
      <SelectContent className="max-h-60 overflow-y-auto">
        {options?.map((o) => (
          <SelectItem key={o.value} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Selectable span for the caption year dropdown, shared by every date surface. Wide enough for
 *  real laboratory archives — a national repository holds a decade or more of history — without
 *  making the dropdown unusable. Any picker that omits these gets prev/next month arrows only,
 *  which costs one click per month to reach an old date (the 2013-2016 DISA corpus is ~150). */
export const CALENDAR_START_MONTH = new Date(2000, 0, 1);
export const CALENDAR_END_MONTH = new Date(new Date().getFullYear() + 1, 11, 31);

export function Calendar({ className, classNames, components, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      // Destructured out of `props` (like `classNames`) so the `{...props}` spread below cannot
      // clobber the override with the caller's raw value.
      components={{ Dropdown: CalendarDropdown, ...components }}
      classNames={{
        // `months` is the positioning context for `nav` below: in react-day-picker v10, the
        // Nav element (holding both prev/next buttons) renders once as a sibling *before* the
        // Month blocks, not nested inside `month_caption` as it was in v8. Without an explicit
        // `relative` ancestor here, the buttons' `absolute` positioning falls back to a distant
        // positioned ancestor (e.g. the popover), landing on top of the day grid instead of the
        // caption row.
        // `items-center` only bites in the stacked (phone) case, where the popover is as wide as the
        // preset strip above it and the lone month would otherwise hug the left edge.
        months: 'relative flex flex-col items-center sm:flex-row sm:items-stretch space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        // `px-9` reserves the width of the absolutely-positioned prev/next buttons at either end
        // of the caption row (h-7 w-7 inside `nav`'s px-1). Without it the caption content — which
        // is much wider under `captionLayout="dropdown"` than a plain "January 2026" label — runs
        // underneath the arrows.
        month_caption: 'flex h-9 items-center justify-center px-9',
        caption_label: 'text-sm font-medium',
        // Pinned to the top of `months` (same height as `month_caption`) so it overlays only the
        // caption row, never the grid below. `pointer-events-none` is load-bearing: `inset-x-0`
        // makes this a FULL-WIDTH box sitting above the caption at z-10, so it swallowed every
        // click aimed at the month/year dropdowns underneath it (only the two arrows at its far
        // ends were reachable). The buttons opt back in individually.
        nav: 'pointer-events-none absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-between px-1',
        button_previous:
          'pointer-events-auto h-7 w-7 bg-transparent p-0 text-foreground hover:bg-accent inline-flex items-center justify-center rounded-md border border-input',
        button_next:
          'pointer-events-auto h-7 w-7 bg-transparent p-0 text-foreground hover:bg-accent inline-flex items-center justify-center rounded-md border border-input',
        // react-day-picker's Chevron is a bare <svg><polygon/></svg> with NO fill attribute, so it
        // paints in SVG's default fill — BLACK — which is invisible against the dark theme (it read
        // as a murky grey once the button's old opacity-50 was applied on top). `fill-current` hands
        // it the button's own text colour so the arrows are legible in both themes.
        chevron: 'fill-current',
        // Layout for the caption month/year controls; the controls themselves are shadcn Selects
        // (see CalendarDropdown above), so react-day-picker's `dropdown`/`dropdown_root` slots are
        // never rendered and need no classes.
        dropdowns: 'flex items-center gap-1.5',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button: cn(
          'h-9 w-9 p-0 font-normal inline-flex items-center justify-center rounded-md',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        ),
        // The selection is painted on the day CELL, but the number the user actually reads lives in
        // the <button> inside it — and that button carries its own `hover:` colours, while the
        // `outside` modifier (a day belonging to the adjacent month, e.g. the range's first day when
        // it shows up in the second calendar) adds a muted colour and `opacity-50` to the same cell.
        // Either can repaint or fade the number on top of the brand-blue fill. Restate the colour on
        // the button and cancel the fade so a selected day is ALWAYS solid white on blue, in both
        // themes, hovered or not, and independent of Tailwind's utility ordering.
        selected: cn(
          'bg-primary opacity-100 hover:bg-primary focus:bg-primary',
          '[&_button]:text-primary-foreground [&_button]:opacity-100',
          '[&_button:hover]:bg-transparent [&_button:hover]:text-primary-foreground',
        ),
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
