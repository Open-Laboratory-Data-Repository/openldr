import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { isCodingAnswer, type CodingAnswer, type EntityAnswer, type FormField } from '@openldr/forms/pure';
import { catalogSpecimensFor, referenceSearch, referenceSearchPreview, type ReferenceSearchResponse } from '@/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';

export type ReferenceValue = CodingAnswer | EntityAnswer;

interface Row { key: string; display: string; secondary: string | null; value: ReferenceValue }

function toRows(res: ReferenceSearchResponse): Row[] {
  return res.kind === 'entity'
    ? res.rows.map((r) => ({
        key: r.reference, display: r.display, secondary: r.secondary,
        value: { reference: r.reference, display: r.display },
      }))
    : res.rows.map((r) => ({
        key: `${r.system}|${r.code}`, display: r.display ?? r.code, secondary: r.code,
        value: { system: r.system, code: r.code, display: r.display },
      }));
}

function codingRow(c: { system: string; code: string; display: string | null }): Row {
  return { key: `${c.system}|${c.code}`, display: c.display ?? c.code, secondary: c.code, value: { system: c.system, code: c.code, display: c.display } };
}

/** The coding answers in a field's value, one or many. */
function codingsIn(value: unknown): CodingAnswer[] {
  return (Array.isArray(value) ? value : [value]).filter(isCodingAnswer);
}

/**
 * A value here is not guaranteed to be an object: `fromAnswer` decodes a display-less
 * valueReference back to a bare reference string, so legacy stored answers arrive as
 * primitives. `'x' in v` THROWS a TypeError on a primitive, and keyOf runs inside key={...}
 * during render — which unmounted the React tree instead of degrading. Both helpers now
 * fall back to the value's string form.
 */
const isRefObject = (v: unknown): v is ReferenceValue => typeof v === 'object' && v !== null;

const labelOf = (v: ReferenceValue): string => {
  if (!isRefObject(v)) return String(v);
  return v.display ?? ('reference' in v ? v.reference : v.code);
};
const keyOf = (v: ReferenceValue): string => {
  if (!isRefObject(v)) return String(v);
  return 'reference' in v ? v.reference : `${v.system}|${v.code}`;
};

