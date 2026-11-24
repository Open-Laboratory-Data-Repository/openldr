import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Divider } from '@/components/ui/bleed';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TermPicker } from '@/terminology/TermPicker';
import { OntologyPickerDialog } from '@/terminology/ontology/OntologyPickerDialog';
import {
  createCatalogTest, getLoincHints, resultFieldsFromLoinc, setCatalogLabSettings, termExists, updateCatalogTest,
  type LoincHints, type Term,
  type CatalogLabSettingsInput, type CatalogTestResultParam, type CatalogSpecimenCoding, type CatalogTest, type CatalogTestInput,
  type CatalogAgeUnit, type CatalogResultBand, type TestCatalogOptions,
} from '@/api';
import { criteriaLabel, sexLabel, type RangeCopy } from '@/forms-runtime/rangeLabel';
import { AddResultFieldSheet } from './AddResultFieldSheet';

// Test catalog S2 (spec 4.3): add or edit one test, and this lab's own settings for it. Copies
// forms-builder/FieldEditorSheet.tsx (AGENTS.md section 5).

export type TestSheetTarget = { kind: 'create' } | { kind: 'edit'; test: CatalogTest };

/** Radix Select cannot hold an empty value, so "no category" is this sentinel in the picker only. */
const NO_CATEGORY = '__none__';

interface Draft {
  code: string;
  display: string;
  shortName: string;
  category: string;
  loinc: string;
  specimens: CatalogSpecimenCoding[];
  /** Bench result entry: the parameters this test yields, in the order the operator ticked them. */
  resultParams: CatalogTestResultParam[];
  active: boolean;
  expectedTatHours: number | null;
  criticalTatHours: number | null;
  requiresVerification: boolean;
  labEnabled: boolean;
  /** null means every catalog specimen. */
  labSpecimens: CatalogSpecimenCoding[] | null;
  localDisplay: string;
}

const EMPTY_BAND: CatalogResultBand = { name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null };
/** Radix Select cannot hold an empty value, so "any sex" is this sentinel in the picker only. */
const ANY_SEX = '__any__';
/** The age units a range can be written in. A range with none is in years. */
const AGE_UNITS: Array<{ code: CatalogAgeUnit; key: string }> = [
  { code: 'd', key: 'testCatalog.sheet.ageUnitDays' },
  { code: 'mo', key: 'testCatalog.sheet.ageUnitMonths' },
  { code: 'y', key: 'testCatalog.sheet.ageUnitYears' },
];

/** Tick or untick one parameter, keeping the order the operator ticked them in. */
function toggleParam(list: CatalogTestResultParam[], option: { system: string; code: string }, on: boolean): CatalogTestResultParam[] {
  if (!on) return list.filter((p) => p.code !== option.code);
  if (list.some((p) => p.code === option.code)) return list;
  return [...list, { system: option.system, code: option.code, resultType: 'numeric', valueSetUrl: null, bands: [] }];
}

type ParamOption = TestCatalogOptions['resultParams'][number];

/** Put these parameters on the test in order. One already ticked is kept as it is, so its type, value
 *  set and ranges are never replaced. */
function addParams(list: CatalogTestResultParam[], params: CatalogTestResultParam[]): CatalogTestResultParam[] {
  const next = [...list];
  for (const p of params) if (!next.some((k) => k.code === p.code)) next.push(p);
  return next;
}

function setParam(list: CatalogTestResultParam[], code: string, next: CatalogTestResultParam): CatalogTestResultParam[] {
  return list.map((p) => (p.code === code ? next : p));
}

function sameCoding(a: CatalogSpecimenCoding, b: CatalogSpecimenCoding): boolean {
  return a.system === b.system && a.code === b.code;
}

function toggle(list: CatalogSpecimenCoding[], item: CatalogSpecimenCoding, on: boolean): CatalogSpecimenCoding[] {
  const without = list.filter((s) => !sameCoding(s, item));
  return on ? [...without, { system: item.system, code: item.code }] : without;
}

/** The second line of a LOINC search result: short name, class and unit, the empty ones left out (spec call 7). */
function loincDetail(term: Term): string | null {
  return [term.shortName, term.class, term.unit].filter((v): v is string => !!v && v.trim() !== '').join(' · ') || null;
}

function draftFrom(test: CatalogTest | null): Draft {
  return {
    code: test?.code ?? '',
    display: test?.display ?? '',
    shortName: test?.shortName ?? '',
    category: test?.category ?? '',
    loinc: test?.loinc ?? '',
    specimens: test?.specimenTypes ?? [],
    resultParams: test?.resultParams ?? [],
    active: test?.active ?? true,
    expectedTatHours: test?.expectedTatHours ?? null,
    criticalTatHours: test?.criticalTatHours ?? null,
    requiresVerification: test?.requiresVerification ?? true,
    labEnabled: test?.lab.enabled ?? false,
    labSpecimens: test?.lab.specimenTypes ?? null,
    localDisplay: test?.lab.localDisplay ?? '',
  };
}

