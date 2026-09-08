import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  readFacilityImportColumnValues, suggestValueMappings, writeFacilityValueMappings,
  type ColumnSuggestion, type ControlledField, type FacilityColumnMap,
  type ValueMappingEntry, type ValueSetOption, type ValueSuggestion,
} from '@/api';
import { ConstantValueField } from './ConstantValueField';
import { mappingRowState } from './mappingRowState';
import { MappingRowStatus } from './MappingRowStatus';
import { ValueMapRow, VALUE_MAP_UNMAPPED } from './ValueMapRow';

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

/** The three fields bound to a value set. Mirrors `@openldr/bootstrap`'s `CONTROLLED_FIELDS`, the
 *  same "mirrored, not shared" idiom `ValueMapPanel.tsx:19` and this file's own `CONTRACT_FIELDS`
 *  already use, because this app has no dependency on that package. */
const CONTROLLED_CONSTANT_FIELDS = new Set<string>(['level', 'status', 'country']);

/** Task 6: the same three fields, as an array. This file already has the Set above for a
 *  membership test; the worklist effect below needs to iterate them instead. */
const CONTROLLED_FIELDS_LIST: ControlledField[] = ['level', 'status', 'country'];

/** Not a contract field — a real header could never collide with it. */
const UNMAPPED = '__not_mapped__';

/** Task 6: a (header, value) pair as one Map/Record key, same reasoning as `ValueMapPanel`'s own
 *  `rowKey`: `JSON.stringify` escapes its own separators, so two distinct pairs can never collide. */
const valueChoiceKey = (header: string, value: string): string => JSON.stringify([header, value]);

/** Final review, C1: a (field, raw value) pair as one Set key. Keyed on the FIELD, not the header,
 *  because that is what a written mapping is keyed on: `writeFacilityValueMappings` sends
 *  `{ field, rawValue, toCode }` and the server writes it under the register's own namespace for
 *  that field. Two headers pointing at the same field therefore share a resolution, which is the
 *  truth on the server. Same `JSON.stringify` collision argument as `valueChoiceKey` above. */
const resolvedValueKey = (field: string, value: string): string => JSON.stringify([field, value]);

/** One row of a header's value worklist: a raw value plus the ranker's own candidates for it. */
type WorklistEntry = { value: string; candidates: ValueSuggestion['candidates'] };

/** Fix pass (Critical finding, mapping-answers-back Slice B Task 6 review): a row's worklist is the
 *  UNION of everything any source has ever reported for the row's current target, never a
 *  replacement. `checkRow`'s own click and the `unmappedByField` effect both call this, so neither
 *  can make the other's finding disappear.
 *
 *  ⛔ THIS IS MEMBERSHIP, NOT STATUS, and the two must never share a number again. Membership is
 *  sticky on purpose, so a choice the operator already made is never dropped out from under them.
 *  The row's own red/green is `unresolvedCount` below, which subtracts what has actually been
 *  written. Reading the length of this union as the row's status is exactly the defect the final
 *  review's C1 names: it never shrinks, so the row could never go back to green.
 *
 *  Two different things used to decide whether a value needed mapping. The server's `unmappedByField`
 *  (packages/bootstrap/src/facility-controlled-fields.ts) asks: does an exact or normalised match, or
 *  an active mapping, resolve this value? `checkRow` asked a different question: is the ranker's own
 *  guess confident? A value can fail the server's test and still score high on the ranker's fuzzy
 *  match, and `checkRow` used to let that confident guess evict a value the server had already named
 *  unmapped, silently dropping it, and any choice the operator had already made for it, on the next
 *  click of "check". The ranker's confidence still decides what is ranked first in the pick-list; it
 *  no longer decides whether a value is in the list at all. */
function mergeWorklistEntries(existing: WorklistEntry[], fresh: WorklistEntry[]): WorklistEntry[] {
  const byValue = new Map<string, WorklistEntry>();
  for (const entry of existing) byValue.set(entry.value, entry);
  for (const entry of fresh) byValue.set(entry.value, entry);
  return Array.from(byValue.values());
}

