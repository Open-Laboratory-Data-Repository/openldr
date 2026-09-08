import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  suggestValueMappings, writeFacilityValueMappings,
  type ControlledField, type ValueMappingEntry, type ValueSetOption, type ValueSuggestion,
} from '@/api';
import { ValueMapRow, VALUE_MAP_UNMAPPED } from './ValueMapRow';

// CT-3 (whole-branch review): mirrors `@openldr/bootstrap`'s `CONTROLLED_FIELDS` — same "mirrored,
// not shared" idiom `ImportFacilitiesSheet.tsx` already uses (this app has no dependency on that
// package).
const CONTROLLED_FIELDS: ControlledField[] = ['level', 'status', 'country'];

/** Not a real value-set code, and a real one could never collide with it. Task 6: re-exported from
 *  `ValueMapRow` now, so this panel and `ColumnMapStep`'s own embedded worklist agree on the wire
 *  value "nothing chosen" means, without either importing the other. */
const UNMAPPED = VALUE_MAP_UNMAPPED;

type Candidates = ValueSuggestion['candidates'];

/** A field+value pair, as a single Map/Record key. `JSON.stringify` rather than a delimited
 *  template string deliberately — a raw value can contain any character a delimiter might pick,
 *  and `JSON.stringify` escapes its own separators, so two distinct (field, value) pairs can never
 *  collide on one key. */
const rowKey = (field: ControlledField, value: string): string => JSON.stringify([field, value]);

export interface ValueMapPanelProps {
  /** The register this preview ran against — the source system every mapping is written under
   *  (`observedFieldSystem(field, nationalSystem)`, mirrored server-side). */
  nationalSystem: string;
  /** `FacilityImportResult.unmapped` — one entry per controlled field with no canonical mapping,
   *  already computed on every preview. Only fields with at least one value render a section. */
  unmapped: Record<ControlledField, string[]>;
  /** Fires once Save has written (or found nothing to write) — the caller re-runs the preview, since
   *  a just-written mapping only takes effect on a fresh parse. */
  onSaved: () => void;
}

/** The value-mapping panel — one row per unmapped raw value, grouped by controlled field, each with
 *  a ranked `Select` over that field's own bound value set. Fetches its own suggestions (unlike
 *  `ColumnMapStep`, which receives them as a prop) — the brief's own `Produces` line lists no
 *  `suggestions` prop for this panel, and each field's value set is looked up per-field here rather
 *  than by a parent that would otherwise have to know three separate value-set identities.
 *
 *  ⛔ SAVE IS A VISIBLE BUTTON, and that is a deliberate exception to AGENTS.md §5, not a lapse.
 *  It shipped as a 6 by 6 ghost `⋯` icon inside an amber warning box. The operator ran the real
 *  Zambia export, saw twenty-three unmapped values, and asked "how do these get mapped". They
 *  already could. The action was simply invisible. Slice 4 of
 *  `docs/superpowers/specs/2026-09-06-facility-import-workflow-redesign-design.md` authorises this
 *  one button by name.
 *
 *  This is the SECOND bend in that rule on this sheet and it is narrower than the first. Decision 1
 *  of the same spec bends §5 for the action that ADVANCES a step; this is not that, since the step
 *  is advanced by `Upload and validate` in the sheet's pinned footer. Neither bend is the rule
 *  weakening. Every other action in this sheet, and everywhere else in the app, stays in a `⋯`
 *  menu.
 *
 *  ⛔ AN UNMAPPED VALUE NEVER BLOCKS, and this panel must never make it look like it does — existing,
 *  correct behaviour: the raw string is written through exactly as before this panel existed
 *  (`facility-controlled-fields.ts:155`). Nothing here disables Save, and nothing here refuses to
 *  render a value with no suggestion at all — it just shows `Not mapped`, same as a value the
 *  operator has not gotten to yet. */
