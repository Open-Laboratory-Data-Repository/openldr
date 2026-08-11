import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createFacilityImportSource, type FacilityRegisterSource } from '@/api';

/** Review fix (B1 Task 9): the create affordance the task's own review found MISSING — the route
 *  and the picklist's `GET` existed and were tested, but nothing in the studio ever called `POST
 *  /api/facilities/import/sources`, so a fresh install (whose `facility_registry` has no
 *  pre-existing `national_system` values for migration 082's back-fill to seed from) had a
 *  permanently empty picklist and facility import was unreachable from the UI.
 *
 *  ⛔ Reached ONLY from the import sheet's ⋯ `DropdownMenu` ("Register a source"), never a
 *  standalone button on the sheet. ⛔ ITS OWN Register/Cancel are ALSO a ⋯ `DropdownMenu` in a
 *  header row, never a footer with plain buttons — see ui-actions-in-dots-menu ("NEVER a footer
 *  Cancel/Save button… a ⋯ DropdownMenu in a header/toolbar row… NOT a SheetFooter with buttons"),
 *  the same shape `TermDialog.tsx`/`TermMappingDialog.tsx` already use for their own Save/Cancel.
 *  Fields are `Input`s in a label-left/input-right `grid-cols-[auto_1fr]` grid, not a native
 *  `<select>` or a stacked layout.
 *
 *  `publisherId` is deliberately NOT a field here, even though the store/route both accept it:
 *  `coding_systems.publisher_id` carries a real foreign key onto `publishers.id` (migration 012),
 *  so a free-text box for it would let an operator type a value that 500s the request the moment it
 *  doesn't match an existing publisher — unlike `version`/`jurisdiction`/`contact`, which are plain
 *  text columns with no such constraint. A publisher picker (a `Select` sourced from
 *  `listPublishers()`, `CodingSystemDialog.tsx`'s own pattern) is future scope, not this fix's. */
export function RegisterSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: FacilityRegisterSource) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [version, setVersion] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time the dialog is (re)opened — otherwise a second "Register a source" in
  // the same sheet session would reopen onto the previous attempt's leftover values (or its error).
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setName('');
    setCode('');
    setVersion('');
    setJurisdiction('');
    setContact('');
    setError(null);
  }, [open]);

  const canSave = url.trim().length > 0 && name.trim().length > 0 && code.trim().length > 0 && !saving;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createFacilityImportSource({
        url: url.trim(),
        name: name.trim(),
        code: code.trim(),
        version: version.trim() || undefined,
        jurisdiction: jurisdiction.trim() || undefined,
        contact: contact.trim() || undefined,
      });
      onCreated(created);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>{t('facilities.import.registerSourceTitle')}</DialogTitle>
            <DialogDescription>{t('facilities.import.registerSourceHint')}</DialogDescription>
          </div>
          {/* ⋯ menu — Register/Cancel live here, not in a footer. See this file's own doc comment
              and ui-actions-in-dots-menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={t('facilities.import.registerSourceActions')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canSave} onClick={() => void handleSave()}>
                {saving ? t('facilities.import.registerSourceSaving') : t('facilities.import.registerSourceSave')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={saving} onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-2">
          <Label htmlFor="register-source-url" className="whitespace-nowrap">
            {t('facilities.import.registerSourceUrlLabel')}
          </Label>
          <Input
            id="register-source-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="urn:tz:hfr"
            className="font-mono"
          />

          <Label htmlFor="register-source-name" className="whitespace-nowrap">
            {t('facilities.import.registerSourceNameLabel')}
          </Label>
          <Input
            id="register-source-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tanzania Health Facility Registry"
          />

          <Label htmlFor="register-source-code" className="whitespace-nowrap">
            {t('facilities.import.registerSourceCodeLabel')}
          </Label>
          <Input
            id="register-source-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="TZ_HFR"
            className="font-mono"
          />

          <Label htmlFor="register-source-version" className="whitespace-nowrap">
            {t('facilities.import.registerSourceVersionLabel')}
          </Label>
          <Input
            id="register-source-version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />

          <Label htmlFor="register-source-jurisdiction" className="whitespace-nowrap">
            {t('facilities.import.registerSourceJurisdictionLabel')}
          </Label>
          <Input
            id="register-source-jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
          />

          <Label htmlFor="register-source-contact" className="whitespace-nowrap">
            {t('facilities.import.registerSourceContactLabel')}
          </Label>
          <Input
            id="register-source-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RegisterSourceDialog;
