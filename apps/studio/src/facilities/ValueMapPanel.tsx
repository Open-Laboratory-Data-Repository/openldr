import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  suggestValueMappings, writeFacilityValueMappings,
  type ControlledField, type ValueMappingEntry, type ValueSuggestion,
} from '@/api';

// CT-3 (whole-branch review): mirrors `@openldr/bootstrap`'s `CONTROLLED_FIELDS` — same "mirrored,
// not shared" idiom `ImportFacilitiesSheet.tsx` already uses (this app has no dependency on that
// package).
const CONTROLLED_FIELDS: ControlledField[] = ['level', 'status', 'country'];

/** Not a real value-set code — a real one could never collide with it. */
const UNMAPPED = '__not_mapped__';

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
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch ranked candidates for every field with unmapped values, once per DISTINCT set of values —
  // keyed on a signature string, the same idiom `ColumnMapStep`'s own header-seed effect uses (a
  // string built from the current props), so a re-render with an unchanged `unmapped` never
  // re-fetches and a genuinely new set (a re-preview after Save, or a different file) always does.
  // `fields`/`unmapped` are deliberately NOT in the dependency array for the same reason
  // ColumnMapStep's aren't: both are fresh references every render, and including them would refire
  // this on every render rather than only when the DATA actually changes.
  const signature = JSON.stringify(fields.map((f) => [f, unmapped[f]]));
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededRef.current === signature) return;
    seededRef.current = signature;
    setSavedCount(null);
    setError(null);
    let cancelled = false;
    const seeded: Record<string, string> = {};
    void Promise.all(fields.map(async (field) => {
      const res = await suggestValueMappings(field, unmapped[field]).catch(() => null);
      if (cancelled || !res) return;
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
    setError(null);
    try {
      const entries = mappingsToSave();
      // ⛔ Saving with nothing chosen still completes — never disabled, never refused. A value the
      // operator has not decided about yet is exactly what this panel exists to let through
      // unblocked; Save simply has nothing to write for it.
      const result = entries.length > 0
        ? await writeFacilityValueMappings(nationalSystem, entries)
        : { written: 0, superseded: [] };
      setSavedCount(result.written);
      // Mappings only take effect on a fresh parse — the caller re-runs the preview.
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (fields.length === 0) return <></>;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{t('facilities.import.unmappedTitle')}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-amber-700"
              aria-label={t('facilities.import.valueMap.actions')}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={saving} onSelect={() => { void handleSave(); }}>
              {saving ? t('facilities.import.valueMap.saving') : t('facilities.import.valueMap.saveAction')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {savedCount !== null && (
        <p className="text-emerald-700">{t('facilities.import.valueMap.savedCount', { count: savedCount })}</p>
      )}

      {fields.map((field) => (
        <div key={field} className="space-y-2">
          <p className="font-medium text-foreground">{t(`facilities.filters.${field}Label`)}</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
            {unmapped[field].map((value) => {
              const key = rowKey(field, value);
              const candidates = candidatesByKey.get(key) ?? [];
              const selected = choices[key] ?? UNMAPPED;
              const top = candidates[0] ?? null;
              // Naturally absent when the row is a collision-free exact match, or unmatched — see
              // the seeding effect above.
              const showBadge = top?.confidence === 'likely' && selected === top.target;
              return (
                <Fragment key={value}>
                  <Label className="whitespace-nowrap text-foreground" title={value}>{value}</Label>
                  <div className="flex items-center gap-2">
                    <Select value={selected} onValueChange={(v) => setChoice(field, value, v)}>
                      <SelectTrigger aria-label={value} className="h-8 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNMAPPED}>{t('facilities.import.valueMap.notMapped')}</SelectItem>
                        {candidates.map((c) => (
                          <SelectItem key={c.target} value={c.target}>{c.display ?? c.target}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {showBadge && (
                      <Badge variant="outline" className="shrink-0">
                        {t('facilities.import.columnMap.checkThisBadge')}
                      </Badge>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ValueMapPanel;