export function ValueMapPanel({ nationalSystem, unmapped, onSaved }: ValueMapPanelProps): JSX.Element {
  const { t } = useTranslation();

  const fields = useMemo(
    () => CONTROLLED_FIELDS.filter((f) => unmapped[f].length > 0),
    [unmapped],
  );

  const [candidatesByKey, setCandidatesByKey] = useState<Map<string, Candidates>>(new Map());
  /** The field's WHOLE value set, which is what the operator picks from when the ranker offers
   *  nothing. Keyed by field, not by row: every row of a field picks from the same set. */
  const [optionsByField, setOptionsByField] = useState<Map<ControlledField, ValueSetOption[]>>(new Map());
  /** Fields whose value set is not seeded on this install. The route already reported this as
   *  `notValidated`; the panel used to ignore it and render pickers with nothing in them. */
  const [unseededFields, setUnseededFields] = useState<Set<ControlledField>>(new Set());
  /** Fields whose suggestion request FAILED. Distinct from `unseededFields` on purpose: "we could
   *  not ask" and "there is nothing to ask about" look identical on screen otherwise, which is
   *  exactly what made an operator's empty pickers unexplainable. */
  const [failedFields, setFailedFields] = useState<Set<ControlledField>>(new Set());
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Fetch ranked candidates for every field with unmapped values, once per DISTINCT set of values —
  // keyed on a signature string, the same idiom `ColumnMapStep`'s own header-seed effect uses (a
  // string built from the current props), so a re-render with an unchanged `unmapped` never
  // re-fetches and a genuinely new set (a re-preview after Save, or a different file) always does.
  // `fields`/`unmapped` are deliberately NOT in the dependency array for the same reason
  // ColumnMapStep's aren't: both are fresh references every render, and including them would refire
  // this on every render rather than only when the DATA actually changes.
  const signature = JSON.stringify(fields.map((f) => [f, unmapped[f]]));
  // ⛔ NO REF GUARD HERE, and removing it is the fix, not an oversight.
  //
  // This effect used to open with `if (seededRef.current === signature) return;` followed by
  // `seededRef.current = signature`, set BEFORE the await. React 18 StrictMode runs an effect twice
  // on mount in dev: pass one set the ref and started the request, cleanup set `cancelled`, and
  // pass two saw the ref already matching and returned without fetching. The first request then
  // resolved into a cancelled closure, so every setter below was skipped. The panel rendered rows
  // with nothing in their pickers, no error and no explanation, in dev only. An operator hit it on
  // a real import and asked what they were supposed to do with twenty-three unmappable values; the
  // answer was that the panel had never loaded anything at all.
  //
  // `[signature]` is already the correct and sufficient guard. It is a string built from the data,
  // so an unrelated re-render cannot re-fire this, and a genuinely new set always does. The ref was
  // guarding against a re-run the dependency array had already ruled out, and paid for it with a
  // failure mode the dependency array does not have.
  useEffect(() => {
    setUnseededFields(new Set());
    setFailedFields(new Set());
    let cancelled = false;
    const seeded: Record<string, string> = {};
    void Promise.all(fields.map(async (field) => {
      // ⛔ NOT `.catch(() => null)`. That swallow made a failed request indistinguishable from a
      // value set with nothing in it: the panel rendered pickers offering only "Not mapped", with
      // no error anywhere, and an operator reasonably read it as "there are no options".
      const res = await suggestValueMappings(field, unmapped[field]).catch(() => 'failed' as const);
      if (cancelled) return;
      if (res === 'failed') {
        setFailedFields((prev) => new Set(prev).add(field));
        return;
      }
      setOptionsByField((prev) => new Map(prev).set(field, res.options ?? []));
      if (res.notValidated) setUnseededFields((prev) => new Set(prev).add(field));
      setCandidatesByKey((prev) => {
        const next = new Map(prev);
        for (const v of res.values) next.set(rowKey(field, v.value), v.candidates);
        return next;
      });
      // Confidence is shown, never hidden — same rule ColumnMapStep's own docblock states for column
      // suggestions. An exact or likely top candidate pre-selects; a weak or absent one leaves the
      // row `Not mapped` for the operator to decide. Unlike ColumnMapStep, there is no cross-row
      // collision to guard against here: two raw values legitimately mapping to the SAME canonical
      // code is normal ("Health Post" and "HP" both -> health-post), not an error.
      for (const v of res.values) {
        const top = v.candidates[0];
        if (top && top.confidence !== 'weak') seeded[rowKey(field, v.value)] = top.target;
      }
    })).then(() => {
      if (cancelled) return;
      // An operator's own already-made choice (`prev`) always wins over a suggestion arriving late —
      // same "a declined suggestion must stick" discipline ColumnMapStep's fix pass established.
      setChoices((prev) => ({ ...seeded, ...prev }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const setChoice = (field: ControlledField, value: string, toCode: string): void => {
    setChoices((prev) => ({ ...prev, [rowKey(field, value)]: toCode }));
  };

  const mappingsToSave = (): ValueMappingEntry[] => {
    const entries: ValueMappingEntry[] = [];
    for (const field of fields) {
      for (const value of unmapped[field]) {
        const toCode = choices[rowKey(field, value)];
        if (toCode && toCode !== UNMAPPED) entries.push({ field, rawValue: value, toCode });
      }
    }
    return entries;
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const entries = mappingsToSave();
      // ⛔ Saving with nothing chosen still completes — never disabled, never refused. A value the
      // operator has not decided about yet is exactly what this panel exists to let through
      // unblocked; Save simply has nothing to write for it.
      const result = entries.length > 0
        ? await writeFacilityValueMappings(nationalSystem, entries)
        : { written: 0, superseded: [] };
      // ⛔ A TOAST, AND ONLY FOR THE OUTCOME OF THIS CLICK. `loadFailed` and `noValueSet` below
      // stay inline on purpose: they describe a STANDING condition of the pickers on screen, and a
      // message that vanishes on a timer would undo the fix that made those two causes
      // distinguishable in the first place.
      toast.success(t('facilities.import.valueMap.savedCount', { count: result.written }));
      // Mappings only take effect on a fresh parse, so the caller retires the summary on screen.
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (fields.length === 0) return <></>;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{t('facilities.import.unmappedTitle')}</p>
        {/* ⛔ NEVER DISABLED ON "nothing chosen". A value the operator has not decided about yet is
            exactly what this panel exists to let through unblocked, and a greyed-out Save would say
            the opposite. `saving` alone gates it, against a double submit. */}
        <Button
          size="sm" className="shrink-0 text-xs"
          disabled={saving}
          onClick={() => { void handleSave(); }}
        >
          {saving ? t('facilities.import.valueMap.saving') : t('facilities.import.valueMap.saveAction')}
        </Button>
      </div>

      {fields.map((field) => (
        <div key={field} className="space-y-2">
          <p className="font-medium text-foreground">{t(`facilities.filters.${field}Label`)}</p>
          {/* ⛔ TWO DIFFERENT CAUSES, ONE OLD SYMPTOM. Before this, a field whose value set was
              missing and a field whose request failed both rendered pickers containing nothing but
              "Not mapped", with no explanation, and an operator could not tell either from a value
              set that simply had no close match. Each now says which it is. */}
          {failedFields.has(field) && (
            <p className="text-destructive">{t('facilities.import.valueMap.loadFailed')}</p>
          )}
          {!failedFields.has(field) && unseededFields.has(field) && (
            <p className="text-muted-foreground">{t('facilities.import.valueMap.noValueSet')}</p>
          )}
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
            {/* Task 6: the per-value row itself moved to `ValueMapRow`, shared with `ColumnMapStep`'s
                own embedded worklist. Same ranked-head/sorted-tail ordering either way, one copy of
                that logic rather than two that could drift. */}
            {unmapped[field].map((value) => {
              const key = rowKey(field, value);
              const candidates = candidatesByKey.get(key) ?? [];
              const selected = choices[key] ?? UNMAPPED;
              return (
                <ValueMapRow
                  key={value}
                  value={value}
                  candidates={candidates}
                  options={optionsByField.get(field) ?? []}
                  selected={selected}
                  onSelect={(v) => setChoice(field, value, v)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ValueMapPanel;
