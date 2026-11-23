import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  listAvailableArtifacts, listInstalledArtifacts, refreshRegistry,
  installArtifact, setArtifactEnabled, rollbackArtifact, removeArtifact, detachArtifact,
  getPublishStatus, publishArtifact,
  type AvailableArtifact, type InstalledArtifact,
} from '@/api';
import { RemovePluginSheet } from './marketplace/RemovePluginSheet';
import { RemovePackDialog } from './marketplace/RemovePackDialog';
import { MarketplaceTabs } from './marketplace/MarketplaceTabs';
import { capabilityLine, packFailureText, pluginPermissionLines, type CardEntry } from './marketplace/util';
import { notifyPluginsChanged } from '@/plugins/pluginEvents';
import { PayloadPreview } from './marketplace/PayloadPreview';

/** An installed plugin version that is not the active one. Removing it removes that version only;
 *  the Remove sheet, which stops work and removes the whole plugin, is for the active version. */
function isOlderVersion(entry: CardEntry): boolean {
  return entry.type === 'plugin' && entry.installed === true && entry.active === false;
}

export function Marketplace() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [configured, setConfigured] = useState(true);
  const [source, setSource] = useState<'local' | 'http' | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailableArtifact[]>([]);
  const [installed, setInstalled] = useState<InstalledArtifact[]>([]);
  const [consent, setConsent] = useState<{ entry: CardEntry; capabilities: unknown[] } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<CardEntry | null>(null);
  // The pack the remove prompt last showed. It outlives pendingRemove, so the prompt's title keeps
  // the id while it closes.
  const [removePackId, setRemovePackId] = useState('');
  if (pendingRemove?.type === 'content-pack' && pendingRemove.id !== removePackId) setRemovePackId(pendingRemove.id);
  const [pendingDetach, setPendingDetach] = useState<CardEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);

  const load = useCallback(async () => {
    try {
      const [avail, inst] = await Promise.all([listAvailableArtifacts(), listInstalledArtifacts()]);
      setConfigured(avail.configured);
      setAvailable(avail.bundles);
      setSource(avail.source); setHost(avail.host);
      setLoadError(avail.error ?? null);
      setInstalled(inst);
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { void getPublishStatus().then((s) => setCanPublish(s.configured)).catch(() => setCanPublish(false)); }, []);

  const doInstall = useCallback(async () => {
    if (!consent || !consent.entry.ref || busy) return;
    setBusy(true);
    try {
      const result = await installArtifact(consent.entry.ref, consent.capabilities);
      // A content pack answers 200 even when a step failed, so read `status` before celebrating.
      if (result.status === 'failed') {
        toast.error(packFailureText(t, result.failedStep, result.error));
      } else {
        toast.success(t('settings.marketplace.installedToast', { id: consent.entry.id }));
      }
      setConsent(null);
      notifyPluginsChanged();
      await load();
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [consent, busy, t, load]);

  const onRefresh = useCallback(async (notify = true) => {
    try { await refreshRegistry(); await load(); if (notify) toast.success(t('settings.marketplace.refresh')); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    try { await setArtifactEnabled(id, enabled); notifyPluginsChanged(); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onRollback = useCallback(async (id: string, version: string) => {
    try { await rollbackArtifact(id, version); notifyPluginsChanged(); toast.success(t('settings.marketplace.installedToast', { id })); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onPublish = useCallback(async (entry: CardEntry) => {
    if (!entry.ref) return;
    try {
      const { prUrl, prNumber } = await publishArtifact(entry.ref);
      toast.success(t('settings.marketplace.publishedToast', { number: prNumber }), {
        action: { label: t('settings.marketplace.viewPr'), onClick: () => window.open(prUrl, '_blank', 'noopener') },
      });
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);

  const doRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const entry = pendingRemove;
    setPendingRemove(null);
    // An older plugin version (not the active one) is removed alone. Its plugin and data stay.
    try { await removeArtifact(entry.id, isOlderVersion(entry) ? entry.version : undefined); notifyPluginsChanged(); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingRemove, t, load]);

  const doDetach = useCallback(async () => {
    if (!pendingDetach) return;
    const entry = pendingDetach;
    setPendingDetach(null);
    try { await detachArtifact(entry.id); toast.success(t('settings.marketplace.detach')); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingDetach, t, load]);

  // ⛔ NO `p-4` on the page box. It used to inset EVERYTHING: the Registries table could not reach
  // the pane edges, its pagination floated 16px off the bottom, and Browse's scrollbar sat inside
  // the padding rather than on the pane edge. Padding now lives on the rows that need it — the tab
  // strip, the filter bar, the card list — so scrollers and rules run edge-to-edge while text stays
  // inset. The detail view keeps its own `p-4` in MarketplaceTabs, because <Divider/> needs one.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="marketplace-page">
      <MarketplaceTabs
        configured={configured}
        available={available}
        installed={installed}
        onInstall={(entry, capabilities) => setConsent({ entry, capabilities })}
        onToggleEnabled={onToggleEnabled}
        onRollback={onRollback}
        onRemove={(entry) => setPendingRemove(entry)}
        onDetach={(e) => setPendingDetach(e)}
        onOpenForm={(id) => navigate('/forms/' + id)}
        canPublish={canPublish}
        onPublish={onPublish}
        source={source}
        host={host}
        onRefresh={() => onRefresh()}
        onRegistrySaved={() => onRefresh(false)}
        loadError={loadError}
      />

      {/* Consent dialog */}
      <Dialog open={consent !== null} onOpenChange={(o) => { if (!o) setConsent(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('settings.marketplace.consentTitle', { id: consent?.entry.id ?? '' })}</DialogTitle>
          {consent ? (
            // `min-h-0 overflow-y-auto`: DialogContent caps at 95vh and clips. A pack's step list with
            // its role capabilities open can outgrow a phone, and the Approve button must stay reachable.
            <div className="grid min-h-0 gap-3 overflow-y-auto text-sm">
              <div><span className="font-medium">{t('settings.marketplace.version')}:</span> {consent.entry.version}</div>
              {consent.entry.type === 'content-pack' ? (
                <PayloadPreview payload={consent.entry.payload ?? null} expandRoles />
              ) : (
              <div>
                <div className="mb-1 font-medium">{t('settings.marketplace.requestedCapabilities')}</div>
                {consent.capabilities.length === 0 ? (
                  <div className="text-muted-foreground">{t('settings.marketplace.noneCapabilities')}</div>
                ) : (
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {consent.capabilities.map((cap, i) => <li key={i}>{capabilityLine(cap, t)}</li>)}
                  </ul>
                )}
                {(() => {
                  const lines = pluginPermissionLines(consent.entry.payload, i18n.language, t);
                  return lines.length === 0 ? null : (
                    <>
                      <div className="mb-1 mt-3 font-medium">{t('settings.marketplace.pluginPermissions')}</div>
                      <ul data-testid="plugin-permissions" className="list-disc pl-5 text-muted-foreground">
                        {lines.map((line, i) => <li key={i}>{line}</li>)}
                      </ul>
                    </>
                  );
                })()}
              </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setConsent(null)}>{t('settings.marketplace.cancel')}</Button>
                <Button data-testid="approve-install" disabled={busy} onClick={() => void doInstall()}>
                  {t('settings.marketplace.approveInstall')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* A plugin's removal stops its reads and checks and asks what to keep (design 2026-11-20). */}
      <RemovePluginSheet
        pluginId={pendingRemove?.type === 'plugin' ? pendingRemove.id : ''}
        open={pendingRemove?.type === 'plugin' && !isOlderVersion(pendingRemove)}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        onRemoved={() => {
          const id = pendingRemove?.id ?? '';
          setPendingRemove(null);
          toast.success(t('settings.marketplace.removeSheet.removed', { id }));
          notifyPluginsChanged();
          void load();
        }}
      />

      {/* A content pack's removal deletes its roles and layouts and keeps its forms (profile packs
          design 5.3). Someone still holding one of its roles blocks it. */}
      <RemovePackDialog
        packId={removePackId}
        open={pendingRemove?.type === 'content-pack'}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        onRemoved={() => {
          const id = pendingRemove?.id ?? '';
          setPendingRemove(null);
          toast.success(t('settings.marketplace.removePack.removed', { id }));
          void load();
        }}
      />

      <ConfirmDialog
        open={pendingRemove !== null && pendingRemove.type !== 'content-pack' && (pendingRemove.type !== 'plugin' || isOlderVersion(pendingRemove))}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={pendingRemove && isOlderVersion(pendingRemove)
          ? t('settings.marketplace.removeVersionTitle', { id: pendingRemove.id, version: pendingRemove.version })
          : t('settings.marketplace.removeTitle', { id: pendingRemove?.id ?? '' })}
        description={pendingRemove && isOlderVersion(pendingRemove)
          ? t('settings.marketplace.removeVersionDescription')
          : t('settings.marketplace.removeDescription')}
        confirmLabel={t('settings.marketplace.remove')}
        destructive
        onConfirm={() => { void doRemove(); }}
      />

      <ConfirmDialog
        open={pendingDetach !== null}
        onOpenChange={(o) => { if (!o) setPendingDetach(null); }}
        title={t('settings.marketplace.detachTitle', { id: pendingDetach?.id ?? '' })}
        description={t('settings.marketplace.detachDescription')}
        confirmLabel={t('settings.marketplace.detach')}
        destructive
        onConfirm={() => { void doDetach(); }}
      />
    </div>
  );
}