/** This lab's settings from the draft, against the test's saved catalog list. Every catalog specimen
 *  ticked is sent as null, "use the catalog's list", so a specimen central adds later reaches this lab. */
function labInput(d: Draft, offered: CatalogSpecimenCoding[]): CatalogLabSettingsInput {
  const kept = d.labSpecimens === null ? null : offered.filter((s) => d.labSpecimens!.some((k) => sameCoding(k, s)));
  return {
    enabled: d.labEnabled,
    specimenTypes: kept === null || kept.length === offered.length ? null : kept,
    localDisplay: d.localDisplay.trim() || null,
  };
}

function sameLab(a: CatalogLabSettingsInput, b: CatalogTest['lab']): boolean {
  const key = (l: CatalogSpecimenCoding[] | null) => (l === null ? null : l.map((s) => `${s.system}|${s.code}`).sort().join(','));
  return a.enabled === b.enabled && a.localDisplay === b.localDisplay && key(a.specimenTypes) === key(b.specimenTypes);
}

export function TestSheet({ target, options, ownedHere, onClose, onSaved, onOptionsChanged }: {
  target: TestSheetTarget | null;
  options: TestCatalogOptions;
  ownedHere: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** A result field was added to the dictionary from this sheet, so the choices should be read again. */
  onOptionsChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  // The words an unnamed range is shown by, the same the bench sheet uses (FormCapture.tsx).
  const rangeCopy: RangeCopy = {
    language: i18n.language,
    anyone: t('forms.rangeAnyone'),
    ageFrom: t('forms.rangeAgeFrom'), ageTo: t('forms.rangeAgeTo'), ageBetween: t('forms.rangeAgeBetween'),
    ageFromDays: t('forms.rangeAgeFromDays'), ageToDays: t('forms.rangeAgeToDays'), ageBetweenDays: t('forms.rangeAgeBetweenDays'),
    ageFromMonths: t('forms.rangeAgeFromMonths'), ageToMonths: t('forms.rangeAgeToMonths'), ageBetweenMonths: t('forms.rangeAgeBetweenMonths'),
  };
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  // The test as last saved. A create that went through sets it, so saving again edits instead of
  // adding the test twice.
  const [saved, setSaved] = useState<CatalogTest | null>(null);
  const [busy, setBusy] = useState(false);
  // Result fields added from this sheet, shown until the page reads the choices again.
  const [addedParams, setAddedParams] = useState<ParamOption[]>([]);
  const [addingField, setAddingField] = useState(false);
  // The LOINC tree, opened from the LOINC row's menu (spec call 7).
  const [browsing, setBrowsing] = useState(false);
  // The menu item that opens Add field is gone once the menu closes, so focus comes back to the menu's button.
  const paramsMenuButton = useRef<HTMLButtonElement>(null);
  // What LOINC says about the test's code. Null when LOINC or its ontology is not loaded, and then the
  // sheet shows no hint and offers no LOINC action (spec, call 7).
  const [hints, setHints] = useState<LoincHints | null>(null);
  /** The field codes from-loinc answered for a LOINC code. A reused field may have its own code (CHOL for 2093-3). */
  const [loincTaken, setLoincTaken] = useState<{ loinc: string; codes: string[] } | null>(null);
  const hintsAsked = useRef(0);
  // The draft as last drawn, for the steps that run after a request comes back.
  const draftNow = useRef(draft);
  draftNow.current = draft;
  // Units typed in this sheet that UCUM does not hold, so the range can say so. A saved unit is not
  // checked: it opens as it was saved (spec 3, call 3).
  const [notUcum, setNotUcum] = useState<ReadonlySet<string>>(() => new Set());
  const markUcum = (unit: string, isUcum: boolean): void => setNotUcum((prev) => {
    if (prev.has(unit) !== isUcum) return prev;
    const next = new Set(prev);
    if (isUcum) next.delete(unit); else next.add(unit);
    return next;
  });
  // The picker shows UCUM's first 20 matches by code, so a short code such as "g" can miss the list.
  // Look the exact code up before saying it is not UCUM. A failed lookup says nothing.
  const checkUcum = async (unit: string): Promise<void> => {
    if (!options.ucum) return;
    try {
      markUcum(unit, await termExists(options.ucum.system, unit));
    } catch { /* unknown, so no note */ }
  };

  useEffect(() => {
    const test = target?.kind === 'edit' ? target.test : null;
    setDraft(draftFrom(test));
    setSaved(test);
    setAddedParams([]);
  }, [target]);

  // A saved code shows its hints, but fills nothing: only a code picked here fills empty fields. Keyed
  // on the LOINC system id, not the options object, which is read again after a field is added.
  const loincSystemId = options.loinc?.systemId ?? null;
  useEffect(() => {
    void readHints(target?.kind === 'edit' ? target.test.loinc ?? '' : '');
  }, [target, loincSystemId]);

  /** Read the hints for a code. A later call wins, so a slow answer for an old code is dropped. */
  async function readHints(code: string): Promise<LoincHints | null> {
    const asked = ++hintsAsked.current;
    if (!options.loinc || !ownedHere || code === '') { setHints(null); return null; }
    try {
      const found = await getLoincHints(code);
      if (asked !== hintsAsked.current) return null;
      setHints(found);
      return found;
    } catch {
      // No hint is no harm: the sheet works as it did without them.
      if (asked === hintsAsked.current) setHints(null);
      return null;
    }
  }

  /** Make or reuse LOINC's result fields and tick them. One already ticked keeps its type, value set and ranges. */
  async function takeFromLoinc(h: LoincHints, panel: boolean): Promise<void> {
    try {
      const answer = await resultFieldsFromLoinc([h.code], panel);
      setLoincTaken({ loinc: h.code, codes: answer.params.map((p) => p.code) });
      const names = new Map<string, string | null>(panel ? h.panelMembers.map((m) => [m.code, m.display]) : [[h.code, h.display]]);
      const ticked = draftNow.current.resultParams;
      const fresh = answer.params.filter((p) => !ticked.some((k) => k.code === p.code));
      takeParams(
        answer.params.map((p) => ({ system: p.system, code: p.code, display: names.get(p.code) ?? p.code, units: panel ? null : h.unit })),
        answer.params,
      );
      toast.success(fresh.length > 0
        ? t('testCatalog.sheet.loincFieldsAdded', { count: fresh.length })
        : t('testCatalog.sheet.loincFieldsKept'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  /** A LOINC code picked here, from the search or the tree: fill an empty name, short name, category and
   *  specimen from its hints, and leave the rest to the hint lines. */
  async function pickLoinc(code: string): Promise<void> {
    set({ loinc: code });
    const h = await readHints(code);
    if (!h) return;
    const d = draftNow.current;
    const patch: Partial<Draft> = {};
    // Spec call 1: LOINC's long common name and short name, only into empty fields.
    if (d.display.trim() === '' && h.display) patch.display = h.display;
    if (d.shortName.trim() === '' && h.shortName) patch.shortName = h.shortName;
    const category = h.categorySuggestion;
    if (d.category === '' && category && options.categories.some((c) => c.code === category.code)) patch.category = category.code;
    const ticks = h.specimens.filter((s) => s.tick && s.specimenType);
    const only = ticks.length === 1 ? ticks[0].specimenType! : null;
    if (d.specimens.length === 0 && only && options.specimenTypes.some((o) => sameCoding(o, only))) {
      patch.specimens = [{ system: only.system, code: only.code }];
    }
    if (Object.keys(patch).length > 0) set(patch);
    // A pick writes nothing. LOINC's result field is only a hint line until someone chooses Use LOINC's
    // result field or Fill from panel from the Result parameters menu (spec call 6).
  }

  const isNew = saved === null;
  const paramOptions: ParamOption[] = [
    ...options.resultParams,
    ...addedParams.filter((a) => !options.resultParams.some((o) => o.code === a.code)),
  ];
  /** Show these new dictionary fields and tick their parameters, keeping any already ticked as they are. */
  const takeParams = (fields: ParamOption[], params: CatalogTestResultParam[]): void => {
    setAddedParams((prev) => [...prev, ...fields.filter((f) => !prev.some((p) => p.code === f.code))]);
    setDraft((d) => ({ ...d, resultParams: addParams(d.resultParams, params) }));
    onOptionsChanged?.();
  };

  // The hint lines and marks: what LOINC suggests that the draft does not already hold. Nothing when there
  // are no hints, so a sheet without LOINC loaded looks as it did.
  const suggested = hints?.categorySuggestion ?? null;
  const categoryDiffers = !!hints && !!hints.class && draft.category !== suggested?.code;
  // A category the lab has becomes a one-click button (spec call 6). A class with none stays a text line.
  const categoryButton = categoryDiffers && suggested && options.categories.some((c) => c.code === suggested.code) ? suggested : null;
  const categoryHint = !categoryDiffers || categoryButton ? null
    : suggested ? t('testCatalog.sheet.hintCategory', { name: suggested.display ?? suggested.code })
      : t('testCatalog.sheet.hintClass', { class: hints!.class });
  // Each matched specimen type is marked on its own checkbox (spec call 5), so the line keeps only the
  // SNOMED codes no specimen type here matched.
  const suggestedSpecimens = (hints?.specimens ?? []).flatMap((s) => (s.specimenType ? [s.specimenType] : []));
  const unmatched = (hints?.specimens ?? []).filter((s) => !s.specimenType);
  const unmatchedNames = unmatched.flatMap((s) => {
    const name = s.display ?? (s.snomed ? `SNOMED ${s.snomed}` : null);
    return name ? [name] : [];
  });
  const specimenHint = unmatchedNames.length === 0 ? null : t('testCatalog.sheet.hintSpecimens', { names: unmatchedNames.join(', ') });
  const specimenMapHint = unmatched.length > 0;
  const resultHint = !hints ? null
    : hints.panelMembers.length > 0 ? t('testCatalog.sheet.hintPanel', { count: hints.panelMembers.length })
      // Gone once the field is ticked: LOINC's own code, or the field from-loinc answered for it.
      : draft.resultParams.some((p) => p.code === hints.code
        || (loincTaken?.loinc === hints.code && loincTaken.codes.includes(p.code))) ? null
        : t('testCatalog.sheet.hintResult', { name: hints.display ?? hints.code, unit: hints.unit ? ` (${hints.unit})` : '' });
  // The lab chooses from the catalog list being edited here, or from central's list at a lab.
  const offered = ownedHere ? draft.specimens : saved?.specimenTypes ?? [];
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const specimenName = (s: CatalogSpecimenCoding) => options.specimenTypes.find((o) => sameCoding(o, s))?.display ?? s.code;
  const labTakes = (s: CatalogSpecimenCoding) => draft.labSpecimens === null || draft.labSpecimens.some((k) => sameCoding(k, s));
  const text = (value: string | null | undefined) => <div className="text-sm">{value || t('testCatalog.none')}</div>;
  const hours = (value: number | null | undefined) => text(value == null ? null : t('testCatalog.sheet.hours', { count: value }));
  /** A section's title with its edge-to-edge rule above it, and an optional ⋯ menu at its right. The
   *  rule is a direct child of the px-6 grid, so -mx-6 lands on the sheet's edges (AGENTS.md section 5). */
  const section = (title: string, menu: ReactNode = null, first = false) => (
    <>
      {first ? null : <Divider className="col-span-2 -mx-6" />}
      <div className="col-span-2 flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {menu}
      </div>
    </>
  );
  // Reference ranges, one sub-heading per ticked numeric field, in the field list's order.
  const rangeFields = paramOptions.flatMap((p) => {
    const chosen = draft.resultParams.find((r) => r.code === p.code);
    return chosen && chosen.resultType === 'numeric' ? [{ p, chosen }] : [];
  });

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      let test = saved;
      if (ownedHere) {
        const input: CatalogTestInput = {
          display: draft.display,
          shortName: draft.shortName.trim() || null,
          category: draft.category || null,
          specimenTypes: draft.specimens,
          resultParams: draft.resultParams,
          loinc: draft.loinc.trim() || null,
          active: draft.active,
          expectedTatHours: draft.expectedTatHours,
          criticalTatHours: draft.criticalTatHours,
          requiresVerification: draft.requiresVerification,
        };
        test = test
          ? await updateCatalogTest(test.code, input)
          : await createCatalogTest({ ...input, code: draft.code.trim() || null });
        setSaved(test);
      }
      if (!test) return;
      const lab = labInput(draft, test.specimenTypes);
      if (!sameLab(lab, test.lab)) test = await setCatalogLabSettings(test.code, lab);
      toast.success(t('testCatalog.sheet.saved', { code: test.code }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Full width on a phone: the base sheet stops at 90vw. */}
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{isNew ? t('testCatalog.sheet.addTitle') : t('testCatalog.sheet.editTitle')}</SheetTitle>
          <SheetDescription>{t('testCatalog.sheet.description')}</SheetDescription>
        </SheetHeader>

        <section>
          {/* Save and Cancel sit on the first section's title row, as in FieldEditorSheet.tsx, clear of
              the sheet's own close button. */}
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.sheet.catalog')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  data-testid="test-sheet-menu" aria-label={t('testCatalog.sheet.actions')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="test-sheet-save"
                  disabled={busy || (ownedHere && !draft.display.trim())}
                  onSelect={() => void save()}
                >
                  {t('common.save')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="test-sheet-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          {/* Corlix's order, top to bottom (spec section 2): LOINC code, additional codings, basic
              information, specimen types, result parameters, reference ranges. "This lab" stays last.
              The sections share this one grid, so every label sits in one column and lines up. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            {section(t('testCatalog.sheet.sectionLoinc'), null, true)}
            {ownedHere ? (
              <>
                <Label htmlFor={options.loinc ? undefined : 'test-loinc'} className="whitespace-nowrap">
                  {t('testCatalog.sheet.loinc')}
                </Label>
                {options.loinc ? (
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <TermPicker
                        systemId={options.loinc.systemId}
                        value={draft.loinc ? { system: options.loinc.system, code: draft.loinc, display: null } : null}
                        onChange={(v) => { void pickLoinc(v?.code ?? ''); }}
                        detail={loincDetail}
                      />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                          data-testid="loinc-menu" aria-label={t('testCatalog.sheet.loincActions')}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem data-testid="browse-loinc" onSelect={() => setBrowsing(true)}>
                          {t('testCatalog.sheet.browseLoinc')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Input id="test-loinc" value={draft.loinc} placeholder="12345-6" onChange={(e) => set({ loinc: e.target.value })} />
                    <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.loincTyped')}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.loinc')}</Label>
                {text(saved?.loinc)}
              </>
            )}

            {/* Plan B puts Additional codings here, between the LOINC code and Basic information (spec call 11). */}

            {section(t('testCatalog.sheet.sectionBasic'))}
            {ownedHere && isNew ? (
              <>
                <Label htmlFor="test-code" className="whitespace-nowrap">{t('testCatalog.sheet.code')}</Label>
                <div className="flex flex-col gap-1">
                  <Input id="test-code" value={draft.code} onChange={(e) => set({ code: e.target.value })} />
                  <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.codeHint')}</span>
                </div>
              </>
            ) : (
              <>
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.code')}</Label>
                <div className="font-mono text-xs">{saved?.code}</div>
              </>
            )}

            {ownedHere ? (
              <>
                <Label htmlFor="test-name" className="whitespace-nowrap">{t('testCatalog.sheet.name')}</Label>
                <Input id="test-name" value={draft.display} onChange={(e) => set({ display: e.target.value })} />

                <Label htmlFor="test-short-name" className="whitespace-nowrap">{t('testCatalog.sheet.shortName')}</Label>
                <Input id="test-short-name" value={draft.shortName} onChange={(e) => set({ shortName: e.target.value })} />

                <Label htmlFor="test-category" className="whitespace-nowrap">{t('testCatalog.sheet.category')}</Label>
                <div className="flex min-w-0 flex-col gap-1">
                  <Select
                    value={draft.category || NO_CATEGORY}
                    onValueChange={(v) => set({ category: v === NO_CATEGORY ? '' : v })}
                  >
                    <SelectTrigger id="test-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>{t('testCatalog.sheet.noCategory')}</SelectItem>
                      {options.categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {categoryButton ? (
                    // Spec call 6: one click sets LOINC's category, as Corlix's suggested chip does.
                    <Button
                      type="button" variant="ghost" data-testid="hint-category"
                      className="h-auto self-start whitespace-normal break-words p-0 text-left text-xs font-normal text-primary hover:bg-transparent hover:text-primary hover:underline"
                      onClick={() => set({ category: categoryButton.code })}
                    >
                      {t('testCatalog.sheet.categorySuggested', { name: categoryButton.display ?? categoryButton.code })}
                    </Button>
                  ) : null}
                  {categoryHint ? <span data-testid="hint-category" className="break-words text-xs text-muted-foreground">{categoryHint}</span> : null}
                </div>

                <Label htmlFor="test-expected-tat" className="whitespace-nowrap">{t('testCatalog.sheet.expectedTat')}</Label>
                <DecimalInput
                  id="test-expected-tat" inputMode="decimal" className="w-28"
                  value={draft.expectedTatHours}
                  onValueChange={(v) => set({ expectedTatHours: v })}
                />

                <Label htmlFor="test-critical-tat" className="whitespace-nowrap">{t('testCatalog.sheet.criticalTat')}</Label>
                <DecimalInput
                  id="test-critical-tat" inputMode="decimal" className="w-28"
                  value={draft.criticalTatHours}
                  onValueChange={(v) => set({ criticalTatHours: v })}
                />

                <Label className="whitespace-nowrap">{t('testCatalog.sheet.requiresVerification')}</Label>
                <Switch
                  aria-label={t('testCatalog.sheet.requiresVerification')}
                  checked={draft.requiresVerification}
                  onCheckedChange={(v) => set({ requiresVerification: v })}
                />

                {!isNew && (
                  <>
                    {/* The studio Switch takes no id, so it is named by aria-label, as in Connectors.tsx. */}
                    <Label className="whitespace-nowrap">{t('testCatalog.sheet.active')}</Label>
                    <Switch
                      aria-label={t('testCatalog.sheet.active')}
                      checked={draft.active}
                      onCheckedChange={(v) => set({ active: v })}
                    />
                  </>
                )}

                {section(t('testCatalog.sheet.specimens'))}
                <div className="col-span-2 flex min-w-0 flex-col gap-1">
                  <div className="flex max-h-48 flex-col overflow-y-auto">
                    {options.specimenTypes.map((s) => {
                      const on = draft.specimens.some((k) => sameCoding(k, s));
                      return (
                        <label
                          key={`${s.system}|${s.code}`}
                          className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                        >
                          <Checkbox
                            data-testid={`specimen-${s.code}`}
                            checked={on}
                            onCheckedChange={(c) => set({ specimens: toggle(draft.specimens, s, !!c) })}
                          />
                          <span className="min-w-0 break-words text-foreground">{s.display ?? s.code}</span>
                          {/* Spec call 5: a type LOINC matched but nobody ticked, marked as Corlix marks it. */}
                          {!on && suggestedSpecimens.some((m) => sameCoding(m, s)) ? (
                            <Badge variant="secondary" data-testid={`suggested-${s.code}`} className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                              {t('testCatalog.sheet.suggested')}
                            </Badge>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                  {specimenHint ? <span data-testid="hint-specimens" className="break-words px-2 text-xs text-muted-foreground">{specimenHint}</span> : null}
                  {specimenMapHint ? <span data-testid="hint-specimens-map" className="break-words px-2 text-xs text-muted-foreground">{t('testCatalog.sheet.hintSpecimenMap')}</span> : null}
                </div>

                {section(t('testCatalog.sheet.resultParams'), (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        ref={paramsMenuButton}
                        variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                        data-testid="result-params-menu" aria-label={t('testCatalog.sheet.resultParamsActions')}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem data-testid="add-field" onSelect={() => setAddingField(true)}>
                        {t('testCatalog.sheet.addField')}
                      </DropdownMenuItem>
                      {hints && hints.panelMembers.length === 0 ? (
                        <DropdownMenuItem data-testid="use-loinc-field" onSelect={() => void takeFromLoinc(hints, false)}>
                          {t('testCatalog.sheet.useLoincField')}
                        </DropdownMenuItem>
                      ) : null}
                      {hints && hints.panelMembers.length > 0 ? (
                        <DropdownMenuItem data-testid="fill-from-panel" onSelect={() => void takeFromLoinc(hints, true)}>
                          {t('testCatalog.sheet.fillFromPanel')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
                {/* Full width, so a field name and its type keep the room they need on a phone. */}
                <div className="col-span-2 flex min-w-0 flex-col gap-2">
                  {paramOptions.length === 0 || resultHint ? (
                    <div className="flex min-w-0 flex-col gap-1">
                      {paramOptions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.noResultParams')}</span>
                      ) : null}
                      {resultHint ? <span data-testid="hint-result" className="break-words text-xs text-muted-foreground">{resultHint}</span> : null}
                    </div>
                  ) : null}
                  {paramOptions.map((p) => {
                    const chosen = draft.resultParams.find((r) => r.code === p.code);
                    return (
                      <div key={`${p.system}|${p.code}`} className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]">
                          <Checkbox
                            data-testid={`param-${p.code}`}
                            checked={!!chosen}
                            onCheckedChange={(c) => set({ resultParams: toggleParam(draft.resultParams, p, !!c) })}
                          />
                          <span className="min-w-0 flex-1 break-words text-foreground">{p.display ?? p.code}</span>
                          <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                        </label>
                        {chosen ? (
                          // The indent is desktop-only. On a phone it cost the fields 32px they cannot spare.
                          // Plan B adds the field's own ⋯ (Required, Settings, Move) beside its type.
                          <div className="flex items-center gap-2 sm:ml-8">
                            <Select
                              value={chosen.resultType}
                              onValueChange={(v) => set({ resultParams: setParam(draft.resultParams, p.code, {
                                ...chosen, resultType: v as CatalogTestResultParam['resultType'], bands: v === 'numeric' ? chosen.bands : [],
                              }) })}
                            >
                              <SelectTrigger className="h-8 w-36" aria-label={`Result type for ${p.code}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="numeric">{t('testCatalog.sheet.typeNumeric')}</SelectItem>
                                <SelectItem value="coded">{t('testCatalog.sheet.typeCoded')}</SelectItem>
                                <SelectItem value="text">{t('testCatalog.sheet.typeText')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {section(t('testCatalog.sheet.sectionRanges'))}
                {/* On a phone the ranges sit at full width: beside a label, each range field was left about
                    108px and a range name was cut off (measured live at 375px). */}
                <div className="col-span-2 flex min-w-0 flex-col gap-3">
                  {rangeFields.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.noRangeFields')}</span>
                  ) : null}
                  {rangeFields.map(({ p, chosen }) => (
                    <div key={`${p.system}|${p.code}`} className="flex min-w-0 flex-col gap-1.5">
                      <div data-testid={`ranges-${p.code}`} className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <h4 className="break-words font-medium text-foreground">{p.display ?? p.code}</h4>
                          <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                              data-testid={`param-menu-${p.code}`}
                              aria-label={t('testCatalog.sheet.paramActions', { code: p.code })}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              data-testid={`add-band-${p.code}`}
                              // A new range starts with the result field's own unit (parm_units).
                              onSelect={() => set({ resultParams: setParam(draft.resultParams, p.code, { ...chosen, bands: [...chosen.bands, { ...EMPTY_BAND, unit: p.units ?? null }] }) })}
                            >
                              {t('testCatalog.sheet.addBand')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {chosen.bands.map((band, i) => {
                        const n = i + 1;
                        const writeBands = (bands: CatalogResultBand[]) => set({ resultParams: setParam(draft.resultParams, p.code, { ...chosen, bands }) });
                        const setBand = (patch: Partial<CatalogResultBand>) => writeBands(chosen.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
                        const move = (by: number) => {
                          const next = [...chosen.bands];
                          [next[i], next[i + by]] = [next[i + by], next[i]];
                          writeBands(next);
                        };
                        const id = (field: string) => `band-${p.code}-${n}-${field}`;
                        const label = (field: string, key: string) => (
                          <Label htmlFor={id(field)} className="whitespace-nowrap text-xs text-muted-foreground">{t(key)}</Label>
                        );
                        return (
                          // A block with a visible word beside every field, label left and input right as elsewhere
                          // in the studio (AGENTS.md section 5). On a phone the fields stack one per line, so a
                          // filled low or high box never reads as a bare number. From sm up, two pairs per line.
                          <div key={i} data-testid={`band-${p.code}-${n}`} className="rounded-md border border-border p-3 sm:relative sm:pr-11">
                            {/* On a phone the menu takes its own line at the top, so the fields keep the full width.
                                From sm up it sits in the corner, beside the Name line. Measured live at 375px: the
                                reserved corner left the inputs 44px wide. */}
                            <div className="-mt-1.5 mb-1 flex justify-end sm:absolute sm:right-1.5 sm:top-1.5 sm:mt-0 sm:mb-0">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost" size="icon" className="h-8 w-8"
                                    data-testid={`band-menu-${p.code}-${n}`}
                                    aria-label={t('testCatalog.sheet.bandActions', { code: p.code, n })}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem data-testid={`band-up-${p.code}-${n}`} disabled={i === 0} onSelect={() => move(-1)}>
                                    {t('testCatalog.sheet.moveUp')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem data-testid={`band-down-${p.code}-${n}`} disabled={i === chosen.bands.length - 1} onSelect={() => move(1)}>
                                    {t('testCatalog.sheet.moveDown')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    data-testid={`band-remove-${p.code}-${n}`}
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => writeBands(chosen.bands.filter((_, j) => j !== i))}
                                  >
                                    {t('testCatalog.sheet.removeBand')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                              {label('name', 'testCatalog.sheet.bandName')}
                              <Input
                                id={id('name')}
                                className="h-8 sm:col-span-3"
                                aria-label={t('testCatalog.sheet.bandNameFor', { code: p.code, n })}
                                value={band.name ?? ''}
                                // An unnamed range is shown at the bench by who it is for, such as "up to 28 days".
                                placeholder={criteriaLabel(band, options.sexes, rangeCopy)}
                                onChange={(e) => setBand({ name: e.target.value === '' ? null : e.target.value })}
                              />
                              {(['low', 'high'] as const).map((edge) => (
                                <Fragment key={edge}>
                                  {label(edge, edge === 'low' ? 'testCatalog.sheet.bandLow' : 'testCatalog.sheet.bandHigh')}
                                  <DecimalInput
                                    id={id(edge)}
                                    className="h-8"
                                    aria-label={`${edge} for ${p.code} band ${n}`}
                                    value={band[edge]}
                                    onValueChange={(v) => setBand({ [edge]: v })}
                                  />
                                </Fragment>
                              ))}
                              {label('unit', 'testCatalog.sheet.bandUnit')}
                              {options.ucum ? (
                                <div className="flex min-w-0 flex-col gap-1">
                                  <TermPicker
                                    id={id('unit')}
                                    ariaLabel={t('testCatalog.sheet.bandUnitFor', { code: p.code, n })}
                                    systemId={options.ucum.systemId}
                                    // UCUM has one-letter units: g, L, m.
                                    minQueryLength={1}
                                    value={band.unit ? { system: options.ucum.system, code: band.unit, display: null } : null}
                                    onChange={(v) => { if (v) markUcum(v.code, true); setBand({ unit: v?.code ?? null }); }}
                                    typed={{
                                      label: (unit) => t('testCatalog.sheet.unitUseTyped', { unit }),
                                      onUse: (unit) => { setBand({ unit }); void checkUcum(unit); },
                                    }}
                                  />
                                  {band.unit && notUcum.has(band.unit) ? (
                                    <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.notUcumUnit')}</span>
                                  ) : null}
                                </div>
                              ) : (
                                <Input
                                  id={id('unit')}
                                  className="h-8"
                                  aria-label={t('testCatalog.sheet.bandUnitFor', { code: p.code, n })}
                                  value={band.unit ?? ''}
                                  onChange={(e) => setBand({ unit: e.target.value || null })}
                                />
                              )}
                              {label('sex', 'testCatalog.sheet.bandSex')}
                              <Select value={band.sex ?? ANY_SEX} onValueChange={(v) => setBand({ sex: v === ANY_SEX ? null : v })}>
                                <SelectTrigger id={id('sex')} className="h-8" aria-label={t('testCatalog.sheet.bandSexFor', { code: p.code, n })}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={ANY_SEX}>{t('testCatalog.sheet.bandAnySex')}</SelectItem>
                                  {options.sexes.map((s) => <SelectItem key={s.code} value={s.code}>{sexLabel(s, i18n.language)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              {(['ageLow', 'ageHigh'] as const).map((edge) => (
                                <Fragment key={edge}>
                                  {label(edge, edge === 'ageLow' ? 'testCatalog.sheet.bandAgeFrom' : 'testCatalog.sheet.bandAgeTo')}
                                  <DecimalInput
                                    id={id(edge)}
                                    className="h-8"
                                    aria-label={t(edge === 'ageLow' ? 'testCatalog.sheet.bandAgeFromFor' : 'testCatalog.sheet.bandAgeToFor', { code: p.code, n })}
                                    value={band[edge]}
                                    onValueChange={(v) => setBand({ [edge]: v })}
                                  />
                                </Fragment>
                              ))}
                              {label('ageUnit', 'testCatalog.sheet.bandAgeUnit')}
                              <div className="sm:col-span-3">
                                <Select value={band.ageUnit ?? 'y'} onValueChange={(v) => setBand({ ageUnit: v as CatalogAgeUnit })}>
                                  <SelectTrigger id={id('ageUnit')} className="h-8 sm:w-40" aria-label={t('testCatalog.sheet.bandAgeUnitFor', { code: p.code, n })}><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {AGE_UNITS.map((u) => <SelectItem key={u.code} value={u.code}>{t(u.key)}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              {(['criticalLow', 'criticalHigh'] as const).map((edge) => (
                                <Fragment key={edge}>
                                  {label(edge, edge === 'criticalLow' ? 'testCatalog.sheet.bandCriticalLow' : 'testCatalog.sheet.bandCriticalHigh')}
                                  <DecimalInput
                                    id={id(edge)}
                                    className="h-8"
                                    aria-label={t(edge === 'criticalLow' ? 'testCatalog.sheet.bandCriticalLowFor' : 'testCatalog.sheet.bandCriticalHighFor', { code: p.code, n })}
                                    value={band[edge] ?? null}
                                    onValueChange={(v) => setBand({ [edge]: v })}
                                  />
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.name')}</Label>
                {text(saved?.display)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.shortName')}</Label>
                {text(saved?.shortName)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.category')}</Label>
                {text(saved?.category ? options.categories.find((c) => c.code === saved.category)?.display ?? saved.category : null)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.expectedTat')}</Label>
                {hours(saved?.expectedTatHours)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.criticalTat')}</Label>
                {hours(saved?.criticalTatHours)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.requiresVerification')}</Label>
                {text(t((saved?.requiresVerification ?? true) ? 'testCatalog.sheet.yes' : 'testCatalog.sheet.no'))}

                {section(t('testCatalog.sheet.specimens'))}
                <div className="col-span-2 min-w-0 break-words">{text((saved?.specimenTypes ?? []).map(specimenName).join(', '))}</div>
              </>
            )}

            {section(t('testCatalog.sheet.thisLab'))}

            <Label className="whitespace-nowrap">{t('testCatalog.sheet.enabled')}</Label>
            <Switch
              aria-label={t('testCatalog.sheet.enabled')}
              checked={draft.labEnabled}
              onCheckedChange={(v) => set({ labEnabled: v })}
            />

            <Label className="self-start whitespace-nowrap pt-1.5">{t('testCatalog.sheet.labSpecimens')}</Label>
            {offered.length === 0 ? (
              <div className="text-muted-foreground">{t('testCatalog.sheet.noSpecimens')}</div>
            ) : (
              <div className="flex max-h-48 flex-col overflow-y-auto">
                {offered.map((s) => (
                  <label
                    key={`${s.system}|${s.code}`}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                  >
                    <Checkbox
                      data-testid={`lab-specimen-${s.code}`}
                      checked={labTakes(s)}
                      onCheckedChange={(c) => set({ labSpecimens: toggle(draft.labSpecimens ?? offered, s, !!c) })}
                    />
                    <span className="flex-1 text-foreground">{specimenName(s)}</span>
                  </label>
                ))}
              </div>
            )}

            <Label htmlFor="test-local-name" className="whitespace-nowrap">{t('testCatalog.sheet.localName')}</Label>
            <Input id="test-local-name" value={draft.localDisplay} onChange={(e) => set({ localDisplay: e.target.value })} />
          </div>
        </section>
        {/* Inside the content, so Radix stacks these sheets over this one. */}
        {options.loinc && ownedHere ? (
          <OntologyPickerDialog
            open={browsing}
            onOpenChange={setBrowsing}
            codingSystemId={options.loinc.systemId}
            systemName="LOINC"
            ontologyType="loinc"
            mode="picker"
            title={t('testCatalog.sheet.browseLoinc')}
            onPick={(node) => { void pickLoinc(node.code); }}
          />
        ) : null}
        <AddResultFieldSheet
        open={addingField}
        ucum={options.ucum ?? null}
        returnFocusTo={paramsMenuButton}
        onClose={() => setAddingField(false)}
        onAdded={(field, param) => {
          takeParams([{ system: field.system, code: field.code, display: field.display, units: field.units }], [param]);
          toast.success(t('testCatalog.sheet.fieldAdded', { code: field.code }));
        }}
      />
      </SheetContent>
    </Sheet>
  );
}
