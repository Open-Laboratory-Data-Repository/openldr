import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/spinner';
import { MultiSelect } from '@/components/ui/multi-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getFormAccess, setFormAccess, type FormAccess, type FormAccessWithRoles } from '../api';

export interface FormAccessSheetProps {
  formId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = keyof FormAccess;

/** Who may open and who may submit this form, as two role lists (design 2026-11-18-roles-scope,
 *  part 1). An empty list keeps the old rule: every role with the permission. */
export function FormAccessSheet({ formId, open, onOpenChange }: FormAccessSheetProps): JSX.Element {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<FormAccessWithRoles['roles']>([]);
  const [access, setAccess] = useState<FormAccess | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !formId) return;
    let live = true;
    setAccess(null);
    // The role names come with the lists: the role list itself needs roles.view, which a Lab
    // Manager does not hold (Codex FR2).
    getFormAccess(formId).then(
      ({ roles: r, ...a }) => { if (live) { setAccess(a); setRoles(r); } },
      () => { if (live) toast.error(t('formBuilder.access.loadFailed')); },
    );
    return () => { live = false; };
  }, [open, formId, t]);

  // A role id that names no role (deleted since) still shows, under its id, so saving keeps it
  // unless the editor removes it.
  const options = (chosen: string[]) => [
    ...roles.map((r) => ({ value: r.id, label: r.name })),
    ...chosen.filter((id) => !roles.some((r) => r.id === id)).map((id) => ({ value: id, label: id })),
  ];

  const save = async () => {
    if (!formId || !access) return;
    setSaving(true);
    try {
      const saved = await setFormAccess(formId, access);
      setAccess({ open: saved.open, submit: saved.submit });
      toast.success(t('formBuilder.access.saved'));
      onOpenChange(false);
    } catch (err) {
      toast.error(t('formBuilder.access.saveFailed'), { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const list = (mode: Mode) => {
    const chosen = access?.[mode] ?? [];
    return (
      <div data-testid={`form-access-${mode}`} className="flex min-w-0 flex-col gap-1.5">
        {chosen.length === 0 ? <p className="text-sm text-muted-foreground">{t('formBuilder.access.everyone')}</p> : null}
        <MultiSelect
          options={options(chosen)}
          value={chosen}
          onChange={(next) => setAccess((a) => (a ? { ...a, [mode]: next } : a))}
          placeholder={t('formBuilder.access.addRole')}
          removeLabel={(name) => t('formBuilder.access.removeRole', { name })}
          aria-label={t(`formBuilder.access.${mode}`)}
        />
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('formBuilder.access.title')}</SheetTitle>
          <SheetDescription>{t('formBuilder.access.description')}</SheetDescription>
        </SheetHeader>

        {/* The actions sit on the section row, as in FieldEditorSheet, clear of the sheet's close button. */}
        <div className="flex items-center justify-between px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">{t('formBuilder.access.roles')}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('formBuilder.access.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!access || saving} onClick={() => void save()}>{t('formBuilder.access.save')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenChange(false)}>{t('formBuilder.access.cancel')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        {access === null ? (
          <LoadingState />
        ) : (
          <div className="px-6 py-4">
            <div data-testid="form-access-grid" className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-4">
              <Label className="whitespace-nowrap pt-2">{t('formBuilder.access.open')}</Label>
              {list('open')}
              <Label className="whitespace-nowrap pt-2">{t('formBuilder.access.submit')}</Label>
              {list('submit')}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t('formBuilder.access.submitNote')}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
