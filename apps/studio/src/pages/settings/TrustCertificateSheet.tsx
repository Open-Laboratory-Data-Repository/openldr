import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { addTrustCertificate, previewTrustCertificate, type CertificatePreview } from '@/api';
import { changeWasMade, networkErrorLine } from './networkError';

const SAVED: Record<string, string> = {
  added: 'settings.network.savedAdded',
  'in-use': 'settings.network.savedInUse',
  unknown: 'settings.network.savedUnknown',
};

/**
 * Adds one trusted certificate. The person reads it from the server's address or pastes it, sees
 * its fingerprint, and only then can save. Save sends the exact certificate that was shown.
 * Every action is in the header's menu, as on the Connectors sheet.
 */
export function TrustCertificateSheet({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [text, setText] = useState('');
  const [shown, setShown] = useState<CertificatePreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAddress('');
      setText('');
      setShown(null);
      setBusy(false);
    }
  }, [open]);

  const canRead = !busy && (address.trim() !== '' || text.trim() !== '');

  async function read(): Promise<void> {
    setBusy(true);
    setShown(null);
    try {
      // Pasted text wins when both are filled: it is what the person put in front of them.
      const { certificates } = await previewTrustCertificate(text.trim() !== '' ? { text } : { address: address.trim() });
      if (certificates.length !== 1) toast.error(t('settings.network.severalCertificates', { count: certificates.length }));
      else setShown(certificates[0] ?? null);
    } catch (err) {
      toast.error(networkErrorLine(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!shown) return;
    setBusy(true);
    try {
      const saved = await addTrustCertificate(shown.pem);
      toast.success(t(SAVED[saved.state] ?? 'settings.network.saved'));
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(networkErrorLine(err, t));
      if (changeWasMade(err)) {
        onChanged();
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{t('settings.network.sheetTrustTitle')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="trust-sheet-menu" aria-label={t('settings.network.colActions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="trust-read" disabled={!canRead} onSelect={() => void read()}>
                  {t('settings.network.readCertificate')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="trust-save" disabled={busy || !shown} onSelect={() => void save()}>
                  {t('settings.network.save')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>{t('settings.network.sheetTrustDescription')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <Label htmlFor="trust-address" className="whitespace-nowrap">{t('settings.network.fieldAddress')}</Label>
            <Input
              id="trust-address"
              data-testid="trust-address"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={address}
              placeholder={t('settings.network.addressPlaceholder')}
              onChange={(e) => { setAddress(e.target.value); setShown(null); }}
            />
            <Label htmlFor="trust-text" className="self-start whitespace-nowrap pt-2">{t('settings.network.fieldPaste')}</Label>
            <Textarea
              id="trust-text"
              data-testid="trust-text"
              rows={6}
              spellCheck={false}
              className="font-mono text-xs"
              value={text}
              placeholder="-----BEGIN CERTIFICATE-----"
              onChange={(e) => { setText(e.target.value); setShown(null); }}
            />
          </div>
          {shown ? (
            <div data-testid="trust-preview" className="mt-4 grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 border-t border-border pt-4">
              <span className="whitespace-nowrap text-muted-foreground">{t('settings.network.previewFingerprint')}</span>
              <span className="break-all font-mono text-xs">{shown.fingerprint}</span>
              <span className="whitespace-nowrap text-muted-foreground">{t('settings.network.previewIssuedTo')}</span>
              <span className="break-all">{shown.subject}</span>
              <span className="whitespace-nowrap text-muted-foreground">{t('settings.network.previewValidTo')}</span>
              <span>
                {shown.validTo.slice(0, 10)}
                {shown.expired ? <span className="ml-2 text-destructive">{t('settings.network.expired')}</span> : null}
              </span>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
