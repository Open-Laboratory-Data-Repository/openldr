import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/spinner';
import { MultiSelect } from '@/components/ui/multi-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getDashboardShare, setDashboardShare, type DashboardShare } from '../api';

export interface ShareSheetProps {
  dashboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Who may see a dashboard and its data, as one role list (design 2026-11-18-roles-scope, part 2).
 *  An empty list keeps the old rule: everyone with the permission. Copied from FormAccessSheet. */
export function ShareSheet({ dashboardId, open, onOpenChange }: ShareSheetProps): JSX.Element {
  const { t } = useTranslation();
  const [share, setShare] = useState<DashboardShare | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setShare(null);
    getDashboardShare(dashboardId).then(
      (s) => { if (live) setShare(s); },
      () => { if (live) toast.error(t('dashboard.share.loadFailed')); },
    );
    return () => { live = false; };
  }, [open, dashboardId, t]);

  // A role id that names no role (deleted since) still shows, under its id, so saving keeps it.
  const options = share
    ? [...share.choices.map((r) => ({ value: r.id, label: r.name })),
      ...share.roles.filter((id) => !share.choices.some((r) => r.id === id)).map((id) => ({ value: id, label: id }))]
    : [];
  const nameOf = (id: string) => options.find((o) => o.value === id)?.label ?? id;

  const save = async () => {
    if (!share) return;
    setSaving(true);
    try {
      const saved = await setDashboardShare(dashboardId, share.roles);
      setShare({ ...share, roles: saved.roles });
      toast.success(t('dashboard.share.saved'));
      onOpenChange(false);
    } catch (err) {
      toast.error(t('dashboard.share.saveFailed'), { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('dashboard.share.title')}</SheetTitle>
          <SheetDescription>{t('dashboard.share.description')}</SheetDescription>
        </SheetHeader>

        {/* The actions sit on the section row, as in FieldEditorSheet, clear of the close button. */}
        <div className="flex items-center justify-between px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">{t('dashboard.share.section')}</h3>
          {share?.mayShare ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('dashboard.share.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={saving} onClick={() => void save()}>{t('dashboard.share.save')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenChange(false)}>{t('dashboard.share.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="border-t border-border" />

        {share === null ? (
          <LoadingState />
        ) : (
          <div className="px-6 py-4">
            <div data-testid="dashboard-share-grid" className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-4">
              <Label className="whitespace-nowrap pt-2">{t('dashboard.share.who')}</Label>
              <div data-testid="dashboard-share-roles" className="flex min-w-0 flex-col gap-1.5">
                {share.roles.length === 0 ? <p className="text-sm text-muted-foreground">{t('dashboard.share.everyone')}</p> : null}
                {share.mayShare ? (
                  <MultiSelect
                    options={options}
                    value={share.roles}
                    onChange={(next) => setShare((s) => (s ? { ...s, roles: next } : s))}
                    placeholder={t('dashboard.share.addRole')}
                    removeLabel={(name) => t('dashboard.share.removeRole', { name })}
                    aria-label={t('dashboard.share.who')}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {share.roles.map((id) => <Badge key={id} variant="secondary">{nameOf(id)}</Badge>)}
                  </div>
                )}
              </div>
            </div>
            {!share.mayShare ? <p className="mt-4 text-xs text-muted-foreground">{t('dashboard.share.readOnly')}</p> : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
