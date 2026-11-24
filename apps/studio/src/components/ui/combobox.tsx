import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TruncatedText } from '@/components/ui/truncated-text';
import { cn } from '@/lib/cn';

export interface ComboboxOption { value: string; label: string }

export function Combobox({
  id, ariaLabel, options, value, onChange, placeholder, searchPlaceholder, disabled, limit, noneLabel, className,
}: {
  id?: string;
  /** The field's name, for a picker a label names. Without it the trigger is named by what it shows. */
  ariaLabel?: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  /** Show at most this many matches, for a long list such as a national register. Typing narrows it. */
  limit?: number;
  /** When given, a first row with this text answers '' so an optional field can go back to no value. */
  noneLabel?: string;
  /** Classes for the trigger, such as a height to match the row. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return limit ? matched.slice(0, limit) : matched;
  }, [options, query, limit]);

  return (
    // `modal`: inside a Sheet, react-remove-scroll only lets the Sheet's own subtree scroll, so the
    // portalled list would not take the wheel or touch scroll. A modal popover brings its own scroll
    // allowance (AGENTS.md section 6). Only a real browser can confirm it; jsdom cannot scroll.
    <Popover modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          id={id} variant="outline" role="combobox" aria-expanded={open} aria-haspopup="listbox" disabled={disabled}
          className={cn('w-full justify-between font-normal', className)} aria-label={ariaLabel ?? (selected ? selected.label : placeholder)}
        >
          <TruncatedText text={selected ? selected.label : placeholder} className={cn('min-w-0', !selected && 'text-muted-foreground')} />
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2"><Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} /></div>
        <div role="listbox" aria-label={ariaLabel ?? placeholder} className="max-h-64 overflow-y-auto p-1">
          {noneLabel !== undefined ? (
            <button
              type="button" role="option" aria-selected={!value}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
            >
              <span>{noneLabel}</span>
              {!value ? <Check className="ml-2 h-4 w-4 shrink-0" /> : null}
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">{searchPlaceholder}…</div>
          ) : filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
            >
              <TruncatedText text={o.label} className="min-w-0" />
              {o.value === value ? <Check className="ml-2 h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
