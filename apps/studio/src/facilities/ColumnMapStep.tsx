import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ColumnSuggestion, FacilityColumnMap } from '@/api';

// Task 7: mirrors packages/terminology/src/facility-csv.ts's REQUIRED/OPTIONAL — "mirrored, not
// shared", the same idiom every other facility-import type in this app already follows (this app
// has no dependency on that package). A second copy drifts the moment a field is added there; if
// that happens, this list is the one to update.
const REQUIRED_FIELDS = ['national_code', 'name'] as const;
const OPTIONAL_FIELDS = [
  'level', 'ownership', 'status',
  'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
  'address', 'phone', 'latitude', 'longitude',
] as const;
const CONTRACT_FIELDS: readonly string[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

/** Not a contract field — a real header could never collide with it. */
const UNMAPPED = '__not_mapped__';

export interface ColumnMapStepProps {
  /** One row per entry, in file order. */
  headers: string[];
  /** The suggestion engine's own answer for this file (Task 2/4) — `suggestionByHeader` below reads
   *  it by `header`, so this need not be in the same order as `headers`. */
  suggestions: ColumnSuggestion[];
  value: FacilityColumnMap;
  onChange: (next: FacilityColumnMap) => void;
  /** Facilities this file carries, when known. The spec is explicit that a mapping decision's
   *  impact is reported in facilities, never in distinct strings — see
   *  `docs/superpowers/specs/2026-08-12-facility-import-mapping-design.md` §4. Omitted before a
   *  file has ever been parsed. */
  rowCount?: number;
  /** Fires whenever whether every required field is satisfied changes — so the host (Task 8's
   *  `ImportFacilitiesSheet`) can gate its own Continue action without re-deriving the same
   *  required-field rule a second time. */
  onValidityChange?: (valid: boolean) => void;
}

/** The column-mapping panel — one row per file header, a `Select` over the 16 contract fields, and
 *  a constants section for a field no column carries (`country` is the case that forced it).
 *
 *  ⛔ THE COLLISION RULE, measured on the real Zambia MFL export: `Province` and `Zone` BOTH suggest
 *  `zone` at exact confidence; `Ownership` and `Ownership type` BOTH suggest `ownership`. Task 1's
 *  `validateColumnMap` correctly refuses a map where two headers claim one field
 *  (`duplicate_target`), so pre-selecting every exact suggestion would hand the operator a map that
 *  refuses their own file on the very first Continue. When two or more headers' TOP suggestion
 *  (`exact` or `likely` — a `weak` one never pre-selects regardless) name the same field, NEITHER is
 *  pre-selected; both are left `Not mapped` and need an explicit decision. See `autoTargetByHeader`
 *  below. */
export function ColumnMapStep({
  headers, suggestions, value, onChange, rowCount, onValidityChange,
}: ColumnMapStepProps): JSX.Element {
  const { t } = useTranslation();

  const suggestionByHeader = useMemo(() => {
    const m = new Map<string, ColumnSuggestion>();
    for (const s of suggestions) m.set(s.header, s);
    return m;
  }, [suggestions]);

  const autoTargetByHeader = useMemo(() => {
    const topByHeader = new Map<string, { target: string; confidence: string }>();
    const countByTarget = new Map<string, number>();
    for (const header of headers) {
      const top = suggestionByHeader.get(header)?.candidates[0];
      if (!top || top.confidence === 'weak') continue; // a weak guess never pre-selects, collision or not
      topByHeader.set(header, top);
      countByTarget.set(top.target, (countByTarget.get(top.target) ?? 0) + 1);
    }
    const result = new Map<string, string>();
    for (const [header, top] of topByHeader) {
      if ((countByTarget.get(top.target) ?? 0) <= 1) result.set(header, top.target);
    }
    return result;
  }, [headers, suggestionByHeader]);

  // ⛔ Fix pass (declined-suggestion finding): `autoTargetByHeader` used to be consulted as a
  // fallback on EVERY render, so an operator's explicit "Clear" or "Keep as extra" — both of which
  // just delete `value.columns[header]` — was indistinguishable from a header nobody had touched
  // yet. Clearing snapped the Select back to the suggestion, and "kept as extra" still silently
  // counted toward `claimedTargets`, so the blocking summary could say "safe to continue" on a map
  // the server's `validateColumnMap` would refuse. See `docs/superpowers/sdd/task-7-report.md` §Fix
  // pass for the measured cases.
  //
  // Fix: seed the suggestions into `value.columns` via `onChange` ONCE, below, the first time this
  // file's headers are seen. From that point on `value` is the single source of truth — an absent
  // header genuinely means "not mapped" (never touched, or explicitly cleared: both look the same
  // in the wire shape, and both are correctly "unmapped"). No more read-time fallback here.
  const seededHeadersRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = headers.join('\u0000');
    if (seededHeadersRef.current === signature) return;
    seededHeadersRef.current = signature;
    const extras = new Set(value.extras ?? []);
    const columns = { ...value.columns };
    let changed = false;
    for (const [header, target] of autoTargetByHeader) {
      // A header already in `columns` (operator chose, or a resumed draft) or already sent to
      // `extras` (a resumed draft's own "kept as extra") must not be overwritten by the seed.
      if (!(header in columns) && !extras.has(header)) {
        columns[header] = target;
        changed = true;
      }
    }
    if (changed) onChange({ ...value, columns });
    // Deliberately keyed on the header signature + the (memoized, collision-resolved) suggestion
    // map only. `value`/`onChange` are read for their current-render values but must stay OUT of
    // this array — the ref above, not this array, is what stops the seed from firing more than
    // once per file; including them would refire this on the very re-render our own `onChange`
    // call causes, i.e. an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, autoTargetByHeader]);

  /** What this header currently shows in its `Select`. Post-seed, `value.columns` is authoritative —
   *  see the fix-pass note above. */
  const selectedTarget = (header: string): string => value.columns[header] ?? UNMAPPED;

  /** Every contract field currently satisfied — by a column actually mapped to it, or by a
   *  non-empty constant. A header sitting in `extras` maps to nothing and is correctly invisible
   *  here (it is absent from `value.columns` by construction — see `keepAsExtra`). Read for both
   *  the constants section (a field already claimed by a column has nothing to set a constant for)
   *  and the blocking summary below; mirrors what the server's `validateColumnMap` (Task 1) treats
   *  as satisfied. */
  const claimedTargets = useMemo(() => {
    const claimed = new Set<string>();
    for (const target of Object.values(value.columns)) claimed.add(target);
    for (const [field, raw] of Object.entries(value.constants ?? {})) {
      if (raw.trim() !== '') claimed.add(field);
    }
    return claimed;
  }, [value.columns, value.constants]);

  const missingRequired = REQUIRED_FIELDS.filter((f) => !claimedTargets.has(f));
  const unclaimedFields = CONTRACT_FIELDS.filter((f) => !claimedTargets.has(f));

  useEffect(() => {
    onValidityChange?.(missingRequired.length === 0);
    // missingRequired is a fresh array every render; its length is the only thing that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingRequired.length, onValidityChange]);

  const setColumn = (header: string, target: string): void => {
    const columns = { ...value.columns };
    if (target === UNMAPPED) delete columns[header];
    else columns[header] = target;
    // Choosing a real target (or explicitly clearing back to "Not mapped") is a decision — it
    // supersedes any earlier "keep as extra" for the same header.
    const extras = (value.extras ?? []).filter((h) => h !== header);
    onChange({ ...value, columns, extras });
  };

  const keepAsExtra = (header: string): void => {
    const columns = { ...value.columns };
    delete columns[header];
    const extras = [...new Set([...(value.extras ?? []), header])];
    onChange({ ...value, columns, extras });
  };

  const clearHeader = (header: string): void => {
    const columns = { ...value.columns };
    delete columns[header];
    const extras = (value.extras ?? []).filter((h) => h !== header);
    onChange({ ...value, columns, extras });
  };

  const setConstant = (field: string, raw: string): void => {
    const constants = { ...(value.constants ?? {}) };
    if (raw.trim() === '') delete constants[field];
    else constants[field] = raw;
    onChange({ ...value, constants });
  };

  return (
    <div className="space-y-4 text-sm">
      {rowCount !== undefined && (
        <p className="text-muted-foreground">
          {t('facilities.import.columnMap.rowCountHint', { count: rowCount })}
        </p>
      )}

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
        {headers.map((header) => {
          const top = suggestionByHeader.get(header)?.candidates[0] ?? null;
          const selected = selectedTarget(header);
          // A `likely` match is pre-selected but still needs a human glance — the badge says so.
          // Naturally absent for a colliding header: a collision is never auto-selected, so
          // `selected` there is `Not mapped`, never `top.target`.
          const showBadge = top?.confidence === 'likely' && selected === top.target;
          return (
            <Fragment key={header}>
              <Label className="whitespace-nowrap" title={header}>{header}</Label>
              <div className="flex items-center gap-2">
                <Select value={selected} onValueChange={(v) => setColumn(header, v)}>
                  <SelectTrigger aria-label={header} className="h-9 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMAPPED}>{t('facilities.import.columnMap.notMapped')}</SelectItem>
                    {CONTRACT_FIELDS.map((field) => (
                      <SelectItem key={field} value={field}>{field}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showBadge && (
                  <Badge variant="outline" className="shrink-0">
                    {t('facilities.import.columnMap.checkThisBadge')}
                  </Badge>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={t('facilities.import.columnMap.rowActions', { header })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => keepAsExtra(header)}>
                      {t('facilities.import.columnMap.keepAsExtra')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => clearHeader(header)}>
                      {t('facilities.import.columnMap.clear')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Fragment>
          );
        })}
      </div>

      {unclaimedFields.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="font-medium">{t('facilities.import.columnMap.constantsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('facilities.import.columnMap.constantsHint')}</p>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            {unclaimedFields.map((field) => (
              <Fragment key={field}>
                <Label htmlFor={`column-map-constant-${field}`} className="whitespace-nowrap">{field}</Label>
                <Input
                  id={`column-map-constant-${field}`}
                  value={value.constants?.[field] ?? ''}
                  onChange={(e) => setConstant(field, e.target.value)}
                  placeholder={t('facilities.import.columnMap.constantPlaceholder')}
                />
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {missingRequired.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">{t('facilities.import.columnMap.missingRequiredTitle')}</p>
          {missingRequired.map((field) => (
            <p key={field}>{t('facilities.import.columnMap.missingRequired', { field })}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default ColumnMapStep;
