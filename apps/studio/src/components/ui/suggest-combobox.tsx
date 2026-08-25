import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';

/**
 * Where the suggestion list currently stands. Deliberately three states, not a boolean —
 * "no suggestions yet fetched" (loading) and "fetched, and there simply are none" (ready with
 * an empty list) read very differently to a user and must not collapse into one message.
 */
export type SuggestStatus = 'loading' | 'ready' | 'error';

export interface SuggestComboboxProps {
  id?: string;
  /** The current answer — a plain string, typed directly by the user or picked from a suggestion. */
  value: string;
  /** Fires on every keystroke AND on picking a suggestion — both are just "the string changed". */
  onChange: (value: string) => void;
  /** Candidate values to propose. Never constrains: any other typed value is accepted as-is. */
  options: string[];
  /**
   * Optional value → human label, for options whose VALUE is not readable.
   *
   * The facility register field stores a canonical URI (`urn:zm:mfl`) because `idFor` hashes exactly
   * that string into every facility's permanent id — but an operator should be choosing "Zambia MFL".
   * The label is display and search only; the value stored is always the option itself.
   */
  optionLabels?: Record<string, string>;
  /**
   * Optional value to secondary-line text. When an option has one, it renders BELOW the label,
   * wrapped rather than truncated, and it is searchable like the label is.
   *
   * Exists because a one-line option truncates hard in a narrow column: the FHIR path picker's
   * list is 163px on a 375px viewport, where a path plus its definition needs 313px, and the
   * definition is what the operator actually needs to read.
   */
  optionDescriptions?: Record<string, string>;
  /** Defaults to 'ready' so a caller that hasn't wired fetching yet still gets a usable field. */
  status?: SuggestStatus;
  error?: string | null;
  placeholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  /**
   * Copy for the listbox's three non-option rows (loading / empty / error-fallback). This is a
   * generic `ui/` primitive with no `useTranslation` of its own — same convention as `Combobox`
   * (`combobox.tsx`), which takes its `placeholder`/`searchPlaceholder` as required props rather
   * than importing i18n directly. These three are optional with English defaults instead (a
   * `suggest` field's hardcoded fallback `placeholder` already worked this way) purely so an
   * existing caller that hasn't been updated yet still renders something rather than blank text;
   * a translated caller (FormRuntime's `suggestCopy` prop, sourced from FacilityDialog's `t()`)
   * should always supply all four.
   */
  loadingLabel?: string;
  noSuggestionsLabel?: string;
  errorFallback?: string;
  /** Which end to clip an option's label when it does not fit. Defaults to 'end'. */
  optionLabelTruncateFrom?: 'end' | 'start';
}

/**
 * A free-typing combobox: it PROPOSES `options` but never constrains the answer to them. Typing
 * always commits verbatim (there is no separate "confirm" step), and picking a suggestion is
 * just a shortcut that fills in that same string. Built from the shadcn `Input` primitive plus a
 * hand-rolled ARIA combobox/listbox — the same pattern `ReferencePicker` uses for its
 * fetch-backed picker — rather than the button-triggered `Combobox` primitive, whose Popover +
 * "select from a fixed list" interaction model doesn't fit free text.
 */
export function SuggestCombobox({
  id, value, onChange, options, optionLabels, optionDescriptions, status = 'ready', error = null,
  placeholder = 'Type or pick a suggestion…',
  loadingLabel = 'Loading suggestions…',
  noSuggestionsLabel = 'No suggestions',
  errorFallback = 'Could not load suggestions',
  label, required, disabled,
  optionLabelTruncateFrom,
}: SuggestComboboxProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const labelOf = (o: string): string => optionLabels?.[o] ?? o;
  const descriptionOf = (o: string): string | undefined => optionDescriptions?.[o];

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    // Matches the LABEL and the DESCRIPTION as well as the value: an operator typing "zambia" is
    // looking for the register they can see, not the URI underneath it, and one typing "county"
    // is looking for the element whose definition says so, not one whose path does.
    return options.filter((o) =>
      o.toLowerCase().includes(q)
      || labelOf(o).toLowerCase().includes(q)
      || (descriptionOf(o)?.toLowerCase().includes(q) ?? false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, optionLabels, optionDescriptions, value]);

  useEffect(() => { setActive(-1); }, [filtered.length, open]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const listboxId = id ? `${id}-suggest-listbox` : undefined;
  const optionId = (i: number): string | undefined => (id ? `${id}-suggest-option-${i}` : undefined);

  const pick = (opt: string): void => {
    onChange(opt);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open || status !== 'ready') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && active >= 0 && filtered[active]) { e.preventDefault(); pick(filtered[active]!); }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={active >= 0 && filtered[active] ? optionId(active) : undefined}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9 text-sm"
      />
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {status === 'loading' && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" />
              {loadingLabel}
            </div>
          )}
          {status === 'error' && (
            <div className="px-3 py-3 text-xs text-destructive" role="alert">
              {error ?? errorFallback}
            </div>
          )}
          {status === 'ready' && filtered.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">{noSuggestionsLabel}</div>
          )}
          {status === 'ready' && filtered.map((opt, i) => {
            const description = descriptionOf(opt);
            return (
              <button
                key={opt}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={i === active}
                // The label and description render as two sibling elements with no whitespace
                // between them, so the DOM text content runs them together into a single word
                // ("districtDistrict..."). Anything that reads the accessible name from
                // content sees that run-together string: a screen reader, or a test matching
                // by role name. An explicit aria-label fixes that without touching the visible
                // two-line layout. Left unset when there is no description, so an option
                // without one keeps deriving its name from content exactly as it did before
                // this prop existed.
                aria-label={description ? `${labelOf(opt)}, ${description}` : undefined}
                onClick={() => pick(opt)}
                onMouseEnter={() => setActive(i)}
                className={description
                  ? cn(
                    'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                    i === active && 'bg-accent',
                  )
                  // Unchanged from before this prop existed: an option without a description
                  // must render byte-identically, since FormRuntime's facility picker still
                  // relies on this exact single-line layout.
                  : `flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${i === active ? 'bg-accent' : ''}`}
              >
                {/* w-full: this button is a flex COLUMN with items-start, so a plain flex
                    item sizes to its own content instead of the row's width. TruncatedText's
                    `truncate` needs a bounded width to clip against, so the label must claim
                    the full row width explicitly here. Only this line gets it — the
                    description below stays a natural-width block so it keeps wrapping. */}
                <TruncatedText
                  text={labelOf(opt)}
                  className="min-w-0 w-full"
                  truncateFrom={optionLabelTruncateFrom}
                />
                {description && (
                  <span className="whitespace-normal break-words text-xs text-muted-foreground">
                    {description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
