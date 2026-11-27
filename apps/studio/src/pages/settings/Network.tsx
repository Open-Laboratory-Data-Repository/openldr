import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { TablePagination } from '@/components/ui/table-pagination';
import { SettingsHeader } from './SettingsHeader';
import { TrustCertificateSheet } from './TrustCertificateSheet';
import { WorkflowHostSheet } from './WorkflowHostSheet';
import { changeWasMade, networkErrorLine } from './networkError';
import {
  getNetworkTrust, getWorkflowHosts, removeTrustCertificate, removeWorkflowHost, setWorkflowSelf, unlockTrust,
  type NetworkTrust, type TrustedCertificate, type WorkflowHostRow, type WorkflowHostsView,
} from '@/api';

type NetworkTab = 'trust' | 'hosts';

const STATE_KEY: Record<TrustedCertificate['state'], string> = {
  'in-use': 'settings.network.stateInUse',
  added: 'settings.network.stateAdded',
  removed: 'settings.network.stateRemoved',
  outside: 'settings.network.stateOutside',
  unknown: 'settings.network.stateUnknown',
};
const MODE_KEY: Record<Exclude<NetworkTrust['mode'], 'editable'>, string> = {
  'not-configured': 'settings.network.modeNotConfigured',
  'set-outside': 'settings.network.modeSetOutside',
  damaged: 'settings.network.modeDamaged',
};

const PAGE_SIZE = 25;
const pageOf = <T,>(rows: T[], page: number, size: number): T[] => rows.slice(page * size, page * size + size);

/**
 * Settings > Network. Two lists an administrator keeps: the certificates this OpenLDR trusts for
 * its own outgoing HTTPS calls, and the hosts a workflow HTTP step may call. Laid out as
 * DistributedSync.tsx is: tabs with one ⋯ menu on the tab row whose items follow the open tab.
 * Each table is rendered only when it has rows, so an empty one cannot push a phone sideways.
 */
