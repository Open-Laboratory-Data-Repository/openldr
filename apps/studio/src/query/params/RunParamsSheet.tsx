// apps/studio/src/query/params/RunParamsSheet.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { queryApi } from '../api';
import type { CustomQueryParam } from '../custom-query-types';

// Radix Select cannot hold an empty value, so "any" is a sentinel that clears the parameter.
const ANY = '__any__';

export function RunParamsSheet({ open, params, connectorId, onClose, onRun }: {
  open: boolean; params: CustomQueryParam[]; connectorId: string;
  onClose(): void; onRun(values: Record<string, unknown>): void;
}): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [options, setOptions] = useState<Record<string, unknown[]>>({});

  useEffect(() => {
    if (!open) return;
    for (const p of params) {
      if (p.type === 'select' && p.optionsSql && connectorId && !options[p.id]) {
        queryApi.paramOptions(connectorId, p.optionsSql).then((o) => setOptions((m) => ({ ...m, [p.id]: o })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, params, connectorId]);

  const set = (id: string, v: unknown) => setValues((s) => ({ ...s, [id]: v }));
  const setRange = (id: string, k: 'from' | 'to', v: string) =>
    setValues((s) => ({ ...s, [id]: { ...(s[id] as object ?? {}), [k]: v } }));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('query.runParameters')}</SheetTitle>
        </SheetHeader>
        <div className="flex items-center justify-end px-6 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('query.runActions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onRun(values)}>{t('query.runWithValues')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />
        {/* Labels wrap in a capped column: query labels are often long ("Requesting facility code (blank for all)"). */}
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
          {params.map((p) => (
            <ParamRow key={p.id} p={p} options={options[p.id] ?? []} set={set} setRange={setRange} anyLabel={t('query.anyValue')} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ParamRow({ p, options, set, setRange, anyLabel }: {
  p: CustomQueryParam; options: unknown[]; anyLabel: string;
  set(id: string, v: unknown): void; setRange(id: string, k: 'from' | 'to', v: string): void;
}): JSX.Element {
  const id = `run-param-${p.id}`;
  return (
    <>
      <Label htmlFor={id} className="break-words leading-snug">{p.label}</Label>
      {p.type === 'daterange' && (
        <div className="flex flex-col gap-2">
          <Input id={id} aria-label={`${p.id}-from`} type="date" onChange={(e) => setRange(p.id, 'from', e.target.value)} />
          <Input aria-label={`${p.id}-to`} type="date" onChange={(e) => setRange(p.id, 'to', e.target.value)} />
        </div>
      )}
      {p.type === 'select' && (
        <Select onValueChange={(v) => set(p.id, v === ANY ? '' : v)}>
          <SelectTrigger id={id} aria-label={p.label}>
            <SelectValue placeholder={anyLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{anyLabel}</SelectItem>
            {options.map((o) => <SelectItem key={String(o)} value={String(o)}>{String(o)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {p.type === 'text' && (
        <Input id={id} onChange={(e) => set(p.id, e.target.value)} />
      )}
    </>
  );
}
