import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from './badge';
import { Button } from './button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Pick several values: the chosen ones show as chips with a remove action, and a Select adds one
 * more. Built from Select, Badge and Button. It has no popover, so it scrolls inside a Sheet.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  removeLabel,
  className,
  'aria-label': ariaLabel,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** The add Select's placeholder, for example "Add a form". */
  placeholder: string;
  /** The remove action's accessible name for one chip. */
  removeLabel: (label: string) => string;
  className?: string;
  'aria-label'?: string;
}) {
  // A new key after each pick resets the add Select to its placeholder.
  const [round, setRound] = useState(0);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const left = options.filter((o) => !value.includes(o.value));

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="max-w-full gap-1 pr-0.5">
              <span className="truncate">{labelOf(v)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 shrink-0"
                aria-label={removeLabel(labelOf(v))}
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      {left.length > 0 && (
        <Select
          key={round}
          onValueChange={(v) => {
            onChange([...value, v]);
            setRound((r) => r + 1);
          }}
        >
          <SelectTrigger aria-label={ariaLabel ?? placeholder} className="w-full min-w-0">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {left.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
