import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import type { ExpandedCode, MapCodeList } from '@/api';
import { EXCEL_DATE_FORMAT, textKeyOf } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { emptyRule, RULE_KINDS, type RuleDraft, type RuleKind, type SplitTake } from './rows';
import { loadValueSetCodes } from './useMapHelpers';

const P = 'workflows.mapToFhir.rule';

/**
 * The rule kind for one row. Changing it starts that kind's inputs empty. Number or text is offered
 * only on a field that has a text form to keep a non-number in (`textKeyOf`), and never on a fixed
 * value: a typed value has a known type, and the mapping refuses it there (`applyMapping`).
 */
export function RuleKindSelect({
  rule,
  label,
  targetPath,
  fixed = false,
  onChange,
}: {
  rule: RuleDraft;
  label: string;
  targetPath: string;
  fixed?: boolean;
  onChange: (r: RuleDraft) => void;
}) {
  const { t } = useTranslation();
  const kinds = RULE_KINDS.filter((k) => k !== 'numberOrText' || rule.kind === k || (!fixed && textKeyOf(targetPath) !== null));
  return (
    <Select value={rule.kind} onValueChange={(k) => onChange(emptyRule(k as RuleKind))}>
      <SelectTrigger aria-label={`${t('workflows.mapToFhir.sheet.colRule')}: ${label}`} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((k) => (
          <SelectItem key={k} value={k}>
            {t(`${P}.kinds.${k}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type CodeListsState = MapCodeList[] | 'loading' | 'failed';

/** The chosen rule's own inputs, label left and input right. Null for a rule with none. */
export function RuleInputs({
  rule,
  label,
  valueSet,
  fhirCodes = null,
  codeLists,
  onChange,
}: {
  rule: RuleDraft;
  label: string;
  /** The target field's value set URL: the "to" of a values rule picks from its codes. */
  valueSet: string | null;
  /** FHIR's own list for a code field with no value set. When given, To picks from it instead. */
  fhirCodes?: ExpandedCode[] | null;
  codeLists: CodeListsState;
  onChange: (r: RuleDraft) => void;
}) {
  const { t } = useTranslation();
  const grid = 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2';
  const named = (s: string) => `${s}: ${label}`;

  switch (rule.kind) {
    case 'none':
    case 'trim':
      return null;
    case 'date': {
      const excel = rule.format === EXCEL_DATE_FORMAT;
      return (
        <div className={grid}>
          <Label className="whitespace-nowrap">{t(`${P}.dateIs`)}</Label>
          <Select value={excel ? 'excel' : 'written'} onValueChange={(v) => onChange({ ...rule, format: v === 'excel' ? EXCEL_DATE_FORMAT : '' })}>
            <SelectTrigger aria-label={named(t(`${P}.dateIs`))} className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="written">{t(`${P}.dateWritten`)}</SelectItem>
              <SelectItem value="excel">{t(`${P}.dateExcel`)}</SelectItem>
            </SelectContent>
          </Select>
          {excel ? (
            <>
              <span />
              <p className="text-[11px] text-muted-foreground">{t(`${P}.dateExcelHint`)}</p>
            </>
          ) : (
            <>
              <Label className="whitespace-nowrap">{t(`${P}.format`)}</Label>
              <Input aria-label={named(t(`${P}.format`))} value={rule.format} placeholder="dd/MM/yyyy" onChange={(e) => onChange({ ...rule, format: e.target.value })} />
              <span />
              <p className="text-[11px] text-muted-foreground">{t(`${P}.formatHint`)}</p>
            </>
          )}
        </div>
      );
    }
    case 'number':
    case 'numberOrText':
      return (
        <div className={grid}>
          <Label className="whitespace-nowrap">{t(`${P}.decimal`)}</Label>
          <Select value={rule.decimal} onValueChange={(v) => onChange({ ...rule, decimal: v as ',' | '.' })}>
            <SelectTrigger aria-label={named(t(`${P}.decimal`))} className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">{t(`${P}.decimalComma`)}</SelectItem>
              <SelectItem value=".">{t(`${P}.decimalPoint`)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    case 'split':
      return (
        <div className={grid}>
          <Label className="whitespace-nowrap">{t(`${P}.splitBy`)}</Label>
          <Input aria-label={named(t(`${P}.splitBy`))} value={rule.by} onChange={(e) => onChange({ ...rule, by: e.target.value })} />
          <Label className="whitespace-nowrap">{t(`${P}.take`)}</Label>
          <Select value={rule.take} onValueChange={(v) => onChange({ ...rule, take: v as SplitTake })}>
            <SelectTrigger aria-label={named(t(`${P}.take`))} className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first">{t(`${P}.takeFirst`)}</SelectItem>
              <SelectItem value="last">{t(`${P}.takeLast`)}</SelectItem>
              <SelectItem value="part">{t(`${P}.takePart`)}</SelectItem>
            </SelectContent>
          </Select>
          {rule.take === 'part' && (
            <>
              <Label className="whitespace-nowrap">{t(`${P}.part`)}</Label>
              <Input
                aria-label={named(t(`${P}.part`))}
                type="number"
                min={1}
                value={rule.part}
                onChange={(e) => onChange({ ...rule, part: e.target.value })}
              />
            </>
          )}
        </div>
      );
    case 'codeList':
      return (
        <div className={grid}>
          <Label className="whitespace-nowrap">{t(`${P}.codeList`)}</Label>
          {codeLists === 'loading' ? (
            <LoadingState label={t(`${P}.loadingCodeLists`)} className="h-9" />
          ) : codeLists === 'failed' ? (
            <p className="text-xs text-destructive">{t(`${P}.codeListsFailed`)}</p>
          ) : codeLists.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(`${P}.codeListsEmpty`)}</p>
          ) : (
            <Select value={rule.conceptMapUrl || undefined} onValueChange={(v) => onChange({ ...rule, conceptMapUrl: v })}>
              <SelectTrigger aria-label={named(t(`${P}.codeList`))} className="w-full min-w-0">
                <SelectValue placeholder={t(`${P}.codeListPlaceholder`)} />
              </SelectTrigger>
              <SelectContent>
                {codeLists.map((c) => (
                  <SelectItem key={c.url} value={c.url}>
                    {c.local ? t(`${P}.localCodeList`) : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Label className="whitespace-nowrap">{t(`${P}.sourceSystem`)}</Label>
          {(() => {
            // The lab's own list holds rows of every source system, so it needs one, picked from its rows.
            const local = Array.isArray(codeLists) ? codeLists.find((c) => c.local && c.url === rule.conceptMapUrl) : undefined;
            if (!local) {
              return (
                <Input aria-label={named(t(`${P}.sourceSystem`))} value={rule.sourceSystem} onChange={(e) => onChange({ ...rule, sourceSystem: e.target.value })} />
              );
            }
            if (local.sourceSystems.length === 0) return <p className="text-xs text-muted-foreground">{t(`${P}.sourceSystemsEmpty`)}</p>;
            return (
              <Select value={rule.sourceSystem || undefined} onValueChange={(v) => onChange({ ...rule, sourceSystem: v })}>
                <SelectTrigger aria-label={named(t(`${P}.sourceSystem`))} className="w-full min-w-0">
                  <SelectValue placeholder={t(`${P}.sourceSystemPlaceholder`)} />
                </SelectTrigger>
                <SelectContent>
                  {local.sourceSystems.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })()}
          <span />
          <p className="text-[11px] text-muted-foreground">
            {t(Array.isArray(codeLists) && codeLists.some((c) => c.local && c.url === rule.conceptMapUrl) ? `${P}.sourceSystemLocalHint` : `${P}.sourceSystemHint`)}
          </p>
        </div>
      );
    case 'values':
      return <ValuesInputs rule={rule} label={label} valueSet={valueSet} fhirCodes={fhirCodes} onChange={onChange} />;
  }
}

/** The codes of a value set by URL, or null while they load, or [] when there are none. */
function useValueSetCodes(url: string | null): ExpandedCode[] | null {
  const [codes, setCodes] = useState<ExpandedCode[] | null>(url ? null : []);
  useEffect(() => {
    if (!url) {
      setCodes([]);
      return;
    }
    let live = true;
    setCodes(null);
    loadValueSetCodes(url)
      .then((list) => live && setCodes(list ?? []))
      .catch(() => live && setCodes([]));
    return () => {
      live = false;
    };
  }, [url]);
  return codes;
}

/**
 * Rows of "from" and "to". An accepted values suggestion fills "from" with the sample's values, on
 * screen only; a line is saved once its "to" is filled.
 */
function ValuesInputs({
  rule,
  label,
  valueSet,
  fhirCodes,
  onChange,
}: {
  rule: Extract<RuleDraft, { kind: 'values' }>;
  label: string;
  valueSet: string | null;
  fhirCodes: ExpandedCode[] | null;
  onChange: (r: RuleDraft) => void;
}) {
  const { t } = useTranslation();
  const loaded = useValueSetCodes(fhirCodes ? null : valueSet);
  const codes = fhirCodes ?? loaded;
  const setPair = (i: number, patch: Partial<{ from: string; to: string; system: string; suggested: boolean }>) =>
    onChange({ ...rule, pairs: rule.pairs.map((pr, j) => (j === i ? { ...pr, ...patch } : pr)) });
  const add = () => onChange({ ...rule, pairs: [...rule.pairs, { from: '', to: '' }] });
  const remove = (i: number) => {
    const pairs = rule.pairs.filter((_, j) => j !== i);
    onChange({ ...rule, pairs: pairs.length > 0 ? pairs : [{ from: '', to: '' }] });
  };

  if (valueSet && codes === null && !fhirCodes) return <LoadingState label={t(`${P}.loadingCodes`)} className="h-9" />;

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-2">
      {rule.pairs.length === 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{t(`${P}.valuesHint`)}</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`${t(`${P}.valueActions`)}: ${label}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={add}>{t(`${P}.addValue`)}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {rule.pairs.some((pr) => pr.suggested) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid={`map-values-suggested-${label}`}>
          <span className="min-w-0 break-words">{t(`${P}.valuesSuggested`)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs text-violet-500"
            aria-label={`${t('workflows.mapToFhir.sheet.accept')}: ${t(`${P}.to`)}: ${label}`}
            onClick={() => onChange({ ...rule, pairs: rule.pairs.map(({ suggested: _s, ...pr }) => pr) })}
          >
            {t('workflows.mapToFhir.sheet.accept')}
          </Button>
        </div>
      )}
      {rule.pairs.map((pr, i) => (
        <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
          <Label className="whitespace-nowrap">{t(`${P}.from`)}</Label>
          <Input aria-label={`${t(`${P}.from`)} ${i + 1}: ${label}`} value={pr.from} onChange={(e) => setPair(i, { from: e.target.value })} />
          <span className="sm:hidden" />
          <Label className="whitespace-nowrap">{t(`${P}.to`)}</Label>
          {codes && codes.length > 0 ? (
            // Keyed by system and code, since one code can come from two systems. Both are saved.
            <Select
              value={(() => {
                const c = codes.find((x) => x.code === pr.to && (pr.system === undefined || x.system === pr.system));
                return c ? `${c.system}|${c.code}` : undefined;
              })()}
              onValueChange={(v) => {
                const c = codes.find((x) => `${x.system}|${x.code}` === v);
                // The person chose this To, so the line is no longer a suggestion.
                setPair(i, { to: c?.code ?? '', system: c?.system || undefined, suggested: undefined });
              }}
            >
              <SelectTrigger aria-label={`${t(`${P}.to`)} ${i + 1}: ${label}`} className={`w-full min-w-0 ${pr.suggested ? 'text-muted-foreground' : ''}`}>
                <SelectValue placeholder={t(`${P}.toPlaceholder`)} />
              </SelectTrigger>
              <SelectContent>
                {codes.map((c) => (
                  <SelectItem key={`${c.system}|${c.code}`} value={`${c.system}|${c.code}`}>
                    {c.display ? `${c.display} (${c.code})` : c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input aria-label={`${t(`${P}.to`)} ${i + 1}: ${label}`} value={pr.to} onChange={(e) => setPair(i, { to: e.target.value })} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`${t(`${P}.valueActions`)} ${i + 1}: ${label}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={add}>{t(`${P}.addValue`)}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => remove(i)}>{t(`${P}.removeValue`)}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );
}
