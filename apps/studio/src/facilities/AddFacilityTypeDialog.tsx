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
import { addFacilityType, type FacilityTypeCollision } from '@/api';

/** The code for a display: lowercase, non-alphanumeric runs to single hyphens, ends trimmed.
 *
 *  Mirrored, not shared, from `packages/bootstrap/src/facility-register-vocabulary.ts`'s own
 *  `codeFor`. This app has no dependency on that package, so it is copied, not imported. This is
 *  a PREVIEW only: it shows the operator the code the server will mint from this display. The
 *  server may still suffix it (`-2`, `-3`, …) when the base is already taken by an unrelated
 *  type; this preview cannot know that and does not need to, since the add call's own result
 *  carries the code that was actually minted. */
function codeFor(display: string): string {
  return display.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface AddFacilityTypeDialogProps {
  open: boolean;
  /** The register this type is added to. Never the shared value set. */
  nationalSystem: string;
  /** Shown in the dialog's own description. A display name, not the register's URI. */
  registerName: string;
  /** The raw source value the operator opened this dialog for. Seeds the Name field; the operator
   *  can still edit it before it is added. */
  rawValue: string;
  onOpenChange: (open: boolean) => void;
  /** Fires once the add call succeeds, with the code the server actually minted (possibly
   *  suffixed, see `codeFor`'s own note). The caller uses it to set the row's choice and re-run
   *  the row's check, never this dialog. */
  onAdded: (code: string) => void;
}

/** Task 5: the "Add a facility type" dialog, reached only from `ValueMapRow`'s own `VALUE_MAP_ADD`
 *  pick-list option (`level` rows only, gated on `terminology.manage`). Copies
 *  `RegisterSourceDialog.tsx`'s shape exactly: a `Dialog`, a header row whose actions are a ⋯
 *  `DropdownMenu` (AGENTS.md section 5 bans a footer with Add/Cancel buttons), fields in a
 *  label-left/input-right grid, and a fresh form every time it opens.
 *
 *  ⛔ THE CODE IS NEVER TYPED. It is rendered as text beside its label, derived from the Name
 *  field live, because the server derives it the same way and a typed code could desync from
 *  what actually gets created. */
export function AddFacilityTypeDialog({
  open, nationalSystem, registerName, rawValue, onOpenChange, onAdded,
}: AddFacilityTypeDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [display, setDisplay] = useState(rawValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time the dialog (re)opens, for the raw value it opened for. Same reset
  // idiom as `RegisterSourceDialog.tsx`.
  useEffect(() => {
    if (!open) return;
    setDisplay(rawValue);
    setError(null);
  }, [open, rawValue]);

  const code = codeFor(display);
  const canSave = code.length > 0 && !saving;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await addFacilityType(nationalSystem, display.trim());
      onAdded(result.code);
      onOpenChange(false);
    } catch (e) {
      // A collision names the concept it hit, so the operator is told to map to THAT one instead
      // of adding a second one. Never a generic "something went wrong".
      const collidesWith = (e as { collidesWith?: FacilityTypeCollision }).collidesWith;
      if (collidesWith) {
        setError(t('facilities.import.valueMap.addTypeCollision', {
          display: collidesWith.display ?? collidesWith.code,
        }));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>{t('facilities.import.valueMap.addTypeTitle')}</DialogTitle>
            <DialogDescription>
              {t('facilities.import.valueMap.addTypeDescription', { register: registerName })}
            </DialogDescription>
          </div>
          {/* ⋯ menu. Add type/Cancel live here, not in a footer. See this file's own doc comment. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={t('facilities.import.valueMap.addTypeActions')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canSave} onClick={() => void handleSave()}>
                {t('facilities.import.valueMap.addTypeAction')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={saving} onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-2">
          <Label htmlFor="add-facility-type-display" className="whitespace-nowrap">
            {t('facilities.import.valueMap.addTypeDisplay')}
          </Label>
          <Input
            id="add-facility-type-display"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
          />

          <Label id="add-facility-type-code-label" className="whitespace-nowrap">
            {t('facilities.import.valueMap.addTypeCode')}
          </Label>
          {/* Not an `Input`: the code is derived, never typed. `aria-labelledby`, not `htmlFor` on
              the label above, because a plain `span` carries no native label association for
              Testing Library (or a screen reader) to find otherwise. */}
          <span
            aria-labelledby="add-facility-type-code-label"
            title={t('facilities.import.valueMap.addTypeCodeHint')}
            className="font-mono text-sm text-muted-foreground"
          >
            {code}
          </span>
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

export default AddFacilityTypeDialog;