/** One shape, holding one header's last check. Final review, C1: it deliberately carries NO
 *  `unrecognised` count any more. It used to, set to the length of the union above, and because a
 *  union never shrinks the count never shrank either: one unrecognised value made the row red for
 *  the life of the sheet, and the spec's Valid state was unreachable for any controlled column that
 *  ever reported one. Two different things were sharing one number. Membership in `values` is
 *  sticky, so a choice the operator already made is never dropped; the count is derived instead, by
 *  `unresolvedCount` below, from what is still genuinely unresolved. */
interface RowCheck {
  target: string;
  truncated: boolean;
  distinct: number;
  values?: WorklistEntry[];
  options?: ValueSetOption[];
}

/** How many of a row's values still need an answer. This is the row's status, and it is not the
 *  same question as "what is in the pick-list".
 *
 *  A value counts as resolved once its mapping has actually been WRITTEN, which the client knows
 *  because it is the thing that wrote it (`handleSaveValueMappings` below records every entry the
 *  save call accepted). A pick that has not been saved yet is still a value with no mapping behind
 *  it, so it still counts.
 *
 *  ⚠ Final review, I1, NOT FIXED HERE: a mapping written during an EARLIER import of the same
 *  register is invisible to this. The ranker (`packages/bootstrap/src/facility-mapping-suggest.ts`)
 *  is pure string similarity and never reads `term_mappings`, and no route today answers "which of
 *  these raw values does this register already resolve". Closing that needs a server change. */
