import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { DashboardFilterDef } from '../../api';
import { filterTokens } from '../template';

type FilterType = DashboardFilterDef['type'];

function newId(): string {
  return `f_${crypto.randomUUID().slice(0, 6)}`;
}

/** Label-left / control-right row, matching `FieldEditorSheet` and AGENTS.md §5. */
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <>
      <Label htmlFor={htmlFor} className="whitespace-nowrap text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </>
  );
}

export function DashboardFilterEditor({
  open,
  filters,
  onClose,
  onSave,
}: {
  open: boolean;
  filters: DashboardFilterDef[];
  onClose: () => void;
  onSave: (f: DashboardFilterDef[]) => void;
}) {
  const { t } = useTranslation();
  const [list, setList] = useState<DashboardFilterDef[]>(filters);

  // Reset local state whenever the sheet (re)opens.
  useEffect(() => {
    if (open) setList(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (i: number, patch: Partial<DashboardFilterDef>) =>
    setList(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };

  const addFilter = () =>
    setList([...list, { id: newId(), label: 'New Filter', type: 'text' }]);

  const copyToken = (token: string) => {
    void navigator.clipboard?.writeText(token).then(
      () => toast.success(t('dashboard.filters.copiedToast')),
      () => toast.error(t('dashboard.filters.copyFailedToast')),
    );
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[440px] max-w-[90vw] gap-0 p-0 sm:w-[440px]">
        <SheetHeader className="border-b border-border px-6 py-4">
          {/* pr-8 reserves room for SheetContent's absolute close X, which would otherwise
              sit on top of this actions button. */}
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle className="text-base font-semibold">{t('dashboard.filters.title')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('dashboard.filters.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={addFilter}>{t('dashboard.filters.add')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    onSave(list);
                    onClose();
                  }}
                >
                  {t('dashboard.filters.save')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('dashboard.filters.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription className="text-xs text-muted-foreground">{t('dashboard.filters.tokenHelp')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('dashboard.filters.empty')}</p>
          )}
          {list.map((f, i) => (
            <div key={f.id} className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 flex-wrap gap-1">
                  {filterTokens(f).map((token) => {
                    const text = `{{${token}}}`;
                    return (
                      <button
                        key={token}
                        type="button"
                        onClick={() => copyToken(text)}
                        aria-label={`${t('dashboard.filters.copyToken')} ${text}`}
                        className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/20"
                      >
                        {text}
                      </button>
                    );
                  })}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label={t('dashboard.filters.rowActions', { id: f.id })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, -1)}>
                      {t('dashboard.filters.moveUp')}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={i === list.length - 1} onSelect={() => move(i, 1)}>
                      {t('dashboard.filters.moveDown')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setList(list.filter((_, j) => j !== i))}
                    >
                      {t('dashboard.filters.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="border-t border-border" />

              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-3 py-3">
                <Row label={t('dashboard.filters.variableId')}>
                  <Input
                    aria-label={`filter-${i}-id`}
                    className="h-8 text-xs"
                    value={f.id}
                    onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                  />
                </Row>

                <Row label={t('dashboard.filters.label')}>
                  <Input
                    aria-label={`filter-${i}-label`}
                    className="h-8 text-xs"
                    value={f.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </Row>

                <Row label={t('dashboard.filters.type')}>
                  <Select
                    value={f.type}
                    onValueChange={(v) =>
                      update(i, { type: v as FilterType, defaultValue: null, defaultRange: null })
                    }
                  >
                    <SelectTrigger aria-label={`filter-${i}-type`} className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">{t('dashboard.filters.typeText')}</SelectItem>
                      <SelectItem value="number">{t('dashboard.filters.typeNumber')}</SelectItem>
                      <SelectItem value="date">{t('dashboard.filters.typeDate')}</SelectItem>
                      <SelectItem value="date-range">{t('dashboard.filters.typeDateRange')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>

                {f.type === 'text' && (
                  <Row label={t('dashboard.filters.optionsSql')}>
                    <Input
                      aria-label={`filter-${i}-options-sql`}
                      className="h-8 font-mono text-xs"
                      placeholder={t('dashboard.filters.optionsSqlPlaceholder')}
                      value={f.optionsSql ?? ''}
                      onChange={(e) => update(i, { optionsSql: e.target.value || undefined })}
                    />
                  </Row>
                )}

                {(f.type === 'text' || f.type === 'number') && (
                  <Row label={t('dashboard.filters.defaultValue')}>
                    <Input
                      aria-label={`filter-${i}-default`}
                      type={f.type === 'number' ? 'number' : 'text'}
                      className="h-8 text-xs"
                      value={f.defaultValue == null ? '' : String(f.defaultValue)}
                      onChange={(e) =>
                        update(i, {
                          defaultValue:
                            e.target.value === ''
                              ? null
                              : f.type === 'number'
                                ? Number(e.target.value)
                                : e.target.value,
                        })
                      }
                    />
                  </Row>
                )}

                {f.type === 'date' && (
                  <Row label={t('dashboard.filters.defaultValue')}>
                    <DatePicker
                      value={(f.defaultValue as string) ?? null}
                      onChange={(v) => update(i, { defaultValue: v })}
                      className="h-8 text-xs"
                    />
                  </Row>
                )}

                {f.type === 'date-range' && (
                  <>
                    <Row label={t('dashboard.filters.defaultFrom')}>
                      <DatePicker
                        value={f.defaultRange?.from ?? null}
                        onChange={(v) =>
                          update(i, { defaultRange: { from: v ?? '', to: f.defaultRange?.to ?? '' } })
                        }
                        className="h-8 text-xs"
                      />
                    </Row>
                    <Row label={t('dashboard.filters.defaultTo')}>
                      <DatePicker
                        value={f.defaultRange?.to ?? null}
                        onChange={(v) =>
                          update(i, { defaultRange: { from: f.defaultRange?.from ?? '', to: v ?? '' } })
                        }
                        className="h-8 text-xs"
                      />
                    </Row>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
