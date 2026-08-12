import { useCallback, useEffect, useId, useRef, useState } from 'react';
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

/** Inline English, matching `TermMappingDialog`'s own local `L`. Neither file is wired to
 *  `useTranslation`, so adding keys for this fragment alone would leave the dialog around it
 *  untranslated.
 *
 *  The `live*` strings are worded differently from the strings the panel shows. Two reasons, both
 *  real: a listener wants the shortest form of the status, and a test querying by text then lands
 *  on exactly one node instead of matching the panel and the announcement at once. */
const L = {
  searchLabel: 'Search terms',
  resultsLabel: 'Search results',
  placeholder: 'Search terms…',
  clear: 'Clear',
  retry: 'Retry',
  searchFailed: 'Could not search terms.',
  noResults: 'No results',
  minQuery: (n: number) => `Type at least ${n} characters to search.`,
  liveMinQuery: (n: number) => `Enter ${n} or more characters.`,
  liveSearching: 'Searching…',
  liveFailed: 'Search failed.',
  liveNoResults: 'No matching terms.',
  liveCount: (n: number) => (n === 1 ? '1 result available.' : `${n} results available.`),
  livePicked: (code: string, display: string | null) =>
    display ? `Selected ${code} — ${display}` : `Selected ${code}`,
} as const;

/** What the dropdown is showing. These are four DIFFERENT things and were previously one empty
 *  `results` array, so a failed request and a search that found nothing looked identical — the
 *  operator was told the register has no such facility when nobody had actually looked. */
type SearchState =
  | { kind: 'below-minimum' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; rows: Term[] };

