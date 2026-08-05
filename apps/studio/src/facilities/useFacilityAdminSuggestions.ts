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
 * Cascading: a level's scope is every OTHER declared admin level's current value (e.g. District
 * is scoped by Zone/Region/Council, whichever are non-blank) — the server already treats a missing
 * scope key as unfiltered (facility-registry-store.ts's `distinctAdminValues`), so passing every
 * other level costs nothing when most are blank and gets tighter as the operator fills more in.
 *
 * `reportAnswers` fires on every keystroke of ANY field (FormRuntime's `onAnswersChange` has no
 * finer granularity) — a scope signature is compared per level before scheduling a fetch, and the
 * fetch itself is debounced, so neither an unrelated field's keystroke nor rapid typing in a
 * parent field spams the endpoint.
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
  const levels = useMemo(() => Object.keys(levelFields) as FacilityAdminLevel[], [levelFields]);

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

  useEffect(() => {
    lastScopeRef.current = {};
    requestIdRef.current = {};
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

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      for (const level of levels) {
        const scope: LevelScope = {};
        for (const other of levels) {
          if (other === level) continue;
          const v = valueOf(other);
          if (v) scope[other] = v;
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