function unresolvedCount(check: RowCheck, resolved: ReadonlySet<string>): number {
  // Thousands of distinct values on a controlled field: the count IS the finding, and no worklist
  // was ever collected for it, so there is nothing to subtract.
  if (check.truncated) return check.distinct;
  return (check.values ?? []).filter((e) => !resolved.has(resolvedValueKey(check.target, e.value))).length;
}

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
  /** Task 5: the stored run's id, so a row's status icon can read that column back and check it.
   *  `null` before an upload: there is nothing stored yet, so nothing can be read. A click still
   *  does something in that case: it tells the operator to upload first, rather than doing nothing. */
  runId: string | null;
  /** ⛔ THE SECOND ARGUMENT IS LOAD-BEARING. `'seed'` is this panel's one-time opening offer,
   *  written when the asynchronous suggestion call resolves; `'edit'` is the operator deciding
   *  something. They look identical in `next` and they are not the same event.
   *
   *  MEASURED: the host discards its Review whenever the map changes, and without this distinction
   *  a suggestion that resolved AFTER a check silently destroyed the summary the operator had just
   *  earned. Alone the fetch won the race and it looked fine; under load 25 tests in
   *  `ImportFacilitiesSheet.test.tsx` failed, each burning the 15s async timeout. A caller that
   *  ignores the argument behaves exactly as before. */
  onChange: (next: FacilityColumnMap, origin: 'seed' | 'edit') => void;
  /** Fires whenever whether every required field is satisfied changes — so the host (Task 8's
   *  `ImportFacilitiesSheet`) can gate its own Continue action without re-deriving the same
   *  required-field rule a second time. */
  onValidityChange?: (valid: boolean) => void;
  /** Task 6: what `ValueMapPanel` used to read straight off the last FULL check, one entry per
   *  controlled field with at least one raw value that has no canonical mapping. This panel folds
   *  those in under the row currently claiming each field, alongside anything its OWN per-row check
   *  already found, so the operator has one worklist instead of two. `undefined`/absent is "no full
   *  check has reported anything yet", same as `ValueMapPanel` rendering nothing for an empty
   *  `unmapped`. */
  unmappedByField?: Record<ControlledField, string[]>;
  /** The register any value mapping here is written under. Required whenever `unmappedByField`
   *  (or a row's own check) actually has something to save; unused otherwise. Mirrors
   *  `ValueMapPanel`'s own `nationalSystem` prop exactly. */
  nationalSystem?: string;
  /** Fires once Save has written the chosen value mappings (or found nothing to write). Same
   *  contract as `ValueMapPanel`'s own `onSaved`: a just-written mapping only takes effect on a
   *  fresh parse, so the caller retires the summary on screen. */
  onValueMappingsSaved?: () => void;
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
  headers, suggestions, value, runId, onChange, onValidityChange,
  unmappedByField, nationalSystem, onValueMappingsSaved,
}: ColumnMapStepProps): JSX.Element {
  const { t } = useTranslation();

  // Task 5: the per-field check. One entry per header that has ever been checked, holding what
  // the check found AND the target it ran against. `stale` below is the comparison of that
  // stored target against the row's CURRENT target, not a boolean flag anyone sets by hand.
  //
  // Task 6: `values`/`options` are the ranked worklist itself, only present for a controlled
  // target that has at least one value worth a pick-list. Two things populate them: this row's OWN
  // click (`checkRow` below, which fills `values` with exactly the subset it already counted as
  // `unrecognised`) and the host's `unmappedByField` prop, read by the effect further down (which
  // fills `values` with EVERY value it was handed, and those are already known unmapped by a full
  // check, not merely "the ranker was not confident"). Either way the render loop reads the same
  // two fields, so it does not need to know which origin populated them.
  const [checkedByHeader, setCheckedByHeader] = useState<Record<string, RowCheck>>({});
  /** Final review, C1: every (field, raw value) this sheet has actually written a mapping for.
   *  This is what lets a red row go back to green, and it is deliberately separate from the
   *  worklist: the worklist is what the operator can still edit, this is what no longer counts
   *  against them. Only a save that the server accepted adds to it. */
  const [resolvedValues, setResolvedValues] = useState<ReadonlySet<string>>(new Set());
  /** Task 6: the operator's own value-mapping choices, keyed by `valueChoiceKey(header, value)`.
   *  This is the same shape `ValueMapPanel`'s own `choices` state uses, keyed by (field, value) there because it
   *  has one row per field; this panel has one row per header instead. An explicit choice always
   *  wins; anything absent falls back to the top ranked candidate (if confident) via
   *  `defaultValueChoice` below, computed at render/save time rather than seeded into state. There
   *  is nothing here that a `StrictMode` double-fetch could race, since it never runs twice. */
  const [valueChoices, setValueChoices] = useState<Record<string, string>>({});
  const [savingValueMappings, setSavingValueMappings] = useState(false);
  const [busyHeaders, setBusyHeaders] = useState<Set<string>>(new Set());
  // Two ephemeral, per-header notices that are NOT part of `checkedByHeader`: neither one is a
  // real check result, so neither should make `mappingRowState` call the row valid or invalid.
  // ⛔ FIX PASS (review Finding 3): each used to be one global value, so a click on row A that
  // set it and a click on row B that cleared it (or set its own) could clobber A's transient
  // notice. Per-header `Set`s, the same shape `busyHeaders` above already uses, so two rows'
  // notices cannot step on one another.
  const [blockedHeaders, setBlockedHeaders] = useState<Set<string>>(new Set());
  const [erroredHeaders, setErroredHeaders] = useState<Set<string>>(new Set());

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
    if (changed) onChange({ ...value, columns }, 'seed');
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
    onChange({ ...value, columns, extras }, 'edit');
  };

  const keepAsExtra = (header: string): void => {
    const columns = { ...value.columns };
    delete columns[header];
    const extras = [...new Set([...(value.extras ?? []), header])];
    onChange({ ...value, columns, extras }, 'edit');
  };

  const clearHeader = (header: string): void => {
    const columns = { ...value.columns };
    delete columns[header];
    const extras = (value.extras ?? []).filter((h) => h !== header);
    onChange({ ...value, columns, extras }, 'edit');
  };

  const setConstant = (field: string, raw: string): void => {
    const constants = { ...(value.constants ?? {}) };
    if (raw.trim() === '') delete constants[field];
    else constants[field] = raw;
    onChange({ ...value, constants }, 'edit');
  };

  /** Task 5: check ONE header's current target against that column's own values, never the
   *  whole register. Reads the column back through Task 2's route, then, only for a controlled
   *  target, ranks those values through the same engine the value-mapping panel already uses. A
   *  target with no bound vocabulary has nothing to rank, so it records zero unrecognised values
   *  rather than staying stuck unchecked forever. */
  const checkRow = async (header: string): Promise<void> => {
    const target = selectedTarget(header);
    if (!runId) {
      // Nothing stored to read yet. The icon stays in whatever state it already carries
      // (`checked` is untouched); this is what the click reports instead.
      setBlockedHeaders((prev) => new Set(prev).add(header));
      return;
    }
    setBlockedHeaders((prev) => {
      if (!prev.has(header)) return prev;
      const next = new Set(prev);
      next.delete(header);
      return next;
    });
    setErroredHeaders((prev) => {
      if (!prev.has(header)) return prev;
      const next = new Set(prev);
      next.delete(header);
      return next;
    });
    setBusyHeaders((prev) => new Set(prev).add(header));
    try {
      const { values, distinct, truncated } = await readFacilityImportColumnValues(runId, header);
      if (!CONTROLLED_CONSTANT_FIELDS.has(target)) {
        // ⛔ FIX PASS (review Finding 1, CRITICAL): a non-controlled target has no bound
        // vocabulary, so it has no basis to call thousands of distinct values a wrong-field
        // sign. `name` and `national_code` are the two REQUIRED fields of every import, and
        // thousands of distinct values in them is the CORRECT case, not a finding. This must be
        // checked before `truncated` below, which is a controlled-field-only signal.
        setCheckedByHeader((prev) => ({ ...prev, [header]: { target, truncated: false, distinct } }));
        return;
      }
      if (truncated) {
        // Thousands of distinct values on a CONTROLLED field almost always means the wrong
        // field: `level`/`status`/`country` each draw on a small, bound vocabulary, so a column
        // this large cannot really belong to one. Report the count, never the sample: listing
        // 200 of 3,788 values would look like the whole picture.
        setCheckedByHeader((prev) => ({ ...prev, [header]: { target, truncated: true, distinct } }));
        return;
      }
      const ranked = await suggestValueMappings(target as ControlledField, values);
      // Fix pass (Critical finding): the ranker's confidence still decides which of THESE values
      // look unrecognised from this row's own click. It never decides whether a value the server
      // already reported unmapped (`unmappedByField`) stays on the worklist. That is added
      // unconditionally below, via `mergeWorklistEntries`.
      const rankedByValue = new Map(ranked.values.map((v) => [v.value, v.candidates]));
      const fresh: WorklistEntry[] = [];
      const seen = new Set<string>();
      for (const v of ranked.values) {
        const topCandidate = v.candidates[0];
        if (!topCandidate || topCandidate.confidence === 'weak') {
          fresh.push({ value: v.value, candidates: v.candidates });
          seen.add(v.value);
        }
      }
      for (const raw of unmappedByField?.[target as ControlledField] ?? []) {
        if (seen.has(raw)) continue;
        seen.add(raw);
        fresh.push({ value: raw, candidates: rankedByValue.get(raw) ?? [] });
      }
      setCheckedByHeader((prev) => {
        // A choice the operator already made lives on a value already sitting in `check.values`.
        // Carry every value this row showed for the SAME target forward, so a re-check can only add
        // to the worklist, never quietly drop something out from under a pending choice.
        const prevEntry = prev[header];
        const carried = prevEntry && prevEntry.target === target ? prevEntry.values ?? [] : [];
        const merged = mergeWorklistEntries(carried, fresh);
        return {
          ...prev,
          [header]: { target, truncated: false, distinct, values: merged, options: ranked.options ?? [] },
        };
      });
    } catch {
      setErroredHeaders((prev) => new Set(prev).add(header));
    } finally {
      setBusyHeaders((prev) => {
        const next = new Set(prev);
        next.delete(header);
        return next;
      });
    }
  };

  // Task 6: the OTHER way a header's worklist gets populated: the host's own full check already
  // knows a field has unmapped values (`unmappedByField`, what `ValueMapPanel` used to read
  // directly) before this row has ever been clicked. Finds the header CURRENTLY claiming each such
  // field via `claimedTargets` (computed above, in the server's own claim order) and fetches the
  // same ranking `checkRow` would, so the row renders one worklist regardless of which of the two
  // ways found it.
  //
  // ⛔ SIGNATURE-GUARDED, same idiom as `ValueMapPanel`'s own fetch effect and this file's own
  // header-seed effect: a string built from the data itself, so an unrelated re-render cannot
  // re-fire this and a genuinely new set always does. `checkedByHeader` is read inside but
  // deliberately NOT a dependency, because including it would re-run this the moment it sets state below.
  const unmappedByFieldSignature = JSON.stringify(
    CONTROLLED_FIELDS_LIST.map((f) => [f, unmappedByField?.[f] ?? []]),
  );
  useEffect(() => {
    if (!unmappedByField) return;
    let cancelled = false;
    for (const field of CONTROLLED_FIELDS_LIST) {
      const values = unmappedByField[field] ?? [];
      if (values.length === 0) continue;
      const header = claimedTargets.get(field);
      // No header claims it (a fixed value satisfies the field instead, which cannot have "unmapped
      // raw values", since a constant is picked FROM the value set to begin with), or the header is not
      // even in THIS file: nothing to attach the worklist to.
      if (!header || !headers.includes(header)) continue;
      const existing = checkedByHeader[header];
      // Fix pass (Critical finding): skip the fetch only when this row already carries EVERY value
      // the server just reported for this exact target: there is nothing new to merge in. A row
      // missing even one of them (a fresh validate found something new, or nothing has run yet)
      // still fetches. This used to skip whenever a click had run at all, which meant a value the
      // full check found LATER than a click never reached the row.
      const alreadyCovered = !!existing && existing.target === field
        && values.every((v) => existing.values?.some((ev) => ev.value === v));
      if (alreadyCovered) continue;
      void suggestValueMappings(field, values).then((res) => {
        if (cancelled) return;
        const fresh: WorklistEntry[] = values.map((v) => ({
          value: v, candidates: res.values.find((r) => r.value === v)?.candidates ?? [],
        }));
        setCheckedByHeader((prev) => {
          // Same union rule as `checkRow`: never drop a value (or the choice attached to it) that
          // this row already carried for the same target.
          const prevEntry = prev[header];
          const carried = prevEntry && prevEntry.target === field ? prevEntry.values ?? [] : [];
          const merged = mergeWorklistEntries(carried, fresh);
          return {
            ...prev,
            [header]: {
              target: field, truncated: false, distinct: merged.length,
              values: merged, options: res.options ?? [],
            },
          };
        });
      }).catch(() => {
        // Nothing to show is better than a stuck spinner for a row nobody clicked. The values are
        // still visible on Review's own `ReconciliationSummary`, which reads `unmappedByField`
        // straight, not through this effect.
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unmappedByFieldSignature, claimedTargets, headers]);

  /** The choice for one (header, value) row: the operator's own pick if they made one, otherwise
   *  the same "confident top candidate, else Not mapped" default `ValueMapPanel` seeds into state.
   *  Computed here instead, since nothing about it needs to survive a `StrictMode` double-render. */
  const valueChoiceFor = (header: string, entryValue: string, candidates: ValueSuggestion['candidates']): string => {
    const chosen = valueChoices[valueChoiceKey(header, entryValue)];
    if (chosen) return chosen;
    const top = candidates[0];
    return top && top.confidence !== 'weak' ? top.target : VALUE_MAP_UNMAPPED;
  };

  const setValueChoice = (header: string, entryValue: string, toCode: string): void => {
    setValueChoices((prev) => ({ ...prev, [valueChoiceKey(header, entryValue)]: toCode }));
  };

  /** Is there anything on screen worth a Save click? Only a header whose worklist matches its
   *  CURRENT target. A stale one is not shown (see the render loop below) and must not be saved
   *  either, since it describes a field the header no longer maps to. */
  const hasValueWorklist = Object.entries(checkedByHeader).some(
    ([header, check]) => check.target === selectedTarget(header) && (check.values?.length ?? 0) > 0,
  );

  /** Task 6: the panel's own Save, for every worklist currently on screen at once. Same single
   *  `writeFacilityValueMappings` call and the same toast `ValueMapPanel` already used, just
   *  gathering entries from `checkedByHeader` (one worklist per header) instead of from `unmapped`
   *  (one list per field). An unmapped value never blocks: nothing here disables Save, and Save
   *  with nothing chosen still completes, writing nothing, exactly as `ValueMapPanel` always did. */
  const handleSaveValueMappings = async (): Promise<void> => {
    setSavingValueMappings(true);
    try {
      const entries: ValueMappingEntry[] = [];
      for (const [header, check] of Object.entries(checkedByHeader)) {
        if (check.target !== selectedTarget(header) || !check.values) continue;
        for (const { value: entryValue, candidates } of check.values) {
          const toCode = valueChoiceFor(header, entryValue, candidates);
          if (toCode && toCode !== VALUE_MAP_UNMAPPED) {
            entries.push({ field: check.target as ControlledField, rawValue: entryValue, toCode });
          }
        }
      }
      const result = entries.length > 0
        ? await writeFacilityValueMappings(nationalSystem ?? '', entries)
        : { written: 0, superseded: [] };
      // Final review, C1: this is the moment a value stops being unresolved, and this call is the
      // only thing that knows it. Recorded AFTER the write returns, never before: a save that threw
      // wrote nothing, and marking a value resolved on an optimistic guess would turn a row green
      // over a mapping the register does not carry. A value left at "Not mapped" is not in
      // `entries`, so it is not recorded and goes on counting.
      if (entries.length > 0) {
        setResolvedValues((prev) => {
          const next = new Set(prev);
          for (const entry of entries) next.add(resolvedValueKey(entry.field, entry.rawValue));
          return next;
        });
      }
      toast.success(t('facilities.import.valueMap.savedCount', { count: result.written }));
      onValueMappingsSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingValueMappings(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-[minmax(0,auto)_1fr] sm:items-center sm:gap-x-4 sm:gap-y-3">
        {headers.map((header) => {
          const top = suggestionByHeader.get(header)?.candidates[0] ?? null;
          const selected = selectedTarget(header);
          // A `likely` match is pre-selected but still needs a human glance — the badge says so.
          // Naturally absent for a colliding header: a collision is never auto-selected, so
          // `selected` there is `Not mapped`, never `top.target`.
          const showBadge = top?.confidence === 'likely' && selected === top.target;

          // Task 5: this row's status icon. `confidence` only speaks for the CURRENT target, so
          // an operator who picked something the ranker did not suggest gets `null`, not a
          // borrowed answer for a different field.
          const confidenceForSelected = top && top.target === selected ? top.confidence : null;
          const collidesHere = collisions.some((c) => c.a === header || c.b === header);
          const check = checkedByHeader[header];
          const stale = !!check && check.target !== selected;
          // Final review, C1: derived, never stored. See `unresolvedCount`'s own docblock.
          const unrecognised = check ? unresolvedCount(check, resolvedValues) : 0;
          const rowState = mappingRowState({
            collides: collidesHere,
            confidence: confidenceForSelected,
            checked: check ? { unrecognised } : null,
            stale,
          });
          // What the tooltip/aria-label names as the cause of an invalid row. Collision outranks
          // a check result for the same reason `mappingRowState` itself ranks it first.
          const detail = collidesHere
            ? t('facilities.import.columnMap.rowStatusCollides')
            : check?.truncated
              ? t('facilities.import.columnMap.rowStatusTooManyValues', { count: check.distinct })
              : unrecognised > 0
                ? t('facilities.import.columnMap.rowStatusUnrecognised', { count: unrecognised })
                : null;
          // The row's own visible line, under the controls, distinct from `detail` above, which
          // only ever surfaces on hover/focus via the tooltip. Collision is left out here: the
          // collision block below the whole table already names both claimants, and repeating it
          // per row would say the same thing twice for no added information.
          const rowNotice = blockedHeaders.has(header)
            ? { text: t('facilities.import.columnMap.rowCheckBlockedNoRun'), destructive: false }
            : erroredHeaders.has(header)
              ? { text: t('facilities.import.columnMap.rowCheckFailed'), destructive: true }
              : check?.truncated
                ? { text: t('facilities.import.columnMap.rowStatusTooManyValues', { count: check.distinct }), destructive: true }
                : !stale && unrecognised > 0
                  ? { text: t('facilities.import.columnMap.rowStatusUnrecognised', { count: unrecognised }), destructive: true }
                  : null;

          // Task 6: the worklist this row shows, if any. Never a stale one: a header just
          // re-targeted describes a DIFFERENT field's values now, and rendering them here would
          // let the operator map "Health Centre" onto whatever `check.target` used to be.
          const worklist = check && !stale ? check.values ?? [] : [];

          return (
            // ⛔ `className="contents"`, NOT a real box. The two-column grid above is shared across
            // EVERY header so the `auto` label track sizes to the single widest label once, not per
            // row (`ImportFacilitiesSheet`'s own AGENTS.md-cited note on "Catchment population head
            // count"). A real wrapper div would become its own grid item and break that. `display:
            // contents` keeps this element out of the box tree while leaving its children (the
            // label, the controls, and the worklist below) as direct grid children, so `data-
            // mapping-row` is still reachable via `closest()` (a DOM-tree query, unaffected by CSS)
            // without disturbing the layout at all.
            <div key={header} data-mapping-row={header} className="contents">
              {/* ⛔ NOT `whitespace-nowrap`. Every label shares one `auto` grid column, so the
                  longest header sized the whole column: "Catchment population head count" alone
                  pushed this grid to 409px inside a 289px container at 375, and the panel scrolled
                  sideways at desktop width too. Letting the text wrap lets `auto` shrink to the room
                  it actually has. `title` still carries the full header for a hover. */}
              <Label className="break-words" title={header}>{header}</Label>
              {/* `min-w-0` on BOTH: a grid item and a flex child each default to a min-width of
                  auto, so without it neither can shrink below its content and the row pins the
                  column open. The trigger already truncates its own label ([&>span]:truncate in
                  select.tsx); this is what lets that truncation actually engage. Wrapped in a
                  column so Task 5's own notice line can sit under the controls without touching
                  the two-track grid the row itself lives in. */}
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Select value={selected} onValueChange={(v) => setColumn(header, v)}>
                    <SelectTrigger aria-label={header} className="h-9 min-w-0 flex-1">
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
                  <MappingRowStatus
                    state={rowState}
                    label={header}
                    busy={busyHeaders.has(header)}
                    detail={detail}
                    onCheck={() => { void checkRow(header); }}
                  />
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
                {rowNotice && (
                  <p className={rowNotice.destructive ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                    {rowNotice.text}
                  </p>
                )}
              </div>
              {/* Task 6: the worklist itself, under the row it belongs to rather than in a separate
                  box the operator has to go and find. `sm:col-span-2` spans both grid tracks on the
                  next row. At the mobile breakpoint the grid is already a single column, so this is
                  a no-op there and the block simply stacks like everything else. Reuses
                  `ValueMapRow` (Task 6): ranked candidates first in score order, then the rest of the
                  value set sorted, `Not mapped` always first. The same ordering `ValueMapPanel`
                  still uses for Review's own copy of these values, from the same component. */}
              {worklist.length > 0 && (
                <div className="min-w-0 sm:col-span-2">
                  <div className="grid grid-cols-[minmax(0,auto)_1fr] items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-muted/30 p-2">
                    {worklist.map(({ value: entryValue, candidates }) => (
                      <ValueMapRow
                        key={entryValue}
                        value={entryValue}
                        candidates={candidates}
                        options={check?.options ?? []}
                        selected={valueChoiceFor(header, entryValue, candidates)}
                        onSelect={(code) => setValueChoice(header, entryValue, code)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasValueWorklist && (
        <div className="flex justify-end">
          <Button
            size="sm" className="text-xs"
            disabled={savingValueMappings}
            onClick={() => { void handleSaveValueMappings(); }}
          >
            {savingValueMappings
              ? t('facilities.import.valueMap.saving')
              : t('facilities.import.valueMap.saveAction')}
          </Button>
        </div>
      )}

      {constantFields.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="font-medium">{t('facilities.import.columnMap.constantsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('facilities.import.columnMap.constantsHint')}</p>
          </div>
          <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-[minmax(0,auto)_1fr] sm:items-center sm:gap-x-4 sm:gap-y-3">
            {constantFields.map((field) => (
              <Fragment key={field}>
                <Label htmlFor={`column-map-constant-${field}`} className="break-words">{field}</Label>
                {CONTROLLED_CONSTANT_FIELDS.has(field) ? (
                  // A controlled field's fixed value is picked from its own value set. Typing one
                  // blind could never work: `level` has 66 seeded concepts and the match is exact
                  // against a code or a display, so `Health Centre` misses `health-center` and
                  // `Health Center` both, and the operator only found out at Review.
                  //
                  // This is also where the `country` placeholder went. It read "e.g. ZMB", which
                  // taught one code out of 249 and nothing about the other 248, and `country` no
                  // longer renders an `Input` to carry it.
                  <ConstantValueField
                    id={`column-map-constant-${field}`}
                    field={field as ControlledField}
                    value={value.constants?.[field] ?? ''}
                    onChange={(next) => setConstant(field, next)}
                  />
                ) : (
                  <Input
                    id={`column-map-constant-${field}`}
                    value={value.constants?.[field] ?? ''}
                    onChange={(e) => setConstant(field, e.target.value)}
                    placeholder={t('facilities.import.columnMap.constantPlaceholder')}
                  />
                )}
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
