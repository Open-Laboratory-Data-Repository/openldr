import { Fragment, useEffect, useMemo, useState } from 'react';
import { catalogSpecimensFor, expandValueSetByUrl, type CatalogResultParam } from '@/api';
import type { CodingAnswer, ResultCoding, TestDetail, TypedResult } from '@openldr/forms/pure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;

/** "12 to 15 g/dL", "12 or more g/dL", "up to 15 g/dL". Null when no band matched this patient. */
function bandText(param: CatalogResultParam): string | null {
  const band = param.band;
  if (!band || (band.low === null && band.high === null)) return null;
  const unit = band.unit ?? param.unit ?? '';
  const range = band.low !== null && band.high !== null
    ? `${band.low} to ${band.high}`
    : band.low !== null ? `${band.low} or more` : `up to ${band.high}`;
  return unit ? `${range} ${unit}` : range;
}

// A label beside a control that has a line under it sits at the top, not the middle. Label is
// leading-none (14px) and an input is 36px tall, so 11px puts the label's middle on the input's.
const TOP_LABEL = 'self-start pt-[11px]';

/** The flag beside a numeric input. Never refuses the value: the bench decides, not the band. */
function flagFor(param: CatalogResultParam, value: number | null): string | null {
  const band = param.band;
  if (!band || value === null) return null;
  if (band.low !== null && value < band.low) return `below ${band.low}`;
  if (band.high !== null && value > band.high) return `above ${band.high}`;
  return null;
}

export function TestDetailSheet({ test, params, detail, onChange, onClose }: {
  test: CodingAnswer;
  params: CatalogResultParam[];
  detail: TestDetail;
  onChange: (detail: TestDetail) => void;
  onClose: () => void;
}): JSX.Element {
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
    () => params.filter((p) => p.resultType === 'coded' && p.valueSetUrl).map((p) => [keyOf(p), p.valueSetUrl as string] as const),
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

  const writeResult = (param: CatalogResultParam, value: TypedResult['value']): void => {
    const next: TypedResult = {
      param: { system: param.system, code: param.code },
      resultType: param.resultType,
      value,
      ...(param.unit ? { unit: param.unit } : {}),
      ...(param.band ? { band: param.band } : {}),
    };
    const others = detail.results.filter((r) => keyOf(r.param) !== keyOf(param));
    onChange({ ...detail, results: [...others, next] });
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">{test.code}</span>
            <span>{test.display ?? test.code}</span>
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
            const range = bandText(param);
            if (param.resultType === 'numeric') {
              const typed = typeof current?.value === 'number' ? current.value : null;
              const flag = flagFor(param, typed);
              return (
                // A fragment, not a nested grid: every label shares the sheet's one label column, so the
                // inputs line up.
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={range ? TOP_LABEL : undefined}>{label}</Label>
                  <div>
                    <div className="flex items-center gap-2">
                      <Input
                        id={keyOf(param)}
                        inputMode="decimal"
                        className="w-32"
                        value={typed === null ? '' : String(typed)}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === '' ? null : Number(raw);
                          writeResult(param, next !== null && Number.isFinite(next) ? next : null);
                        }}
                      />
                      {param.unit ? <span className="text-sm text-muted-foreground">{param.unit}</span> : null}
                      {flag ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700">{flag}</span> : null}
                    </div>
                    {/* A div: the studio has no CSS reset, and a <p> keeps a 1em bottom margin. */}
                    {range ? <div className="mt-1 text-xs text-muted-foreground">{range}</div> : null}
                  </div>
                </Fragment>
              );
            }
            if (param.resultType === 'coded') {
              const options = codedOptions[keyOf(param)] ?? [];
              const chosen = current?.value && typeof current.value === 'object' ? keyOf(current.value as ResultCoding) : undefined;
              return (
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)}>{label}</Label>
                  <Select value={chosen} onValueChange={(v) => writeResult(param, options.find((o) => keyOf(o) === v) ?? null)}>
                    <SelectTrigger id={keyOf(param)}><SelectValue placeholder="Choose a result" /></SelectTrigger>
                    <SelectContent>
                      {options.map((o) => <SelectItem key={keyOf(o)} value={keyOf(o)}>{o.display ?? o.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Fragment>
              );
            }
            return (
              <Fragment key={keyOf(param)}>
                <Label htmlFor={keyOf(param)} className={TOP_LABEL}>{label}</Label>
                <Textarea
                  id={keyOf(param)}
                  rows={2}
                  value={typeof current?.value === 'string' ? current.value : ''}
                  onChange={(e) => writeResult(param, e.target.value === '' ? null : e.target.value)}
                />
              </Fragment>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
