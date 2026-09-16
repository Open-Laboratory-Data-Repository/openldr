import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TermPicker } from '@/terminology/TermPicker';
import {
  createCatalogTest, setCatalogLabSettings, updateCatalogTest,
  type CatalogLabSettingsInput, type CatalogTestResultParam, type CatalogSpecimenCoding, type CatalogTest, type CatalogTestInput,
  type CatalogResultBand, type TestCatalogOptions,
} from '@/api';
import { sexLabel } from '@/forms-runtime/rangeLabel';

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
  labEnabled: boolean;
  /** null means every catalog specimen. */
  labSpecimens: CatalogSpecimenCoding[] | null;
  localDisplay: string;
}

const EMPTY_BAND: CatalogResultBand = { name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null };
/** Radix Select cannot hold an empty value, so "any sex" is this sentinel in the picker only. */
const ANY_SEX = '__any__';

/** Tick or untick one parameter, keeping the order the operator ticked them in. */
function toggleParam(list: CatalogTestResultParam[], option: { system: string; code: string }, on: boolean): CatalogTestResultParam[] {
  if (!on) return list.filter((p) => p.code !== option.code);
  if (list.some((p) => p.code === option.code)) return list;
  return [...list, { system: option.system, code: option.code, resultType: 'numeric', valueSetUrl: null, bands: [] }];
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

export function TestSheet({ target, options, ownedHere, onClose, onSaved }: {
  target: TestSheetTarget | null;
  options: TestCatalogOptions;
  ownedHere: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  // The test as last saved. A create that went through sets it, so saving again edits instead of
  // adding the test twice.
  const [saved, setSaved] = useState<CatalogTest | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const test = target?.kind === 'edit' ? target.test : null;
    setDraft(draftFrom(test));
    setSaved(test);
  }, [target]);

  const isNew = saved === null;
  // The lab chooses from the catalog list being edited here, or from central's list at a lab.
  const offered = ownedHere ? draft.specimens : saved?.specimenTypes ?? [];
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const specimenName = (s: CatalogSpecimenCoding) => options.specimenTypes.find((o) => sameCoding(o, s))?.display ?? s.code;
  const labTakes = (s: CatalogSpecimenCoding) => draft.labSpecimens === null || draft.labSpecimens.some((k) => sameCoding(k, s));
  const text = (value: string | null | undefined) => <div className="text-sm">{value || t('testCatalog.none')}</div>;

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
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
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

                <Label htmlFor={options.loinc ? undefined : 'test-loinc'} className="whitespace-nowrap">
                  {t('testCatalog.sheet.loinc')}
                </Label>
                {options.loinc ? (
                  <TermPicker
                    systemId={options.loinc.systemId}
                    value={draft.loinc ? { system: options.loinc.system, code: draft.loinc, display: null } : null}
                    onChange={(v) => set({ loinc: v?.code ?? '' })}
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    <Input id="test-loinc" value={draft.loinc} placeholder="12345-6" onChange={(e) => set({ loinc: e.target.value })} />
                    <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.loincTyped')}</span>
                  </div>
                )}

                <Label className="self-start whitespace-nowrap pt-1.5">{t('testCatalog.sheet.specimens')}</Label>
                <div className="flex max-h-48 flex-col overflow-y-auto">
                  {options.specimenTypes.map((s) => (
                    <label
                      key={`${s.system}|${s.code}`}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    >
                      <Checkbox
                        data-testid={`specimen-${s.code}`}
                        checked={draft.specimens.some((k) => sameCoding(k, s))}
                        onCheckedChange={(c) => set({ specimens: toggle(draft.specimens, s, !!c) })}
                      />
                      <span className="flex-1 text-foreground">{s.display ?? s.code}</span>
                    </label>
                  ))}
                </div>

                <Label className="self-start whitespace-nowrap pt-1.5">{t('testCatalog.sheet.resultParams')}</Label>
                <div className="flex flex-col gap-2">
                  {options.resultParams.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.noResultParams')}</span>
                  ) : null}
                  {options.resultParams.map((p) => {
                    const chosen = draft.resultParams.find((r) => r.code === p.code);
                    return (
                      <div key={`${p.system}|${p.code}`} className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]">
                          <Checkbox
                            data-testid={`param-${p.code}`}
                            checked={!!chosen}
                            onCheckedChange={(c) => set({ resultParams: toggleParam(draft.resultParams, p, !!c) })}
                          />
                          <span className="flex-1 text-foreground">{p.display ?? p.code}</span>
                          <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                        </label>
                        {chosen ? (
                          <div className="ml-8 flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
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
                              {chosen.resultType === 'numeric' ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost" size="icon" className="h-8 w-8"
                                      data-testid={`param-menu-${p.code}`}
                                      aria-label={t('testCatalog.sheet.paramActions', { code: p.code })}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      data-testid={`add-band-${p.code}`}
                                      onSelect={() => set({ resultParams: setParam(draft.resultParams, p.code, { ...chosen, bands: [...chosen.bands, EMPTY_BAND] }) })}
                                    >
                                      {t('testCatalog.sheet.addBand')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </div>
                            {chosen.resultType === 'numeric' && chosen.bands.map((band, i) => {
                              const n = i + 1;
                              const writeBands = (bands: CatalogResultBand[]) => set({ resultParams: setParam(draft.resultParams, p.code, { ...chosen, bands }) });
                              const setBand = (patch: Partial<CatalogResultBand>) => writeBands(chosen.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
                              const numberOrNull = (value: string) => {
                                const n = Number(value);
                                return value.trim() === '' || !Number.isFinite(n) ? null : n;
                              };
                              const move = (by: number) => {
                                const next = [...chosen.bands];
                                [next[i], next[i + by]] = [next[i + by], next[i]];
                                writeBands(next);
                              };
                              return (
                                <div key={i} className="flex flex-wrap items-center gap-1.5">
                                  <Input
                                    className="h-8 w-40"
                                    aria-label={t('testCatalog.sheet.bandNameFor', { code: p.code, n })}
                                    placeholder={t('testCatalog.sheet.bandName')}
                                    value={band.name ?? ''}
                                    onChange={(e) => setBand({ name: e.target.value === '' ? null : e.target.value })}
                                  />
                                  {(['low', 'high'] as const).map((edge) => (
                                    <Input
                                      key={edge}
                                      className="h-8 w-20"
                                      aria-label={`${edge} for ${p.code} band ${n}`}
                                      value={band[edge] === null ? '' : String(band[edge])}
                                      onChange={(e) => setBand({ [edge]: numberOrNull(e.target.value) })}
                                    />
                                  ))}
                                  <Input
                                    className="h-8 w-20"
                                    aria-label={`unit for ${p.code} band ${n}`}
                                    placeholder={t('testCatalog.sheet.bandUnit')}
                                    value={band.unit ?? ''}
                                    onChange={(e) => setBand({ unit: e.target.value || null })}
                                  />
                                  <Select value={band.sex ?? ANY_SEX} onValueChange={(v) => setBand({ sex: v === ANY_SEX ? null : v })}>
                                    <SelectTrigger className="h-8 w-32" aria-label={t('testCatalog.sheet.bandSexFor', { code: p.code, n })}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={ANY_SEX}>{t('testCatalog.sheet.bandAnySex')}</SelectItem>
                                      {options.sexes.map((s) => <SelectItem key={s.code} value={s.code}>{sexLabel(s, i18n.language)}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  {(['ageLow', 'ageHigh'] as const).map((edge) => (
                                    <Input
                                      key={edge}
                                      className="h-8 w-20"
                                      aria-label={t(edge === 'ageLow' ? 'testCatalog.sheet.bandAgeFromFor' : 'testCatalog.sheet.bandAgeToFor', { code: p.code, n })}
                                      placeholder={t(edge === 'ageLow' ? 'testCatalog.sheet.bandAgeFrom' : 'testCatalog.sheet.bandAgeTo')}
                                      value={band[edge] === null ? '' : String(band[edge])}
                                      onChange={(e) => setBand({ [edge]: numberOrNull(e.target.value) })}
                                    />
                                  ))}
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
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

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
              </>
            ) : (
              <>
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.name')}</Label>
                {text(saved?.display)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.shortName')}</Label>
                {text(saved?.shortName)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.category')}</Label>
                {text(saved?.category ? options.categories.find((c) => c.code === saved.category)?.display ?? saved.category : null)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.loinc')}</Label>
                {text(saved?.loinc)}
                <Label className="self-start whitespace-nowrap">{t('testCatalog.sheet.specimens')}</Label>
                {text((saved?.specimenTypes ?? []).map(specimenName).join(', '))}
              </>
            )}

            {/* The catalog and lab fields share this one grid, so their labels share one column and
                line up. The title row's borders bleed to the sheet edges (-mx-6 against the px-6). */}
            <div className="col-span-2 -mx-6 border-y border-border px-6 py-3 font-medium text-foreground">
              {t('testCatalog.sheet.thisLab')}
            </div>

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
      </SheetContent>
    </Sheet>
  );
}
