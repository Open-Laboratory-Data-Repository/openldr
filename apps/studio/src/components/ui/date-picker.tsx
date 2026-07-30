import * as React from 'react';
import { format, isAfter, isBefore, startOfDay } from 'date-fns';
import { Calendar, CALENDAR_START_MONTH, CALENDAR_END_MONTH } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { cn } from '@/lib/cn';

interface DatePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  minDate?: Date;
  maxDate?: Date;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({ value, onChange, minDate, maxDate, placeholder = 'Pick a date', disabled, className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const dateValue = value ? new Date(value) : undefined;

  const handleDateSelect = (day: Date | undefined) => {
    if (!day) return;
    onChange(format(day, 'yyyy-MM-dd'));
    setOpen(false);
  };
  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className={cn('h-9 w-full justify-start text-left font-normal', !value && 'text-muted-foreground', className)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 shrink-0">
            <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />
          </svg>
          {value ? format(new Date(value), 'dd/MM/yyyy') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {/* Month + YEAR dropdowns, same rationale as DateRangePicker: every DatePicker in the app
            is a data filter (table filters, dashboard filters, widget parameters), so it has to
            reach historical data. With prev/next arrows alone that is one click per month.
            `minDate`/`maxDate` narrow the dropdown when the caller has constrained the field. */}
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleDateSelect}
          captionLayout="dropdown"
          startMonth={minDate ?? CALENDAR_START_MONTH}
          endMonth={maxDate ?? CALENDAR_END_MONTH}
          defaultMonth={dateValue ?? undefined}
          disabled={(date) => {
            if (maxDate && isAfter(startOfDay(date), startOfDay(maxDate))) return true;
            if (minDate && isBefore(startOfDay(date), startOfDay(minDate))) return true;
            return false;
          }}
        />
        <div className="flex justify-between border-t border-border px-3 py-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-muted-foreground">
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
