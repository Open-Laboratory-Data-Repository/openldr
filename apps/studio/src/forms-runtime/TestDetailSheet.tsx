import { Fragment, useEffect, useMemo, useState } from 'react';
import { catalogSpecimensFor, expandValueSetByUrl, type CatalogResultBand, type CatalogResultParam, type CatalogSexOption } from '@/api';
import type { CodingAnswer, ResultCoding, TestDetail, TypedResult } from '@openldr/forms/pure';
import { DatePicker } from '@/components/ui/date-picker';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { criteriaLabel, RANGE_EN, rangeLabel, type RangeCopy } from './rangeLabel';
import { ENTRY_EN, fieldHint, type EntryCopy } from './entryCopy';

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;

/** "12 to 15 g/dL", "12 or more g/dL", "up to 15 g/dL". Null when no range is picked. */
function bandText(band: CatalogResultBand | null, unitOfParam: string | null): string | null {
  if (!band || (band.low === null && band.high === null)) return null;
  const unit = band.unit ?? unitOfParam ?? '';
  const range = band.low !== null && band.high !== null
    ? `${band.low} to ${band.high}`
    : band.low !== null ? `${band.low} or more` : `up to ${band.high}`;
  return unit ? `${range} ${unit}` : range;
}

// A label beside a control that has a line under it sits at the top, not the middle. Label is
// leading-none (14px) and an input is 36px tall, so 11px puts the label's middle on the input's.
const TOP_LABEL = 'self-start pt-[11px]';

/** The flag beside a numeric input. Never refuses the value: the bench decides, not the band. */
function flagFor(band: CatalogResultBand | null, value: number | null): string | null {
  if (!band || value === null) return null;
  if (band.low !== null && value < band.low) return `below ${band.low}`;
  if (band.high !== null && value > band.high) return `above ${band.high}`;
  return null;
}

// Critical limits and the age unit count too, so a band that differs only in them is a different
// band. An absent limit and a null one both mean "no limit". An absent age unit means years.
// Plan B: an absent pregnancy and "any" are the same, and so are an absent source or scope and none.
// Valid dates and country decide the fit only, never which band this is, as findCatalogBand does.
type BandLike = { name?: string | null } & Omit<CatalogResultBand, 'name' | 'pregnancy'> & { pregnancy?: string };
const sameBand = (a: CatalogResultBand, b: BandLike): boolean =>
  a.name === (b.name ?? null) && a.low === b.low && a.high === b.high && a.unit === b.unit
  && a.sex === b.sex && a.ageLow === b.ageLow && a.ageHigh === b.ageHigh && (a.ageUnit ?? 'y') === (b.ageUnit ?? 'y')
  && (a.criticalLow ?? null) === (b.criticalLow ?? null) && (a.criticalHigh ?? null) === (b.criticalHigh ?? null)
  && (a.pregnancy ?? 'any') === (b.pregnancy ?? 'any')
  && (a.source ?? null) === (b.source ?? null) && (a.scope ?? null) === (b.scope ?? null);

const codingsOf = (value: TypedResult['value'] | undefined): ResultCoding[] => (Array.isArray(value) ? value : []);

