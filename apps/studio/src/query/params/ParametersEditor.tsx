// apps/studio/src/query/params/ParametersEditor.tsx
// Query-specific parameters editor, operating on CustomQueryParam[]. A Sheet with its actions in
// ⋯ menus (AGENTS.md section 5), copied from dashboard/filters/DashboardFilterEditor.tsx.
// Field labels use the shared queryParams.* i18n strings.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CustomQueryParam } from '../custom-query-types';

const TYPES: CustomQueryParam['type'][] = ['text', 'select', 'daterange'];
function newId(): string { return `p_${crypto.randomUUID().slice(0, 6)}`; }

export function ParametersEditor({ open, parameters, onClose, onSave }: {
  open: boolean;
  parameters: CustomQueryParam[];
  onClose: () => void;
  onSave: (p: CustomQueryParam[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [list, setList] = useState<CustomQueryParam[]>(parameters);
  useEffect(() => { if (open) setList(parameters); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const update = (i: number, patch: Partial<CustomQueryParam>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; setList(next);
  };
  const add = () => setList([...list, { id: newId(), label: 'New Parameter', type: 'text', required: false }]);

  const ids = list.map((p) => p.id.trim());
  const invalid = ids.some((id) => id === '') || new Set(ids).size !== ids.length;
  const save = () => { if (!invalid) { onSave(list); onClose(); } };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[440px] max-w-[90vw] gap-0 p-0 sm:w-[440px]">
        <SheetHeader className="border-b border-border px-6 py-4">
          {/* pr-8 keeps the actions button clear of the sheet's own close X. */}
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle className="text-base font-semibold">{t('query.parameters')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('queryParams.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={add}>{t('common.add')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={invalid} onSelect={save}>{t('common.save')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription className={invalid ? 'text-xs text-destructive' : 'sr-only'}>
            {invalid ? t('queryParams.invalid') : t('query.parameters')}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {list.length === 0 && <p className="text-sm text-muted-foreground">{t('queryParams.empty')}</p>}
          {list.map((p, i) => (
            <div key={i} className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{`{{ param.${p.id} }}`}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('queryParams.rowActions', { id: p.id })}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, -1)}>{t('queryParams.moveUp')}</DropdownMenuItem>
                    <DropdownMenuItem disabled={i === list.length - 1} onSelect={() => move(i, 1)}>{t('queryParams.moveDown')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setList(list.filter((_, j) => j !== i))}>
                      {t('queryParams.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="border-t border-border" />
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-3 py-3">
                <Label className="text-xs text-muted-foreground">{t('queryParams.variableId')}</Label>
                <Input aria-label={`param-${i}-id`} className="h-8 text-xs" value={p.id}
                  onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
                <Label className="text-xs text-muted-foreground">{t('queryParams.label')}</Label>
                <Input aria-label={`param-${i}-label`} className="h-8 text-xs" value={p.label}
                  onChange={(e) => update(i, { label: e.target.value })} />
                <Label className="text-xs text-muted-foreground">{t('queryParams.type')}</Label>
                <Select value={p.type} onValueChange={(v) => update(i, { type: v as CustomQueryParam['type'], optionsSql: undefined })}>
                  <SelectTrigger aria-label={`param-${i}-type`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((ty) => <SelectItem key={ty} value={ty}>{ty}</SelectItem>)}
                  </SelectContent>
                </Select>
                {p.type === 'select' && (
                  <>
                    <Label className="text-xs text-muted-foreground">{t('queryParams.optionsSql')}</Label>
                    <Input aria-label={`param-${i}-options-sql`} className="h-8 font-mono text-xs"
                      placeholder={t('queryParams.optionsSqlPlaceholder')}
                      value={p.optionsSql ?? ''} onChange={(e) => update(i, { optionsSql: e.target.value || undefined })} />
                  </>
                )}
                <Label className="text-xs text-muted-foreground">{t('queryParams.required')}</Label>
                <Checkbox aria-label={`param-${i}-required`} checked={p.required}
                  onCheckedChange={(c) => update(i, { required: c === true })} />
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
