import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TermPicker, type PickedTerm } from '@/terminology/TermPicker';
import {
  CATALOG_CODING_PURPOSES, listCodingSystems, LOINC_SYSTEM_URL, TEST_CATALOG_SYSTEM, TEST_CODE_SYSTEM,
  type CatalogCodingPurpose, type CatalogTestCoding, type CodingSystem,
} from '@/api';

// Add coding, from the Additional codings menu on the Test sheet (plan B, Task 5, spec call 11). A code
// from any loaded system, searched with the TermPicker over the system chosen first, with Corlix's
// purpose and a note. It changes the draft only; the Test sheet's Save sends it. Layout copied from
// AddResultFieldSheet.tsx (AGENTS.md section 5).

/** The systems a coding may come from: active, with a url, not the catalog's own, and not LOINC, whose
 *  one code is the test's LOINC field (review I1). */
function offered(systems: CodingSystem[]): Array<CodingSystem & { url: string }> {
  return systems.filter((s): s is CodingSystem & { url: string } =>
    s.active && !!s.url && s.url !== TEST_CATALOG_SYSTEM && s.url !== TEST_CODE_SYSTEM && s.url !== LOINC_SYSTEM_URL);
}

export function AddCodingSheet({ open, editing, taken, returnFocusTo, onClose, onSave }: {
  open: boolean;
  /** The coding being edited, or null to add one. */
  editing: CatalogTestCoding | null;
  /** The test's other codings, so the same system and code cannot be added twice. */
  taken: CatalogTestCoding[];
  /** Where focus goes when this sheet closes. Radix would aim at the menu item that opened it, which is gone. */
  returnFocusTo?: RefObject<HTMLElement>;
  onClose: () => void;
  onSave: (coding: CatalogTestCoding) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [systems, setSystems] = useState<Array<CodingSystem & { url: string }>>([]);
  const [systemUrl, setSystemUrl] = useState<string | null>(null);
  const [term, setTerm] = useState<PickedTerm | null>(null);
  const [purpose, setPurpose] = useState<CatalogCodingPurpose>('ADDITIONAL');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setSystemUrl(editing?.system ?? null);
    setTerm(editing ? { system: editing.system, code: editing.code, display: editing.display } : null);
    setPurpose(editing?.purpose ?? 'ADDITIONAL');
    setNote(editing?.note ?? '');
    listCodingSystems()
      .then((rows) => setSystems(offered(rows)))
      .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, [open, editing]);

  const system = systems.find((s) => s.url === systemUrl) ?? null;
  const repeat = term !== null && taken.some((c) => c.system === term.system && c.code === term.code);
  const ready = term !== null && !repeat;

  function save() {
    if (!ready || !term) return;
    onSave({ system: term.system, code: term.code, display: term.display, purpose, note: note.trim() || null });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
        onCloseAutoFocus={(e) => { if (returnFocusTo?.current) { e.preventDefault(); returnFocusTo.current.focus(); } }}
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{editing ? t('testCatalog.addCoding.editTitle') : t('testCatalog.addCoding.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.addCoding.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.addCoding.section')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="add-coding-menu" aria-label={t('testCatalog.addCoding.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="add-coding-save" disabled={!ready} onSelect={save}>
                  {t('common.save')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="add-coding-system" className="whitespace-nowrap">{t('testCatalog.addCoding.system')}</Label>
            {systems.length === 0 && !systemUrl ? (
              <span className="text-xs text-muted-foreground">{t('testCatalog.addCoding.noSystems')}</span>
            ) : (
              <Select
                value={systemUrl ?? undefined}
                // A code belongs to one system, so another system starts the code again.
                onValueChange={(v) => { if (v !== systemUrl) { setSystemUrl(v); setTerm(null); } }}
              >
                <SelectTrigger id="add-coding-system" className="min-w-0"><SelectValue placeholder={t('testCatalog.addCoding.systemPick')} /></SelectTrigger>
                <SelectContent>
                  {systems.map((s) => <SelectItem key={s.id} value={s.url}>{s.systemName}</SelectItem>)}
                  {/* A saved coding whose system is not offered now still shows by its url. */}
                  {systemUrl && !system ? <SelectItem value={systemUrl}>{systemUrl}</SelectItem> : null}
                </SelectContent>
              </Select>
            )}

            <Label htmlFor="add-coding-code" className="whitespace-nowrap">{t('testCatalog.addCoding.code')}</Label>
            <div className="flex min-w-0 flex-col gap-1">
              {system ? (
                <TermPicker
                  id="add-coding-code"
                  ariaLabel={t('testCatalog.addCoding.code')}
                  systemId={system.id}
                  value={term}
                  onChange={(v) => setTerm(v ? { system: system.url, code: v.code, display: v.display } : null)}
                />
              ) : term ? (
                <div className="break-all font-mono text-xs">{term.code}</div>
              ) : (
                <span className="text-xs text-muted-foreground">{t('testCatalog.addCoding.systemFirst')}</span>
              )}
              {repeat && term ? (
                <span className="text-xs text-muted-foreground">{t('testCatalog.addCoding.repeat', { system: term.system, code: term.code })}</span>
              ) : null}
            </div>

            <Label htmlFor="add-coding-purpose" className="whitespace-nowrap">{t('testCatalog.addCoding.purpose')}</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as CatalogCodingPurpose)}>
              <SelectTrigger id="add-coding-purpose" className="min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATALOG_CODING_PURPOSES.map((p) => <SelectItem key={p} value={p}>{t(`testCatalog.addCoding.purpose${p}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Label htmlFor="add-coding-note" className="self-start whitespace-nowrap pt-2">{t('testCatalog.addCoding.note')}</Label>
            <Textarea id="add-coding-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
