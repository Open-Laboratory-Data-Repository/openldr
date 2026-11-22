import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Bleed } from '@/components/ui/bleed';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { TablePagination } from '@/components/ui/table-pagination';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { addLabSection, listLabSections, removeLabSection, type LabSection } from '@/api';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The lab's section list on Settings ▸ Laboratory. Add opens from the page's ⋯ menu, so the page
 * owns `adding`. Remove is in each row's ⋯ menu and asks first with a destructive confirm Dialog,
 * the one place a Dialog is right (AGENTS.md section 5). The server refuses to remove a section a
 * test still uses, and its words reach the toast.
 */
export function LabSections({ adding, onAddingChange }: {
  adding: boolean;
  onAddingChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LabSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [pendingRemove, setPendingRemove] = useState<LabSection | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listLabSections());
    } catch (e) {
      toast.error(t('settings.laboratory.sections.loadError', { error: errorText(e) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // A removal can empty the last page; step back rather than show an empty page of a full list.
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const shownPage = Math.min(page, lastPage);
  const visible = rows.slice(shownPage * pageSize, (shownPage + 1) * pageSize);

  const onRemove = async (section: LabSection) => {
    setPendingRemove(null);
    try {
      await removeLabSection(section.code);
      toast.success(t('settings.laboratory.sections.removed', { code: section.code }));
      await load();
    } catch (e) {
      toast.error(t('settings.laboratory.sections.removeError', { error: errorText(e) }));
    }
  };

  return (
    <section className="flex flex-col gap-2" data-testid="lab-sections">
      <div>
        <h3 className="text-sm font-semibold">{t('settings.laboratory.sections.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('settings.laboratory.sections.description')}</p>
      </div>
      <Bleed className="flex min-h-[16rem] flex-col border-t border-border">
        {loading ? (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center"><LoadingState /></div>
        ) : rows.length === 0 ? (
          <StripedEmpty className="min-h-[16rem] flex-1">{t('settings.laboratory.sections.empty')}</StripedEmpty>
        ) : (
          // Rendered only when populated: an empty table's header forces intrinsic width and
          // scrolls a phone sideways (AGENTS.md section 6).
          <div className="min-h-[16rem] flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.laboratory.sections.code')}</TableHead>
                  <TableHead>{t('settings.laboratory.sections.name')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {visible.map((s) => (
                  <TableRow key={s.code} data-testid={`section-row-${s.code}`}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="text-xs">{s.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                              aria-label={t('settings.laboratory.sections.rowActions', { name: s.name })}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setPendingRemove(s)}>
                              {t('settings.laboratory.sections.remove')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <TablePagination
          page={shownPage}
          pageSize={pageSize}
          total={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
          leftSlot={<span className="text-muted-foreground">{t('settings.laboratory.sections.count', { count: rows.length })}</span>}
        />
      </Bleed>

      <AddSectionSheet open={adding} onOpenChange={onAddingChange} onAdded={load} />

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.laboratory.sections.removeTitle', { code: pendingRemove?.code ?? '' })}
        description={t('settings.laboratory.sections.removeDescription')}
        confirmLabel={t('settings.laboratory.sections.remove')}
        cancelLabel={t('settings.laboratory.sections.cancel')}
        destructive
        onConfirm={() => { if (pendingRemove) void onRemove(pendingRemove); }}
      />
    </section>
  );
}

function AddSectionSheet({ open, onOpenChange, onAdded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setCode(''); setName(''); }
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      // The server checks the code and the name, so both doors refuse in the same words.
      const added = await addLabSection({ code: code.trim(), name });
      toast.success(t('settings.laboratory.sections.added', { code: added.code }));
      onOpenChange(false);
      await onAdded();
    } catch (e) {
      toast.error(t('settings.laboratory.sections.addError', { error: errorText(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{t('settings.laboratory.sections.addTitle')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('common.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={saving} onSelect={() => { void save(); }}>
                  {t('settings.laboratory.sections.save')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenChange(false)}>
                  {t('settings.laboratory.sections.cancel')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>{t('settings.laboratory.sections.addDescription')}</SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
          <Label htmlFor="lab-section-code" className="self-start pt-2 text-xs">{t('settings.laboratory.sections.code')}</Label>
          <div className="flex flex-col gap-1">
            <Input id="lab-section-code" aria-label={t('settings.laboratory.sections.code')} value={code}
              onChange={(e) => setCode(e.target.value)} className="h-8 font-mono text-xs" maxLength={40} />
            <p className="text-[11px] leading-snug text-muted-foreground">{t('settings.laboratory.sections.codeHint')}</p>
          </div>
          <Label htmlFor="lab-section-name" className="text-xs">{t('settings.laboratory.sections.name')}</Label>
          <Input id="lab-section-name" aria-label={t('settings.laboratory.sections.name')} value={name}
            onChange={(e) => setName(e.target.value)} className="h-8 text-xs" maxLength={100} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
