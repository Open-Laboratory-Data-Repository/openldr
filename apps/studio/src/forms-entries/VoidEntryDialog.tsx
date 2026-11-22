import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { voidFormEntry, type FormEntry } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Mark an entry as entered in error (design 2026-11-22-form-entries, 5.5). A Dialog, not a sheet:
// this is a destructive confirm, which AGENTS.md section 5 gives to a Dialog. It cannot be undone in
// this version, so it says so. The layout copies RemovePackDialog: send, stay open on a failure.

const P = 'forms.entries';
const MAX_REASON = 500;

export function VoidEntryDialog({ entry, onClose, onDone }: {
  /** The entry to mark. Null keeps the dialog closed. */
  entry: FormEntry | null;
  onClose: () => void;
  /** The list should be read again: the entry is marked, by this user or by someone before. */
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setReason(''); setError(null); setBusy(false); }, [entry?.id]);

  const trimmed = reason.trim();
  const label = entry?.entryKey ?? t(`${P}.noKey`);

  const doVoid = async () => {
    if (!entry || !trimmed) return;
    setBusy(true); setError(null);
    try {
      const out = await voidFormEntry(entry.id, trimmed);
      // A warning means the entry is marked but its saved records were not all updated.
      toast.success(t(`${P}.voidedToast`, { key: label }), out.warning ? { description: out.warning } : undefined);
      onClose();
      onDone();
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        toast.error(t(`${P}.alreadyVoided`));
        onClose();
        onDone();
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t(`${P}.voidTitle`, { key: label })}</DialogTitle>
          <DialogDescription>{t(`${P}.voidIntro`)}</DialogDescription>
        </DialogHeader>
        {/* Label left, textarea right (AGENTS.md section 5). At 375 wide the dialog still leaves the
            textarea about 230px beside a one-word label, so it does not stack. */}
        <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2">
          <Label htmlFor="void-entry-reason" className="pt-2">{t(`${P}.reason`)}</Label>
          <Textarea
            id="void-entry-reason"
            value={reason}
            maxLength={MAX_REASON}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(`${P}.reasonHint`)}
          />
          <p className="col-start-2 m-0 text-xs text-muted-foreground">{t(`${P}.cannotUndo`)}</p>
          {error ? <p role="alert" className="col-start-2 m-0 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
        </div>
        <DialogFooter className="mt-0">
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          {/* Button has no destructive variant; this is the red RemovePackDialog uses. */}
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!trimmed || busy}
            onClick={() => { void doVoid(); }}
          >
            {t(`${P}.voidAction`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
