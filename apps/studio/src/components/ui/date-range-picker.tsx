import * as React from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Calendar, CALENDAR_START_MONTH, CALENDAR_END_MONTH } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { cn } from '@/lib/cn';

export interface DateRangePreset {
  label: string;
  range: { from: string; to: string };
}

// Shared with DatePicker so the two surfaces can never drift apart — see calendar.tsx.
const START_MONTH = CALENDAR_START_MONTH;
const END_MONTH = CALENDAR_END_MONTH;

/** Presets every date-range surface should offer. `All time` is the important one: with only
 *  relative windows, historical data (the common case for lab archives) is unreachable without
 *  hand-picking a start year. */
export function defaultDateRangePresets(): DateRangePreset[] {
  const iso = (d: Date) => format(d, 'yyyy-MM-dd');
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  const y = today.getFullYear();
  return [
    { label: 'Last 7 days', range: { from: iso(daysAgo(7)), to: iso(today) } },
    { label: 'Last 30 days', range: { from: iso(daysAgo(30)), to: iso(today) } },
    { label: 'Last 12 months', range: { from: iso(new Date(y - 1, today.getMonth(), today.getDate())), to: iso(today) } },
    { label: 'This year', range: { from: `${y}-01-01`, to: iso(today) } },
    { label: 'Last year', range: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } },
    { label: 'All time', range: { from: iso(START_MONTH), to: iso(END_MONTH) } },
  ];
}

interface DateRangePickerProps {
  value: { from: string; to: string } | null;
  onChange: (value: { from: string; to: string } | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  presets?: DateRangePreset[];
}

export function DateRangePicker({ value, onChange, placeholder = 'Pick a date range', disabled, className, presets }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const dateRange: DateRange | undefined =
    value?.from || value?.to ? { from: value.from ? new Date(value.from) : undefined, to: value.to ? new Date(value.to) : undefined } : undefined;

  const handleSelect = (range: DateRange | undefined) => {
    if (!range) return;
    onChange({ from: range.from ? format(range.from, 'yyyy-MM-dd') : '', to: range.to ? format(range.to, 'yyyy-MM-dd') : '' });
  };
  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };
  const displayText = () => {
    if (!value?.from) return placeholder;
    if (!value.to) return format(new Date(value.from), 'dd/MM/yyyy') + ' – ...';
    return format(new Date(value.from), 'dd/MM/yyyy') + ' – ' + format(new Date(value.to), 'dd/MM/yyyy');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className={cn('h-9 justify-start text-left font-normal', !value?.from && 'text-muted-foreground', className)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 shrink-0">
            <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />
          </svg>
          <span className="text-xs">{displayText()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {presets && presets.length > 0 && (
            <div className="flex flex-col gap-1 border-r border-border p-2">
              {presets.map((p) => (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  className="justify-start text-xs font-normal"
                  onClick={() => {
                    onChange(p.range);
                    setOpen(false);
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
          {/* `captionLayout="dropdown"` + an explicit startMonth/endMonth give month AND YEAR
              dropdowns. Without them react-day-picker shows only prev/next month arrows, so
              reaching a historical month costs one click per month — laboratory archives are
              routinely years old (the DISA corpus here is 2013-2016, i.e. ~150 clicks), which made
              every date-range-parameterised report effectively unrunnable. */}
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={handleSelect}
            numberOfMonths={2}
            captionLayout="dropdown"
            startMonth={START_MONTH}
            endMonth={END_MONTH}
            defaultMonth={dateRange?.from ?? undefined}
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-muted-foreground">
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