/** The one-line form of `state`, for the polite live region. */
function liveStatus(state: SearchState, minQueryLength: number): string {
  switch (state.kind) {
    case 'below-minimum': return L.liveMinQuery(minQueryLength);
    case 'loading': return L.liveSearching;
    case 'error': return L.liveFailed;
    case 'ready': return state.rows.length === 0 ? L.liveNoResults : L.liveCount(state.rows.length);
  }
}

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
  /** Index of the highlighted row, or -1 for none. This is NOT DOM focus — see `aria-activedescendant`. */
  const [active, setActive] = useState(-1);
  /** Set when the operator picks a term, so the announcement outlives the search box. */
  const [pickedNotice, setPickedNotice] = useState('');
  /** Bumped by every pick, purely to give the focus effect below something to fire on. */
  const [pickCount, setPickCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  // Monotonic request number. A debounce only NARROWS the window in which two requests are in
  // flight at once; it cannot order their answers, so the older one can still land last and
  // overwrite the newer. Only comparing against the latest number closes that.
  const generationRef = useRef(0);

  // Per-instance id prefix: `aria-controls` and `aria-activedescendant` are id references, and two
  // pickers on one page must not both claim the same ones.
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number): string => `${baseId}-option-${i}`;

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

  // A new list of rows invalidates the old highlight: row 3 of the previous answer is a different
  // term from row 3 of this one, and silently carrying the index over would let Enter pick a term
  // the operator never looked at. `state` is replaced on every search transition, so depending on
  // it here is the same thing as "the list underneath changed".
  useEffect(() => { setActive(-1); }, [state]);

  const rows = state.kind === 'ready' ? state.rows : [];
  /** Whether the results panel is on screen — the thing `aria-expanded` reports.
   *  The panel is absolutely positioned, so it COVERS what is below rather than pushing it down.
   *  Opening it on focus alone therefore drops a "type at least 2 characters" box over the content
   *  below every call site — including `TermMappingDialog`'s own hint paragraph, which sits
   *  directly beneath the picker. Gate on the operator having typed something. */
  const panelOpen = open && query.trim().length > 0;

  const pick = (r: Term): void => {
    setPickedNotice(L.livePicked(r.code, r.display));
    setPickCount((n) => n + 1);
    onChange({ system: r.system, code: r.code, display: r.display });
    setOpen(false);
    setQuery('');
    setActive(-1);
    setState({ kind: 'below-minimum' });
  };

  // DOM focus stays on the search box the whole time the list is open — `aria-activedescendant`
  // moves the highlight instead — so Escape and arrow keys have nothing to restore. Picking is the
  // one case where focus really is destroyed: when the call site stores the picked term, `value`
  // turns non-null and the search box is replaced by the chip, which would drop focus on <body>.
  // Hand it to the chip's Clear button. When the call site resets `value` to null instead
  // (`CodesEditor`, which appends the pick and keeps searching) there is no Clear button, the ref
  // is null, and focus simply stays in the search box.
  useEffect(() => {
    if (pickCount === 0) return;
    clearRef.current?.focus();
  }, [pickCount]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); return; }
    // Escape shuts the panel but keeps the typed query. Without this, the only way back to the
    // results is editing the text, which is a dead end for someone who dismissed the panel to read
    // what was underneath it.
    if (e.key === 'ArrowDown' && !panelOpen && query.trim().length > 0) { e.preventDefault(); setOpen(true); return; }
    if (!panelOpen || rows.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(rows.length - 1); return; }
    if (e.key === 'Enter' && active >= 0 && rows[active]) { e.preventDefault(); pick(rows[active]!); }
  };

  // A pick is the freshest thing that happened, so it outranks the search status until the operator
  // types again. Nothing is announced while the panel is shut — otherwise mounting the picker would
  // read out "enter 2 or more characters" to someone who has not gone near it.
  const liveMessage = pickedNotice !== '' ? pickedNotice : panelOpen ? liveStatus(state, minQueryLength) : '';

  return (
    <div ref={containerRef} className="relative">
      {/* Mounted in both branches below, and never conditionally: a live region that appears in the
          same commit as its text is usually not announced at all. Keeping it outside the
          search-box/chip swap is what lets the pick announcement survive that swap. */}
      <p role="status" aria-live="polite" className="sr-only">{liveMessage}</p>

      {value ? (
        <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
          <span className="text-sm">
            <span className="font-mono text-primary">{value.code}</span>
            {value.display && <span className="ml-2 text-muted-foreground">— {value.display}</span>}
          </span>
          <Button
            ref={clearRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={L.clear}
            /* 28×28 — above the 24×24 floor of WCAG 2.2 SC 2.5.8. */
            className="h-7 w-7 shrink-0"
            onClick={() => onChange(null)}
          >
            ×
          </Button>
        </div>
      ) : (
        <>
          <Input
            role="combobox"
            aria-label={L.searchLabel}
            aria-expanded={panelOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && rows[active] ? optionId(active) : undefined}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setPickedNotice(''); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={L.placeholder}
            className="h-9 text-sm"
          />
          {panelOpen && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
              {state.kind === 'below-minimum' && (
                <StripedEmpty className="min-h-[4rem]">{L.minQuery(minQueryLength)}</StripedEmpty>
              )}
              {/* Spinner over the same backdrop, never stripes alone — stripes mean "nothing here", and
                  nothing is known yet while the request is open. */}
              {state.kind === 'loading' && <LoadingState className="min-h-[4rem]" />}
              {state.kind === 'error' && (
                <div className="flex min-h-[4rem] flex-col items-center justify-center gap-2 px-3 py-3">
                  <span className="text-xs text-muted-foreground">{L.searchFailed}</span>
                  <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => { void search(query); }}>
                    {L.retry}
                  </Button>
                </div>
              )}
              {state.kind === 'ready' && state.rows.length === 0 && (
                <StripedEmpty className="min-h-[4rem]">{L.noResults}</StripedEmpty>
              )}
              {/* The listbox holds options and nothing else. The four states above are siblings of
                  it rather than children, because a plain <div> of prose inside a listbox is not a
                  thing the role allows. It is rendered even when it holds no options, so that
                  whenever the panel is open `aria-controls` resolves to a real element. */}
              <div id={listboxId} role="listbox" aria-label={L.resultsLabel}>
                {state.kind === 'ready' && state.rows.map((r, i) => (
                  <div
                    key={`${r.system}|${r.code}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    /* No tabIndex, deliberately. In an activedescendant listbox the options are not
                       focusable; the search box keeps DOM focus and only points at the active one. */
                    onClick={() => pick(r)}
                    onMouseEnter={() => setActive(i)}
                    /* Row height is 36px (py-2 over a 20px line), above SC 2.5.8's 24×24 floor.
                       The keyboard highlight adds an inset ring on top of the background so it is
                       not a colour-only difference, and so it stays distinct from plain hover,
                       which tints the background alone (SC 2.4.11). */
                    className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${i === active ? 'bg-accent ring-1 ring-inset ring-ring' : ''}`}
                  >
                    <span className="shrink-0 font-mono text-xs text-primary">{r.code}</span>
                    <TruncatedText text={r.display ?? '—'} className="min-w-0 text-foreground" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
