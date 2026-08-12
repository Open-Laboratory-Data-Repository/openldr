import { useCallback, useEffect, useRef, useState } from 'react';
import { searchTerms, type Term, type TermStatus } from '../api';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { LoadingState } from '../components/ui/spinner';
import { StripedEmpty } from '../components/ui/striped-empty';
import { TruncatedText } from '../components/ui/truncated-text';

export interface PickedTerm { system: string; code: string; display: string | null }

/** Default shortest query that issues a request: a one-character query over a national facility
 *  register scans most of it to fill a 20-row dropdown the operator cannot use anyway.
 *
 *  It is a DEFAULT, not a rule for every system. `forms-builder/field-editor/CodesEditor.tsx`
 *  points the same picker at arbitrary coding systems where one-character codes are ordinary —
 *  `S`/`I`/`R` interpretations, `M`/`F`, the ABO groups — and passes 1 so they stay findable by
 *  code and not only by display text. */
const DEFAULT_MIN_QUERY_LENGTH = 2;

/** What the dropdown is showing. These are four DIFFERENT things and were previously one empty
 *  `results` array, so a failed request and a search that found nothing looked identical — the
 *  operator was told the register has no such facility when nobody had actually looked. */
type SearchState =
  | { kind: 'below-minimum' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; rows: Term[] };

export function TermPicker({ value, onChange, systemId, statuses, minQueryLength = DEFAULT_MIN_QUERY_LENGTH }: {
  value: PickedTerm | null;
  onChange: (v: PickedTerm | null) => void;
  systemId: string;
  /** Statuses to offer. ALL of them are sent — asking for two no longer collapses to no filter. */
  statuses?: TermStatus[];
  /** Shortest query that issues a request. See `DEFAULT_MIN_QUERY_LENGTH`. */
  minQueryLength?: number;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'below-minimum' });
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  // Monotonic request number. A debounce only NARROWS the window in which two requests are in
  // flight at once; it cannot order their answers, so the older one can still land last and
  // overwrite the newer. Only comparing against the latest number closes that.
  const generationRef = useRef(0);

  // Depend on the JOINED statuses, not the array. Every call site writes `statuses` as an inline
  // literal, so a parent re-render hands over a new array object; keying `search` on that identity
  // makes the effect below clear and re-arm its timer on every parent render, and a parent that
  // re-renders faster than the debounce means the search never runs at all. Joining on a comma is
  // safe because the prop is typed `TermStatus[]`, and none of those four tokens contains a comma.
  const statusKey = (statuses ?? []).join(',');

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (trimmed.length < minQueryLength) { setState({ kind: 'below-minimum' }); return; }
    setState({ kind: 'loading' });
    try {
      const res = await searchTerms(systemId, {
        q: trimmed,
        status: statusKey ? statusKey.split(',') : undefined,
        limit: 20,
      });
      if (generationRef.current !== generation) return;   // a newer search started; this answer is stale
      setState({ kind: 'ready', rows: res.rows });
    } catch {
      if (generationRef.current !== generation) return;
      setState({ kind: 'error' });
    }
  }, [systemId, statusKey, minQueryLength]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
        <span className="text-sm">
          <span className="font-mono text-primary">{value.code}</span>
          {value.display && <span className="ml-2 text-muted-foreground">— {value.display}</span>}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear"
          className="h-7 w-7 shrink-0"
          onClick={() => onChange(null)}
        >
          ×
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search terms…"
        className="h-9 text-sm"
      />
      {/* The panel is absolutely positioned, so whatever it opens over is COVERED, not pushed down.
          Opening it on focus alone therefore drops a "type at least 2 characters" box over the
          content below every call site — including `TermMappingDialog`'s own hint paragraph, which
          sits directly beneath the picker. Gate on the operator having typed something: the hint
          then appears exactly when it is useful (a query too short to run) and never before. */}
      {open && query.trim().length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {state.kind === 'below-minimum' && (
            <StripedEmpty className="min-h-[4rem]">Type at least {minQueryLength} characters to search.</StripedEmpty>
          )}
          {/* Spinner over the same backdrop, never stripes alone — stripes mean "nothing here", and
              nothing is known yet while the request is open. */}
          {state.kind === 'loading' && <LoadingState className="min-h-[4rem]" />}
          {state.kind === 'error' && (
            <div className="flex min-h-[4rem] flex-col items-center justify-center gap-2 px-3 py-3">
              <span className="text-xs text-muted-foreground">Could not search terms.</span>
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => { void search(query); }}>
                Retry
              </Button>
            </div>
          )}
          {state.kind === 'ready' && state.rows.length === 0 && (
            <StripedEmpty className="min-h-[4rem]">No results</StripedEmpty>
          )}
          {state.kind === 'ready' && state.rows.map((r) => (
            <button
              key={`${r.system}|${r.code}`}
              type="button"
              onClick={() => {
                onChange({ system: r.system, code: r.code, display: r.display });
                setOpen(false);
                setQuery('');
                setState({ kind: 'below-minimum' });
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="shrink-0 font-mono text-xs text-primary">{r.code}</span>
              <TruncatedText text={r.display ?? '—'} className="min-w-0 text-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
