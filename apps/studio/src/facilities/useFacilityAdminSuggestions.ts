import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listFacilityAdminValues, type FacilityAdminLevel } from '@/api';
import { FACILITY_ADMIN_LEVELS } from '@openldr/db/facility-answers';
import type { FieldSuggestions, FormSchema, RuntimeAnswers } from '@/forms-runtime/types';

// Mirrors ReferencePicker's own debounce window (apps/studio/src/forms-runtime/ReferencePicker.tsx)
// so every fetch-backed input in the form runtime feels consistent to an operator typing.
const DEBOUNCE_MS = 200;

type LevelFieldMap = Partial<Record<FacilityAdminLevel, string>>;
type LevelScope = Partial<Record<FacilityAdminLevel, string>>;

/**
 * Which of this schema's `suggest` fields carry one of the four admin-area columns, keyed by
 * level. Country is bound to a ValueSet (Task 4) rather than rendered as a `suggest` field, so it
 * can never appear here even if a future schema mislabels a field `apiProperty: 'country'` — the
 * `FACILITY_ADMIN_LEVELS` whitelist excludes it by construction (see facility-answers.ts).
 */
function adminLevelFields(schema: FormSchema | null): LevelFieldMap {
  const map: LevelFieldMap = {};
  if (!schema) return map;
  const levels = new Set<string>(FACILITY_ADMIN_LEVELS);
  for (const field of schema.fields) {
    if (field.fieldType !== 'suggest') continue;
    if (field.apiProperty && levels.has(field.apiProperty)) {
      map[field.apiProperty as FacilityAdminLevel] = field.id;
    }
  }
  return map;
}

/**
 * Drives the `suggest` fields' options for the four cascading facility admin-area columns
 * (zone/region/district/council) from the facility registry's own previously-seen values
 * (`GET /api/facilities/admin-values`, Task 3's `listFacilityAdminValues`). `FormRuntime` never
 * fetches suggestions itself (see its `fieldSuggestions` doc comment) — this hook is the caller
 * that owns the fetch, and `reportAnswers` (wired to `FormRuntime`'s `onAnswersChange`) is how it
 * learns what the operator has typed into the OTHER admin fields so it can scope each fetch.
 *
 * Cascading: a level's scope is every level ABOVE it in the fixed hierarchy
 * `zone < region < district < council` (`FACILITY_ADMIN_LEVELS`' own declaration order — one
 * source of truth for the order, not a second hand-typed list here). Region is scoped by Zone
 * alone; District by Zone+Region; Council by Zone+Region+District; Zone by nothing. A child is
 * NEVER used to scope its own parent — the server's scope filter is exact equality
 * (`facility-registry-store.ts`'s `distinctAdminValues` does `q.where(col, '=', v)`, not a range
 * or prefix match), so a symmetric "every OTHER level" scope (an earlier version of this hook)
 * made the district/council values already sitting in the form constrain Region right back down to
 * the single value it already held — every dropdown on a fully-populated edit offered exactly one
 * option, and a novel value typed into one field (typical for `suggest`, which exists precisely to
 * accept values the registry has never seen) blanked every sibling's listbox instead of only
 * narrowing levels below it.
 *
 * `reportAnswers` fires on every keystroke of ANY field (FormRuntime's `onAnswersChange` has no
 * finer granularity) — a fetch is only (re)scheduled when the admin-level-relevant SLICE of
 * `answers` actually changed since the last call (see `lastRelevantRef` below), so typing in an
 * unrelated field (e.g. Name) never reschedules — let alone starves — a pending admin-level fetch.
 * A scope signature is ALSO compared per level before issuing that level's request, and the fetch
 * itself is debounced, so rapid typing in a parent field still collapses to one fetch per level.
 *
 * `resetKey` should be the SAME value passed as `FormRuntime`'s own `key` prop (`FacilityDialog`
 * builds it as `${schema.id}-${facility?.id ?? 'new'}`) — that remounts FormRuntime fresh on a
 * schema/facility swap, but this hook lives one level up in FacilityDialog and outlives that
 * remount, so it needs its own signal to drop stale scope bookkeeping and in-flight requests
 * rather than carrying facility A's suggestions into facility B's dialog.
 */
