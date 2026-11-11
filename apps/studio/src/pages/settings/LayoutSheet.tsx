import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NAV } from '@/shell/AppShell';
import type { LayoutInput, LayoutPreset, RoleRecord } from '@/api';

// Docs always shows, so it is not offered as a page to pick.
const PAGES = NAV.filter((n) => n.to !== '/docs');
const NONE = '__none__';

/** Create or edit one layout. Save is in the sheet's ⋯ menu (AGENTS.md §5). `roles` is null when
 *  the roles could not be read: the role checkboxes are then hidden and the layout keeps its own. */
export function LayoutSheet({ open, layout, roles, onOpenChange, onSave }: {
  open: boolean;
  layout: LayoutPreset | null;
  roles: RoleRecord[] | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: LayoutInput) => Promise<string | null>; // resolves to an error message, or null
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LayoutInput>({ name: '', startPage: null, pages: [], roles: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(layout ? { name: layout.name, startPage: layout.startPage, pages: layout.pages, roles: layout.roles } : { name: '', startPage: null, pages: [], roles: [] });
    setError(null);
  }, [open, layout]);

  const togglePage = (to: string, on: boolean) => setDraft((d) => {
    const pages = on ? [...d.pages, to] : d.pages.filter((p) => p !== to);
    return { ...d, pages, startPage: d.startPage && !pages.includes(d.startPage) ? null : d.startPage };
  });
  const toggleRole = (slug: string, on: boolean) => setDraft((d) => ({ ...d, roles: on ? [...d.roles, slug] : d.roles.filter((r) => r !== slug) }));

  async function save() {
    if (busy) return;
    if (!draft.name.trim() || draft.pages.length === 0) { setError(t('layouts.errRequired')); return; }
    setBusy(true);
    // Pages in sidebar order, whatever order they were ticked in.
    const pages = PAGES.map((p) => p.to).filter((to) => draft.pages.includes(to));
    const failed = await onSave({ ...draft, name: draft.name.trim(), pages });
    setBusy(false);
    if (failed) setError(failed);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-2 pr-6">
            <div className="min-w-0">
              <SheetTitle>{layout ? t('layouts.editTitle') : t('layouts.newTitle')}</SheetTitle>
              <SheetDescription>{t('layouts.sheetDescription')}</SheetDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="layout-sheet-menu" aria-label={t('layouts.sheetActions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="layout-save" disabled={busy} onClick={() => void save()}>{t('layouts.save')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenChange(false)}>{t('layouts.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetHeader>

        {error ? <div className="border-b border-border px-6 py-3 text-sm text-destructive" data-testid="layout-error">{error}</div> : null}

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
          <Label htmlFor="layout-name" className="whitespace-nowrap">{t('layouts.name')}</Label>
          <Input id="layout-name" data-testid="layout-name" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

          <Label htmlFor="layout-start" className="whitespace-nowrap">{t('layouts.startPage')}</Label>
          <Select value={draft.startPage ?? NONE} onValueChange={(v) => setDraft({ ...draft, startPage: v === NONE ? null : v })}>
            <SelectTrigger id="layout-start" data-testid="layout-start"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('layouts.startPageNone')}</SelectItem>
              {PAGES.filter((p) => draft.pages.includes(p.to)).map((p) => <SelectItem key={p.to} value={p.to}>{t(p.labelKey)}</SelectItem>)}
            </SelectContent>
          </Select>

          <span className="self-start whitespace-nowrap pt-0.5 font-medium">{t('layouts.pages')}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {PAGES.map((p) => (
              <label key={p.to} className="flex items-center gap-2">
                <Checkbox data-testid={`layout-page-${p.to}`} checked={draft.pages.includes(p.to)} onCheckedChange={(v) => togglePage(p.to, v === true)} />
                <span>{t(p.labelKey)}</span>
              </label>
            ))}
          </div>

          <span className="self-start whitespace-nowrap pt-0.5 font-medium">{t('layouts.roles')}</span>
          {roles === null ? (
            <p className="text-muted-foreground">{t('layouts.rolesUnavailable')}</p>
          ) : (
            <div className="grid gap-2">
              {roles.map((r) => (
                <label key={r.slug} className="flex items-center gap-2">
                  <Checkbox data-testid={`layout-role-${r.slug}`} checked={draft.roles.includes(r.slug)} onCheckedChange={(v) => toggleRole(r.slug, v === true)} />
                  <span>{r.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
