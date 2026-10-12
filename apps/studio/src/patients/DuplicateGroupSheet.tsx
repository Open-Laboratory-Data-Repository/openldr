import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { dismissPatientDuplicates, restorePatientDuplicates, type DuplicateGroup } from '@/api';

// One likely duplicate group (patient duplicates spec, section 6). Header, ⋯ menu and label-left grid
// copy IdentifierSystemSheet.tsx. A group is one decision: Mark as not duplicates dismisses every pair.
// The API lists at most 50 members. A dismiss only covers the refs the sheet holds, so a larger group
// cannot be marked here.

export function ruleLabel(t: (k: string, o?: Record<string, unknown>) => string, g: DuplicateGroup): string {
  return g.rule === 'identifier'
    ? t('patients.duplicates.ruleIdentifier', { label: g.evidence.label ?? g.evidence.system ?? '' })
    : t('patients.duplicates.ruleDetails');
}

export function DuplicateGroupSheet({ group, canManage, onClose, onChanged, onOpen }: {
  group: DuplicateGroup | null; canManage: boolean; onClose: () => void; onChanged: () => void; onOpen: (ref: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setReason(''); }, [group]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const refs = group?.members.map((m) => m.ref) ?? [];
  const truncated = group ? group.memberCount > group.members.length : false;
  const canMark = group ? group.dismissedPairs < group.pairs && !truncated : false;
  const canRestore = group ? group.dismissedPairs > 0 : false;

  return (
    <Sheet open={group !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('patients.duplicates.sheetTitle')}</SheetTitle>
          <SheetDescription>{t('patients.duplicates.sheetDescription')}</SheetDescription>
        </SheetHeader>
        {group && (
          <>
            <section>
              <div className="flex items-center justify-between px-6 py-3">
                <div className="text-sm font-medium text-foreground">{t('patients.duplicates.evidence')}</div>
                {canManage && (canMark || canRestore) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="duplicate-sheet-menu" aria-label={t('patients.duplicates.actionsFor')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canMark && (
                        <DropdownMenuItem data-testid="duplicate-mark-not" disabled={busy}
                          onSelect={() => void run(() => dismissPatientDuplicates(refs, reason.trim() || null), t('patients.duplicates.marked'))}>
                          {t('patients.duplicates.markNot')}
                        </DropdownMenuItem>
                      )}
                      {canRestore && (
                        <DropdownMenuItem data-testid="duplicate-show-again" disabled={busy}
                          onSelect={() => void run(() => restorePatientDuplicates(refs), t('patients.duplicates.restored'))}>
                          {t('patients.duplicates.showAgain')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="border-t border-border" />
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                <div className="text-muted-foreground">{t('patients.duplicates.col.rule')}</div>
                <div>{ruleLabel(t, group)}</div>
                <div className="text-muted-foreground">{t('patients.duplicates.col.evidence')}</div>
                <div className="break-all font-mono text-xs">{group.evidence.text}</div>
                <div className="text-muted-foreground">{t('patients.duplicates.col.dismissed')}</div>
                <div>{t('patients.duplicates.dismissedOf', { dismissed: group.dismissedPairs, pairs: group.pairs })}</div>
                {canManage && canMark && (
                  <>
                    <div className="text-muted-foreground">{t('patients.duplicates.reason')}</div>
                    <div className="flex flex-col gap-1">
                      <Input data-testid="duplicate-reason" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
                      <span className="text-xs text-muted-foreground">{t('patients.duplicates.reasonHint')}</span>
                    </div>
                  </>
                )}
                {canManage && truncated && (
                  <>
                    <div className="text-muted-foreground">{t('patients.duplicates.reason')}</div>
                    <div className="text-xs text-muted-foreground">{t(group.rule === 'details' ? 'patients.duplicates.tooManyDetails' : 'patients.duplicates.tooMany')}</div>
                  </>
                )}
              </div>
            </section>
            <section>
              <div className="border-t border-border" />
              <div className="px-6 py-3 text-sm font-medium text-foreground">{t('patients.duplicates.members')}</div>
              {truncated && (
                <div className="px-6 pb-3 text-xs text-muted-foreground">
                  {t('patients.duplicates.showingOf', { shown: group.members.length, count: group.memberCount })}
                </div>
              )}
              <div className="border-t border-border" />
              {group.members.map((m) => (
                <div key={m.ref} className="flex items-start justify-between gap-3 border-b border-border px-6 py-3 text-sm">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{m.name ?? ''}</span>
                    <span className="text-xs text-muted-foreground">
                      {[m.sex, m.birthDate, m.ageYears === null ? null : `${m.ageYears}`].filter(Boolean).join(' · ')}
                    </span>
                    {m.identifiers.map((i) => (
                      <span key={`${i.system ?? ''}|${i.value}`} className="break-all text-xs">
                        <span className="text-muted-foreground">{i.label ?? i.system ?? t('patients.noSystem')}: </span>
                        <span className="font-mono">{i.value}</span>
                      </span>
                    ))}
                    {m.managingFacility && (
                      <span className="text-xs text-muted-foreground">{m.managingFacility.name ?? m.managingFacility.reference}</span>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid={`duplicate-member-menu-${m.ref}`} aria-label={t('patients.duplicates.memberActions')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem data-testid={`duplicate-open-${m.ref}`} onSelect={() => onOpen(m.ref)}>
                        {t('patients.duplicates.openPatient')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default DuplicateGroupSheet;