export function Network() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<NetworkTab>('trust');
  const [trust, setTrust] = useState<NetworkTrust | null>(null);
  const [hosts, setHosts] = useState<WorkflowHostsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trustPage, setTrustPage] = useState(0);
  const [trustSize, setTrustSize] = useState(PAGE_SIZE);
  const [hostPage, setHostPage] = useState(0);
  const [hostSize, setHostSize] = useState(PAGE_SIZE);
  const [addingCert, setAddingCert] = useState(false);
  const [addingHost, setAddingHost] = useState(false);
  const [removingCert, setRemovingCert] = useState<TrustedCertificate | null>(null);
  const [removingHost, setRemovingHost] = useState<WorkflowHostRow | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [selfBusy, setSelfBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextTrust, nextHosts] = await Promise.all([getNetworkTrust(), getWorkflowHosts()]);
      setTrust(nextTrust);
      setHosts(nextHosts);
      setError(null);
    } catch (err) {
      setError(networkErrorLine(err, t));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  /** Runs a change, says how it went in a toast, and reloads when the lists may have changed. */
  async function change(work: () => Promise<string>): Promise<void> {
    try {
      toast.success(await work());
      await load();
    } catch (err) {
      toast.error(networkErrorLine(err, t));
      if (changeWasMade(err)) await load();
    }
  }

  async function onSelf(on: boolean): Promise<void> {
    setSelfBusy(true);
    try {
      const self = await setWorkflowSelf(on);
      setHosts((h) => (h ? { ...h, self } : h));
    } catch (err) {
      toast.error(networkErrorLine(err, t));
      if (changeWasMade(err)) await load();
    } finally {
      setSelfBusy(false);
    }
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('settings.network.copied'));
    } catch {
      // No clipboard here. The fingerprint is on the screen to read.
    }
  }

  const loading = trust === null && hosts === null && error === null;
  const editable = trust?.mode === 'editable';
  const certs = trust?.certificates ?? [];
  const hostRows = hosts?.hosts ?? [];
  const certView = pageOf(certs, trustPage, trustSize);
  const hostView = pageOf(hostRows, hostPage, hostSize);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="network-page">
      <SettingsHeader description={t('settings.network.description')} />
      {loading ? (
        <div data-testid="network-loading" className="flex min-h-0 flex-1"><LoadingState className="flex-1" label={t('common.loading')} /></div>
      ) : error !== null && (trust === null || hosts === null) ? (
        <div data-testid="network-error" className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
      ) : trust && hosts ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as NetworkTab)} className="flex min-h-0 flex-1 flex-col">
          {/* The rule is on this row, not on TabsList, so it runs edge to edge under the tabs and the menu. */}
          <div className="mt-2 flex items-center justify-between gap-2 border-b border-border px-4">
            <TabsList className="border-b-0">
              <TabsTrigger value="trust">{t('settings.network.tabTrust')}</TabsTrigger>
              <TabsTrigger value="hosts">{t('settings.network.tabHosts')}</TabsTrigger>
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="network-menu" aria-label={t('common.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {tab === 'trust' ? (
                  <>
                    <DropdownMenuItem data-testid="trust-add" disabled={!editable} onSelect={() => setAddingCert(true)}>
                      {t('settings.network.addCertificate')}
                    </DropdownMenuItem>
                    {trust.lock?.stuck ? (
                      <DropdownMenuItem data-testid="trust-unlock" onSelect={() => setUnlocking(true)}>
                        {t('settings.network.unlock')}
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : (
                  <DropdownMenuItem data-testid="host-add" onSelect={() => setAddingHost(true)}>
                    {t('settings.network.addHost')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* `data-[state=inactive]:hidden` is needed: a flex class out-ranks the rule that hides an inactive panel. */}
          <TabsContent value="trust" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            {trust.mode !== 'editable' ? (
              <div data-testid="trust-mode-note" className="border-b border-border px-4 py-2 text-sm text-muted-foreground">{t(MODE_KEY[trust.mode])}</div>
            ) : null}
            {trust.lock ? (
              <div data-testid="trust-lock-note" className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
                {t(trust.lock.stuck ? 'settings.network.lockStuck' : 'settings.network.lockBusy')}
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {certView.length > 0 ? (
                <Table wrapperClassName="min-h-0 flex-1">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>{t('settings.network.colName')}</TableHead>
                      <TableHead>{t('settings.network.colFingerprint')}</TableHead>
                      <TableHead className="whitespace-nowrap">{t('settings.network.colValidTo')}</TableHead>
                      <TableHead>{t('settings.network.colState')}</TableHead>
                      <TableHead className="text-right">{t('settings.network.colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr:last-child]:border-b">
                    {certView.map((c) => (
                      <TableRow key={c.fingerprint} data-testid={`trust-row-${c.fingerprint}`}>
                        <TableCell className="break-all">{c.subject}</TableCell>
                        <TableCell className="min-w-[12rem] break-all font-mono text-xs">{c.fingerprint}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.validTo.slice(0, 10)}
                          {c.expired ? <span className="ml-2 text-destructive">{t('settings.network.expired')}</span> : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{t(STATE_KEY[c.state])}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`trust-actions-${c.fingerprint}`} aria-label={t('settings.network.rowActions', { name: c.subject })}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem data-testid={`trust-copy-${c.fingerprint}`} onSelect={() => void copy(c.fingerprint)}>
                                  {t('settings.network.copyFingerprint')}
                                </DropdownMenuItem>
                                {/* A certificate that is only still loaded is no longer in the file: there is nothing to remove. */}
                                <DropdownMenuItem data-testid={`trust-remove-${c.fingerprint}`} disabled={!editable || c.state === 'removed'} onSelect={() => setRemovingCert(c)}>
                                  {t('settings.network.remove')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div data-testid="trust-empty" className="flex min-h-0 flex-1"><StripedEmpty className="flex-1">{t('settings.network.emptyTrust')}</StripedEmpty></div>
              )}
            </div>
            <TablePagination
              page={trustPage}
              pageSize={trustSize}
              total={certs.length}
              onPageChange={setTrustPage}
              onPageSizeChange={(n) => { setTrustSize(n); setTrustPage(0); }}
              leftSlot={<span data-testid="trust-count" className="text-muted-foreground">{t('settings.network.countTrust', { count: certs.length })}</span>}
            />
          </TabsContent>

          <TabsContent value="hosts" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-sm">
              <Switch data-testid="hosts-self" aria-label={t('settings.network.selfLabel')} checked={hosts.self.on} disabled={selfBusy} onCheckedChange={(v) => void onSelf(v)} />
              <Label className="text-muted-foreground">{t('settings.network.selfLabel')}</Label>
              <span data-testid="hosts-self-origin" className="break-all font-mono text-xs text-muted-foreground">{t('settings.network.selfOrigin', { origin: hosts.self.origin })}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {hostView.length > 0 ? (
                <Table wrapperClassName="min-h-0 flex-1">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>{t('settings.network.colHost')}</TableHead>
                      <TableHead>{t('settings.network.colSource')}</TableHead>
                      <TableHead className="text-right">{t('settings.network.colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr:last-child]:border-b">
                    {hostView.map((h) => (
                      <TableRow key={h.host} data-testid={`host-row-${h.host}`}>
                        <TableCell className="break-all font-mono text-xs">{h.host}</TableCell>
                        <TableCell className="whitespace-nowrap">{t(h.source === 'server' ? 'settings.network.sourceServer' : 'settings.network.sourceSetting')}</TableCell>
                        <TableCell>
                          {/* A host from the server setting is changed on the server, so it has no menu. */}
                          {h.source === 'setting' ? (
                            <div className="flex items-center justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`host-actions-${h.host}`} aria-label={t('settings.network.rowActions', { name: h.host })}>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem data-testid={`host-remove-${h.host}`} onSelect={() => setRemovingHost(h)}>
                                    {t('settings.network.remove')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div data-testid="hosts-empty" className="flex min-h-0 flex-1"><StripedEmpty className="flex-1">{t('settings.network.emptyHosts')}</StripedEmpty></div>
              )}
            </div>
            <div data-testid="hosts-note" className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{t('settings.network.hostsNote')}</div>
            <TablePagination
              page={hostPage}
              pageSize={hostSize}
              total={hostRows.length}
              onPageChange={setHostPage}
              onPageSizeChange={(n) => { setHostSize(n); setHostPage(0); }}
              leftSlot={<span data-testid="hosts-count" className="text-muted-foreground">{t('settings.network.countHosts', { count: hostRows.length })}</span>}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      <TrustCertificateSheet open={addingCert} onOpenChange={setAddingCert} onChanged={() => void load()} />
      <WorkflowHostSheet open={addingHost} onOpenChange={setAddingHost} onChanged={() => void load()} />

      {/* Confirm prompts are the case a dialog is for. */}
      <ConfirmDialog
        open={removingCert !== null}
        onOpenChange={(o) => { if (!o) setRemovingCert(null); }}
        title={t('settings.network.removeCertTitle', { name: removingCert?.subject ?? '' })}
        description={t('settings.network.removeCertDescription')}
        confirmLabel={t('settings.network.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          const target = removingCert;
          setRemovingCert(null);
          if (target) void change(async () => { await removeTrustCertificate(target.fingerprint); return t('settings.network.removedCert'); });
        }}
      />
      <ConfirmDialog
        open={removingHost !== null}
        onOpenChange={(o) => { if (!o) setRemovingHost(null); }}
        title={t('settings.network.removeHostTitle', { name: removingHost?.host ?? '' })}
        description={t('settings.network.removeHostDescription')}
        confirmLabel={t('settings.network.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          const target = removingHost;
          setRemovingHost(null);
          if (target) void change(async () => { await removeWorkflowHost(target.host); return t('settings.network.removedHost'); });
        }}
      />
      <ConfirmDialog
        open={unlocking}
        onOpenChange={setUnlocking}
        title={t('settings.network.unlockTitle')}
        description={t('settings.network.unlockDescription')}
        confirmLabel={t('settings.network.unlock')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setUnlocking(false);
          void change(async () => t((await unlockTrust()).removed ? 'settings.network.unlocked' : 'settings.network.noLock'));
        }}
      />
    </div>
  );
}
