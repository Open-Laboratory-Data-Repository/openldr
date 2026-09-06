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
// Exported (fix pass, whole-branch review MUST FIX 3) so `ImportFacilitiesSheet.tsx` can name the
// CURRENT contract-field count in its own `unknown_target` message — the same "read live rather
// than hardcode" discipline `packages/cli/src/facilities.ts`'s `describeColumnMapError` already
// follows for `FACILITY_CONTRACT_FIELDS.length` — instead of a second, driftable literal.
export const CONTRACT_FIELDS: readonly string[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
const CONTRACT_FIELD_SET = new Set<string>(CONTRACT_FIELDS);

/** Not a contract field — a real header could never collide with it. */
const UNMAPPED = '__not_mapped__';

/** The contract field a header claims JUST BY SPELLING IT, with no map entry behind it — the
 *  parser's "passthrough" rule, mirrored here so the panel can stop contradicting it.
 *  `validateColumnMap` (packages/terminology/src/facility-csv.ts) walks the file's OWN headers and
 *  lets any header that lowercases to a contract field claim that field. Only an explicit `extras`
 *  entry releases the claim; "Not mapped" in the wire shape is simply the absence of a `columns`
 *  entry, which is exactly what an untouched passthrough header already looks like.
 *
 *  ⛔ Measured on the real Zambia MFL export (`mfl_facilities_export20260810155748.csv`): its
 *  headers include `Zone` AND `Ownership`, both of which spell contract fields, and the collision
 *  rule below leaves BOTH unmapped because a second header suggests the same field. The panel used
 *  to render them as "Not mapped" — untrue — so `Province → zone` read as safe and the server
 *  refused it with `duplicate_target`, and the fixed-value box offered for `ownership` could only
 *  ever produce `constant_collision`. Returns null for a header the map already decides. */
function passthroughTarget(header: string, map: FacilityColumnMap): string | null {
  if (header in map.columns) return null;
  if ((map.extras ?? []).includes(header)) return null;
  const spelled = header.trim().toLowerCase();
  return CONTRACT_FIELD_SET.has(spelled) ? spelled : null;
}

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
  const selectedTarget = (header: string): string =>
    value.columns[header] ?? passthroughTarget(header, value) ?? UNMAPPED;

  /** Who claims each contract field, and every field claimed twice. Walks the three claim sources in
   *  the SAME ORDER as the server's `validateColumnMap` — mapped columns, then passthrough headers,
   *  then constants — so the first claimant this reports is the one the server's own error message
   *  names as `other`. A field sitting in `extras` claims nothing, by construction: `passthroughTarget`
   *  returns null for it and `keepAsExtra` deletes its `columns` entry. */
  const { claimedTargets, collisions } = useMemo(() => {
    const by = new Map<string, string>();
    const clashes: { field: string; a: string; b: string }[] = [];
    const claim = (field: string, claimant: string): void => {
      const owner = by.get(field);
      if (owner !== undefined) clashes.push({ field, a: owner, b: claimant });
      else by.set(field, claimant);
    };
    for (const [header, target] of Object.entries(value.columns)) claim(target, header);
    for (const header of headers) {
      const target = passthroughTarget(header, value);
      if (target) claim(target, header);
    }
    for (const [field, raw] of Object.entries(value.constants ?? {})) {
      if (raw.trim() !== '') claim(field, field);
    }
    return { claimedTargets: by, collisions: clashes };
    // `value` is read whole by `passthroughTarget`; its three parts are what actually change.
  }, [headers, value.columns, value.constants, value.extras]); // eslint-disable-line react-hooks/exhaustive-deps

  const missingRequired = REQUIRED_FIELDS.filter((f) => !claimedTargets.has(f));
  /** Which fields get a fixed-value box. Unclaimed ones, as before — PLUS any field that already
   *  carries a constant, whether or not something else now claims it.
   *
   *  ⛔ Without that second term the box deleted itself mid-typing: a non-empty constant claims its
   *  field, so the first keystroke dropped the field out of this list and unmounted the very input
   *  being typed into, with the stored value then displayed nowhere at all. A constant that now
   *  collides with a column stays visible here precisely so it can be cleared — the collision box
   *  below names it. */
  const constantFields = CONTRACT_FIELDS.filter(
    (f) => !claimedTargets.has(f) || (value.constants?.[f] ?? '').trim() !== '',
  );

  useEffect(() => {
    onValidityChange?.(missingRequired.length === 0 && collisions.length === 0);
    // Both are fresh arrays every render; their lengths are the only thing that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingRequired.length, collisions.length, onValidityChange]);

  const setColumn = (header: string, target: string): void => {
    // ⛔ "Not mapped" on a header that SPELLS a contract field is not expressible as an absent
    // `columns` entry — that is exactly what an untouched passthrough header already is, and the
    // parser would go on claiming the field. `extras` is the only thing that releases the claim, so
    // that is what this writes, and the row then reads "Not mapped" with the extras badge beside it.
    // The column's values are kept, in the record's `extras` blob (facility-csv.ts's extras loop),
    // never dropped.
    if (target === UNMAPPED && CONTRACT_FIELD_SET.has(header.trim().toLowerCase())) {
      keepAsExtra(header);
      return;
    }
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
          // "Kept as extra" used to leave no trace on screen at all — the Select simply read
          // "Not mapped", identical to a header nobody had touched, even though the two mean very
          // different things to the parser. This badge is that difference, made visible.
          const inExtras = (value.extras ?? []).includes(header);
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
                {/* ⚠ Measured at 375px: this grid's min-content width is 409px against a 289px
                    container BEFORE any badge renders, because every `Label` here is
                    `whitespace-nowrap` and "Catchment population head count" sizes the whole `auto`
                    column at 217px. So the panel already scrolls sideways on a phone. This badge
                    adds 117px to that scroll on the rows that carry it. Making the badge shrinkable
                    does NOT help: `grid-cols-[auto_1fr]`'s 1fr track has a min-content floor, so
                    the track stays wide however the badge is styled. `minmax(0,1fr)` takes it to
                    428px, still over 289px, and deviates from the form-grid class AGENTS.md §5
                    mandates. The real fix is the label column, which belongs to the mobile pass,
                    not here. Kept identical to the `checkThisBadge` above it in the meantime. */}
                {inExtras && (
                  <Badge variant="secondary" className="shrink-0">
                    {t('facilities.import.columnMap.keptAsExtraBadge')}
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

      {constantFields.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="font-medium">{t('facilities.import.columnMap.constantsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('facilities.import.columnMap.constantsHint')}</p>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            {constantFields.map((field) => (
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

      {/* ⛔ The refusal the server would answer with, said here instead — before Continue, in the
          panel that can actually fix it. Two columns on one field, or a fixed value on a field a
          column already claims: `validateColumnMap` reports both, and the panel used to report
          neither, so a map it called safe came back refused. */}
      {collisions.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p className="font-medium">{t('facilities.import.columnMap.collisionTitle')}</p>
          {collisions.map((c) => (
            <p key={`${c.field}-${c.a}-${c.b}`}>
              {t('facilities.import.columnMap.collision', { a: c.a, b: c.b, field: c.field })}
            </p>
          ))}
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