export function useFacilityAdminSuggestions(
  schema: FormSchema | null,
  resetKey: string,
): { suggestions: FieldSuggestions; reportAnswers: (answers: RuntimeAnswers) => void } {
  const [suggestions, setSuggestions] = useState<FieldSuggestions>({});
  const levelFields = useMemo(() => adminLevelFields(schema), [schema]);
  // Ordered by the fixed hierarchy (zone < region < district < council), NOT by whatever order the
  // schema happens to declare its fields in — the scoping loop below relies on index order to know
  // which levels are "above" a given one.
  const levels = useMemo(
    () => FACILITY_ADMIN_LEVELS.filter((level) => levelFields[level] !== undefined),
    [levelFields],
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Per-level bookkeeping. `requestIdRef` is the stale-response guard (ReferencePicker's own
  // pattern): each fetch for a level captures its own id, and a resolved/rejected promise only
  // applies its result if it is still the MOST RECENT id issued for that level.
  const lastScopeRef = useRef<Partial<Record<FacilityAdminLevel, string>>>({});
  const requestIdRef = useRef<Partial<Record<FacilityAdminLevel, number>>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // The admin-level-relevant slice of the last `answers` a fetch was scheduled for (JSON of each
  // level's value, in hierarchy order) — NOT the same thing as `lastScopeRef`, which is per-level
  // and only updated once a fetch actually fires. This one gates whether `reportAnswers` reschedules
  // the shared debounce timer AT ALL: without it, a keystroke in an unrelated field (e.g. Name) —
  // which fires `reportAnswers` just the same, FormRuntime's `onAnswersChange` has no finer
  // granularity — kept rearming the SAME 200ms timer, so a typing burst in Name starved every
  // pending admin-level fetch for as long as the operator kept typing.
  const lastRelevantRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    lastScopeRef.current = {};
    requestIdRef.current = {};
    lastRelevantRef.current = undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSuggestions({});
    // Deliberately keyed on resetKey alone — a facility/schema swap, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const fetchLevel = useCallback((level: FacilityAdminLevel, fieldId: string, scope: LevelScope) => {
    const myRequestId = (requestIdRef.current[level] ?? 0) + 1;
    requestIdRef.current[level] = myRequestId;
    setSuggestions((prev) => ({
      ...prev,
      [fieldId]: { status: 'loading', options: prev[fieldId]?.options ?? [] },
    }));
    listFacilityAdminValues(level, scope)
      .then((rows) => {
        if (!mountedRef.current || requestIdRef.current[level] !== myRequestId) return;
        setSuggestions((prev) => ({
          ...prev,
          [fieldId]: { status: 'ready', options: rows.map((r) => r.value) },
        }));
      })
      .catch((e: unknown) => {
        if (!mountedRef.current || requestIdRef.current[level] !== myRequestId) return;
        // Roll back the recorded scope for this level so a future `reportAnswers` cycle that
        // computes the SAME scope signature (e.g. the operator changes nothing else, or changes
        // and then reverts) does not treat this failed attempt as "already fetched" and skip
        // retrying — without this, a level that failed once stayed in status:'error' for the rest
        // of the dialog's life unless some OTHER admin field's value changed first.
        delete lastScopeRef.current[level];
        setSuggestions((prev) => ({
          ...prev,
          [fieldId]: { status: 'error', options: [], error: e instanceof Error ? e.message : String(e) },
        }));
      });
  }, []);

  const reportAnswers = useCallback((answers: RuntimeAnswers) => {
    if (levels.length === 0) return;

    const valueOf = (level: FacilityAdminLevel): string => {
      const fieldId = levelFields[level];
      if (!fieldId) return '';
      const v = answers[fieldId];
      return v == null ? '' : String(v);
    };

    // Only (re)schedule the debounce when a value an admin level actually depends on — one of the
    // four level fields themselves — has changed since the last call. `reportAnswers` fires on
    // EVERY keystroke of ANY field in the form (Name included), so without this guard, typing in an
    // unrelated field kept clearing and restarting the same 200ms timer and no admin-level fetch
    // ever got a clear 200ms window to fire.
    const relevantSignature = JSON.stringify(levels.map(valueOf));
    if (relevantSignature === lastRelevantRef.current) return;
    lastRelevantRef.current = relevantSignature;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // `levels` is in fixed hierarchy order (zone < region < district < council) — index `i`'s
      // scope is built ONLY from indices `< i` (the levels ABOVE it), never from indices after it.
      // A child must never constrain its own parent: Region is scoped by Zone alone, District by
      // Zone+Region, Council by Zone+Region+District, and Zone by nothing at all.
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i]!;
        const scope: LevelScope = {};
        for (let j = 0; j < i; j++) {
          const above = levels[j]!;
          const v = valueOf(above);
          if (v) scope[above] = v;
        }
        const signature = JSON.stringify(scope);
        if (lastScopeRef.current[level] === signature) continue;
        lastScopeRef.current[level] = signature;
        fetchLevel(level, levelFields[level]!, scope);
      }
    }, DEBOUNCE_MS);
  }, [levels, levelFields, fetchLevel]);

  return { suggestions, reportAnswers };
}