export function ReferencePicker({ field, formDefinitionId, preview = false, multiple, value, onChange, dependsOnValue, trailing }: {
  field: FormField;
  /**
   * Id of the STORED form definition this field belongs to — the `:formId` path segment of
   * `/api/forms/:formId/fields/:fieldId/reference-search`. Deliberately NOT the DOM id that
   * `FormRuntime`'s `formId` prop sets on the `<form>` element; conflating the two made every
   * capture-page search request a 404.
   */
  formDefinitionId?: string;
  /**
   * Builder live preview only: search an UNSAVED field descriptor through the
   * `forms.edit`-gated preview endpoint. Opt-in on purpose — it must never be reached as a
   * fallback for a forgotten `formDefinitionId`, because that endpoint can search sources no
   * stored form declares.
   */
  preview?: boolean;
  multiple: boolean;
  value: ReferenceValue | ReferenceValue[] | null;
  onChange: (v: ReferenceValue | ReferenceValue[] | null) => void;
  /**
   * The answer of the field this one depends on (`referenceDependsOn`). When it holds catalog tests,
   * the picker offers only the specimens at least one of them accepts (test catalog S4).
   */
  dependsOnValue?: unknown;
  /** A control drawn inside the right edge of the search box, such as a field's dots menu. */
  trailing?: ReactNode;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  // Test catalog S4: a field that depends on the order's tests offers only the specimens at least one
  // chosen test accepts. The server decides which answers are catalog tests. An empty answer, or a
  // failed request, means no narrowing, so the picker never ends up offering nothing.
  const [narrowTo, setNarrowTo] = useState<Row[] | null>(null);
  const dependsOn = codingsIn(dependsOnValue);
  const dependsOnKey = dependsOn.map((c) => `${c.system}|${c.code}`).join('\n');
  useEffect(() => {
    if (!dependsOnKey) { setNarrowTo(null); return; }
    let cancelled = false;
    catalogSpecimensFor(dependsOn.map(({ system, code }) => ({ system, code })))
      .then((rows) => { if (!cancelled) setNarrowTo(rows.length > 0 ? rows.map(codingRow) : null); })
      .catch(() => { if (!cancelled) setNarrowTo(null); });
    return () => { cancelled = true; };
    // Keyed on the chosen codes, not on the answer object, which is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependsOnKey]);

  const selected: ReferenceValue[] = value == null ? [] : Array.isArray(value) ? value : [value];

  // Neither a stored form to scope the search to nor an explicit preview opt-in: there is no
  // endpoint this picker may legitimately call, so it degrades to a read-only state instead of
  // reaching for the privileged preview route.
  const unavailable = !preview && !formDefinitionId;

  const search = useCallback(async (q: string) => {
    if (unavailable) return;
    if (narrowTo) {
      // The narrowed list is a few codes, so it is filtered here, from the first keystroke.
      const needle = q.trim().toLowerCase();
      setRows(needle
        ? narrowTo.filter((r) => r.display.toLowerCase().includes(needle) || (r.secondary ?? '').toLowerCase().includes(needle))
        : narrowTo);
      setError(null);
      setActive(-1);
      return;
    }
    const trimmed = q.trim();
    if (trimmed.length < 2) { setRows([]); setError(null); return; }
    const requestId = ++requestIdRef.current;
    setBusy(true); setError(null);
    try {
      const res = preview
        ? await referenceSearchPreview(field, { q: trimmed })
        : await referenceSearch(formDefinitionId!, field.id, { q: trimmed });
      if (requestIdRef.current !== requestId) return;
      setRows(toRows(res));
      setActive(-1);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }, [field, formDefinitionId, preview, unavailable, narrowTo]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pick = (row: Row): void => {
    if (multiple) {
      if (!selected.some((s) => keyOf(s) === keyOf(row.value))) onChange([...selected, row.value]);
    } else {
      onChange(row.value);
    }
    setQuery(''); setRows([]); setOpen(false); setActive(-1);
  };

  const remove = (v: ReferenceValue): void => {
    const next = selected.filter((s) => keyOf(s) !== keyOf(v));
    onChange(multiple ? (next.length > 0 ? next : null) : null);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && active >= 0 && rows[active]) { e.preventDefault(); pick(rows[active]!); }
  };

  const showSingleSelected = !multiple && selected.length > 0;

  if (unavailable) {
    return (
      <div>
        <Input
          id={field.id}
          disabled
          readOnly
          value={selected.map((v) => labelOf(v)).join(', ')}
          placeholder="Reference search unavailable"
          aria-label={field.displayLabel}
          className="h-9 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          This field is not attached to a saved form, so its values cannot be looked up here.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {selected.length > 0 && (
        <div className={multiple ? 'mb-1 flex flex-wrap gap-1' : 'flex items-center justify-between rounded-md border border-input px-3 py-2'}>
          {selected.map((v) => (
            <span
              key={keyOf(v)}
              // Single mode: the span is the flex row, not the wrapper — the wrapper holds
              // exactly one child, so justify-between on it does nothing and the block-level
              // TruncatedText pushes the clear button onto its own line.
              className={multiple
                ? 'inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs'
                : 'flex w-full items-center justify-between gap-2 text-sm'}
            >
              <TruncatedText text={labelOf(v)} className="min-w-0" />
              <Button
                type="button" variant="ghost" size="icon"
                aria-label={`Clear ${labelOf(v)}`}
                className="h-5 w-5 shrink-0"
                onClick={() => remove(v)}
              >
                ×
              </Button>
              {/* A single pick hides the search box, so the trailing control moves here. */}
              {!multiple && trailing}
            </span>
          ))}
        </div>
      )}

      {!showSingleSelected && (
        <div className="relative">
          <Input
            role="combobox"
            aria-expanded={open}
            aria-controls={`${field.id}-reference-listbox`}
            aria-activedescendant={active >= 0 && rows[active] ? `${field.id}-reference-option-${active}` : undefined}
            id={field.id}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={field.placeholder ?? 'Search…'}
            className={cn('h-9 text-sm', trailing && 'pr-10')}
          />
          {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
        </div>
      )}

      {open && (narrowTo !== null || query.trim().length >= 2) && (
        <div
          id={`${field.id}-reference-listbox`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {busy && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" />
              Searching…
            </div>
          )}
          {error && <div className="px-3 py-3 text-xs text-destructive" role="alert">{error}</div>}
          {!busy && !error && rows.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">No matches</div>
          )}
          {!error && rows.map((r, i) => (
            <button
              key={r.key}
              id={`${field.id}-reference-option-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${i === active ? 'bg-accent' : ''}`}
            >
              <TruncatedText text={r.display} className="min-w-0 text-foreground" />
              {r.secondary && <span className="text-xs text-muted-foreground">{r.secondary}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
