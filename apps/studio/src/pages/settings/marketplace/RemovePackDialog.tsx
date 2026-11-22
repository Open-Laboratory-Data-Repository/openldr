import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPackRemoval, removePack, type PackRemoval, type PackRoleHolders } from '@/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';

// Remove an installed content pack (profile packs design 5.3 and 5.4). It deletes the roles and
// layouts the pack made and keeps its forms. A user who still holds one of its roles blocks it.
// A Dialog, not a sheet: this is a destructive confirm, which AGENTS.md section 5 gives to a Dialog.
// The data flow copies RemovePluginSheet: read the plan on open, send, stay open on a refusal.

const P = 'settings.marketplace.removePack';

function NameList({ testId, title, names }: { testId: string; title: string; names: string[] }) {
  const { t } = useTranslation();
  return (
    <section data-testid={testId} className="flex flex-col gap-1">
      <h3 className="m-0 text-sm font-medium">{title}</h3>
      {names.length === 0 ? (
        <p className="m-0 text-muted-foreground">{t(`${P}.none`)}</p>
      ) : (
        <ul className="m-0 list-disc space-y-0.5 pl-5 text-muted-foreground [overflow-wrap:anywhere]">
          {names.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

export function RemovePackDialog({ packId, open, onOpenChange, onRemoved }: {
  packId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const [removal, setRemoval] = useState<PackRemoval | null>(null);
  const [holders, setHolders] = useState<PackRoleHolders[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRemoval(null); setHolders([]); setError(null);
    let live = true;
    void getPackRemoval(packId).then(
      (r) => { if (live) { setRemoval(r); setHolders(r.holders); } },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [open, packId]);

  const doRemove = async () => {
    setBusy(true); setError(null);
    try {
      const out = await removePack(packId);
      // A refusal removed nothing. Show who holds the roles and keep the prompt open.
      if (out.ok) onRemoved();
      else setHolders(out.holders);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const blocked = holders.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg" data-testid="remove-pack-dialog">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t(`${P}.title`, { id: packId })}</DialogTitle>
          <DialogDescription>{t(`${P}.intro`)}</DialogDescription>
        </DialogHeader>

        {!removal && !error ? (
          <div className="min-h-[8rem]"><LoadingState /></div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto text-sm">
            {removal ? (
              <>
                <NameList testId="remove-pack-roles" title={t(`${P}.rolesGo`)} names={removal.roles} />
                <NameList testId="remove-pack-layouts" title={t(`${P}.layoutsGo`)} names={removal.layouts} />
                <NameList testId="remove-pack-forms" title={t(`${P}.formsStay`)} names={removal.formsKept} />
              </>
            ) : null}
            {blocked ? (
              <div role="alert" data-testid="remove-pack-holders" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                <p className="m-0">{t(`${P}.holders`)}</p>
                <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5 [overflow-wrap:anywhere]">
                  {holders.map((h) => <li key={h.role}>{t(`${P}.holder`, { role: h.role, users: h.users.join(', ') })}</li>)}
                </ul>
              </div>
            ) : null}
            {error ? <p className="m-0 text-destructive" role="alert">{error}</p> : null}
          </div>
        )}

        <DialogFooter className="mt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t(`${P}.cancel`)}</Button>
          {/* The red ConfirmDialog gives a destructive action. Button has no destructive variant. */}
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="remove-pack-confirm"
            disabled={!removal || busy || blocked}
            onClick={() => { void doRemove(); }}
          >
            {t(`${P}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