export function TestDetailSheet({ test, testCode, params, detail, sexes, copy, onChange, onClose }: {
  test: CodingAnswer;
  /** The Test code to show. The coding's own code is the id the order keys on. */
  testCode?: string;
  params: CatalogResultParam[];
  detail: TestDetail;
  /** The sex choices the server sent, for labelling unnamed ranges. */
  sexes: CatalogSexOption[];
  /** Range and entry words. The runtime has no i18n (TestDetailsField). */
  copy?: RangeCopy & EntryCopy;
  onChange: (detail: TestDetail) => void;
  onClose: () => void;
}): JSX.Element {
  const words = { ...RANGE_EN, ...ENTRY_EN, ...(copy ?? {}) };
  const [specimens, setSpecimens] = useState<ResultCoding[]>([]);
  const [codedOptions, setCodedOptions] = useState<Record<string, ResultCoding[]>>({});

  useEffect(() => {
    let cancelled = false;
    catalogSpecimensFor([{ system: test.system, code: test.code }])
      .then((rows) => { if (!cancelled) setSpecimens(rows); })
      .catch(() => { if (!cancelled) setSpecimens([]); });
    return () => { cancelled = true; };
  }, [test.system, test.code]);

  // A coded parameter names the ValueSet its answers come from, and the server put that url in the
  // parameter. The studio still names no vocabulary of its own.
  const codedUrls = useMemo(
    () => params.filter((p) => (p.resultType === 'coded' || p.resultType === 'multicoded') && p.valueSetUrl).map((p) => [keyOf(p), p.valueSetUrl as string] as const),
    [params],
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all(codedUrls.map(async ([key, url]) => [key, await expandValueSetByUrl(url).catch(() => [])] as const))
      .then((pairs) => { if (!cancelled) setCodedOptions(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [codedUrls]);

  const resultFor = (param: CatalogResultParam): TypedResult | undefined =>
    detail.results.find((r) => keyOf(r.param) === keyOf(param));

  const writeResult = (param: CatalogResultParam, value: TypedResult['value'], band: CatalogResultBand | null): void => {
    const next: TypedResult = {
      param: { system: param.system, code: param.code },
      resultType: param.resultType,
      value,
      ...(param.unit ? { unit: param.unit } : {}),
      ...(band ? { band } : {}),
    };
    const others = detail.results.filter((r) => keyOf(r.param) !== keyOf(param));
    onChange({ ...detail, results: [...others, next] });
  };

  /**
   * The range the bench picked for this parameter, or the one the server matched when nothing has
   * been typed yet. A typed result with no band means the bench picked no range for it, which must
   * stay "no range" even after the params reload and `param.band` starts naming one (a patient
   * change re-matches sex and age) — otherwise the picker and the flag would show a range the saved
   * answer does not hold.
   */
  const pickedIndex = (param: CatalogResultParam, current: TypedResult | undefined): number => {
    const chosen = current ? (current.band ?? null) : param.band;
    return chosen ? param.bands.findIndex((b) => sameBand(b, chosen)) : -1;
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">{testCode ?? test.code}</span>
            <span>{test.display ?? testCode ?? test.code}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-6 pb-6">
          <Label htmlFor="specimen-type">Specimen type</Label>
          <Select
            value={detail.specimen ? keyOf(detail.specimen) : undefined}
            onValueChange={(v) => onChange({ ...detail, specimen: specimens.find((s) => keyOf(s) === v) ?? null })}
          >
            <SelectTrigger id="specimen-type"><SelectValue placeholder="Choose a specimen" /></SelectTrigger>
            <SelectContent>
              {specimens.map((s) => <SelectItem key={keyOf(s)} value={keyOf(s)}>{s.display ?? s.code}</SelectItem>)}
            </SelectContent>
          </Select>

          {params.map((param) => {
            const current = resultFor(param);
            const label = param.display ?? param.code;
            // Optional, and the entry limits. Shown, never refused (plan B, call 5).
            const hint = fieldHint(param, words);
            const hintLine = hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null;
            if (param.resultType === 'numeric') {
              const typed = typeof current?.value === 'number' ? current.value : null;
              const index = pickedIndex(param, current);
              const band = index >= 0 ? param.bands[index] : null;
              const flag = flagFor(band, typed);
              const range = bandText(band, param.unit);
              const misfit = band !== null && param.fits[index] === 'no';
              const hasLine = param.bands.length > 0 || hint !== null;
              return (
                // A fragment, not a nested grid: every label shares the sheet's one label column, so the
                // inputs line up.
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={hasLine ? TOP_LABEL : undefined}>{label}</Label>
                  <div>
                    <div className="flex items-center gap-2">
                      <DecimalInput
                        id={keyOf(param)}
                        inputMode="decimal"
                        className="w-32"
                        value={typed}
                        onValueChange={(next) => writeResult(param, next, band)}
                      />
                      {param.unit ? <span className="text-sm text-muted-foreground">{param.unit}</span> : null}
                      {flag ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700">{flag}</span> : null}
                    </div>
                    {hintLine}
                    {param.bands.length > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Select
                          value={index >= 0 ? String(index) : undefined}
                          onValueChange={(v) => writeResult(param, typed, param.bands[Number(v)] ?? null)}
                        >
                          <SelectTrigger className="h-8 w-48" aria-label={`${words.range} ${label}`}>
                            <SelectValue placeholder={words.chooseRange} />
                          </SelectTrigger>
                          <SelectContent>
                            {param.bands.map((b, i) => <SelectItem key={i} value={String(i)}>{rangeLabel(b, sexes, words)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {/* A span, not a <p>, because the studio has no CSS reset and a <p> keeps a 1em margin. */}
                        {range ? <span className="text-xs text-muted-foreground">{range}</span> : null}
                      </div>
                    ) : null}
                    {misfit && band ? (
                      <div className="mt-1 text-xs text-amber-700">{words.misfit.replace('{label}', criteriaLabel(band, sexes, words))}</div>
                    ) : null}
                  </div>
                </Fragment>
              );
            }
            if (param.resultType === 'coded') {
              const options = codedOptions[keyOf(param)] ?? [];
              const chosen = current?.value && typeof current.value === 'object' && !Array.isArray(current.value) ? keyOf(current.value as ResultCoding) : undefined;
              return (
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={hint ? TOP_LABEL : undefined}>{label}</Label>
                  <div>
                    <Select value={chosen} onValueChange={(v) => writeResult(param, options.find((o) => keyOf(o) === v) ?? null, null)}>
                      <SelectTrigger id={keyOf(param)}><SelectValue placeholder={words.chooseResult} /></SelectTrigger>
                      <SelectContent>
                        {options.map((o) => <SelectItem key={keyOf(o)} value={keyOf(o)}>{o.display ?? o.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {hintLine}
                  </div>
                </Fragment>
              );
            }
            if (param.resultType === 'multicoded') {
              const options = codedOptions[keyOf(param)] ?? [];
              const chosen = codingsOf(current?.value);
              // A saved answer the value set no longer lists still shows, by its own name.
              const known = [...options, ...chosen.filter((c) => !options.some((o) => keyOf(o) === keyOf(c)))];
              return (
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={TOP_LABEL}>{label}</Label>
                  <div className="min-w-0">
                    <MultiSelect
                      id={keyOf(param)}
                      aria-label={label}
                      options={known.map((o) => ({ value: keyOf(o), label: o.display ?? o.code }))}
                      value={chosen.map(keyOf)}
                      onChange={(next) => {
                        const picked = next.flatMap((k) => known.filter((o) => keyOf(o) === k));
                        writeResult(param, picked.length > 0 ? picked : null, null);
                      }}
                      placeholder={words.addAnswer}
                      removeLabel={(name) => words.removeAnswer.replace('{label}', name)}
                    />
                    {hintLine}
                  </div>
                </Fragment>
              );
            }
            if (param.resultType === 'boolean') {
              const value = typeof current?.value === 'boolean' ? current.value : null;
              // A Select, not a switch, so a touched answer can go back to not answered.
              return (
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={hint ? TOP_LABEL : undefined}>{label}</Label>
                  <div>
                    <Select
                      value={value === null ? 'none' : value ? 'yes' : 'no'}
                      onValueChange={(v) => writeResult(param, v === 'yes' ? true : v === 'no' ? false : null, null)}
                    >
                      <SelectTrigger id={keyOf(param)} className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">{words.yes}</SelectItem>
                        <SelectItem value="no">{words.no}</SelectItem>
                        <SelectItem value="none">{words.notAnswered}</SelectItem>
                      </SelectContent>
                    </Select>
                    {hintLine}
                  </div>
                </Fragment>
              );
            }
            if (param.resultType === 'date') {
              return (
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={hint ? TOP_LABEL : undefined}>{label}</Label>
                  <div>
                    {/* No min or max date: the bench shows the limit and does not refuse (plan B, call 5). */}
                    <DatePicker
                      id={keyOf(param)}
                      className="w-48"
                      value={typeof current?.value === 'string' ? current.value : null}
                      onChange={(next) => writeResult(param, next, null)}
                      placeholder={words.chooseDate}
                    />
                    {hintLine}
                  </div>
                </Fragment>
              );
            }
            const textarea = (
              <Textarea
                id={keyOf(param)}
                rows={2}
                value={typeof current?.value === 'string' ? current.value : ''}
                onChange={(e) => writeResult(param, e.target.value === '' ? null : e.target.value, null)}
              />
            );
            return (
              <Fragment key={keyOf(param)}>
                <Label htmlFor={keyOf(param)} className={TOP_LABEL}>{label}</Label>
                {hintLine ? <div>{textarea}{hintLine}</div> : textarea}
              </Fragment>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
