import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { listConnectorImportPlugins, setConnectorImportPlugin, type Connector, type ConnectorImportPlugin } from '@/api';

/** Which import plugins may read one host connector. A switch saves as soon as it is flipped. */
export function ConnectorPluginAccessSheet({ connector, onOpenChange }: {
  connector: Connector | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<ConnectorImportPlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!connector) return;
    let cancelled = false;
    setPlugins(null);
    setError(null);
    listConnectorImportPlugins(connector.id)
      .then((list) => { if (!cancelled) setPlugins(list); })
      .catch((e: unknown) => { if (!cancelled) { setPlugins([]); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { cancelled = true; };
  }, [connector]);

  async function onToggle(pluginId: string, allowed: boolean) {
    if (!connector) return;
    setSaving(pluginId);
    setError(null);
    try {
      setPlugins(await setConnectorImportPlugin(connector.id, pluginId, allowed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet open={connector !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="pr-6">{t('settings.connectors.pluginAccess.title', { name: connector?.name ?? '' })}</SheetTitle>
          <SheetDescription>{t('settings.connectors.pluginAccess.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-sm">
          {error ? (
            <div className="border-b border-border px-6 py-3 text-destructive" data-testid="plugin-access-error">
              {t('settings.connectors.pluginAccess.error', { error })}
            </div>
          ) : null}
          {plugins === null ? (
            <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />
          ) : plugins.length === 0 ? (
            error ? null : (
              <div className="min-h-[16rem] flex-1" data-testid="plugin-access-empty">
                <StripedEmpty>{t('settings.connectors.pluginAccess.empty')}</StripedEmpty>
              </div>
            )
          ) : (
            <ul className="m-0 list-none divide-y divide-border border-b border-border p-0">
              {plugins.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words font-medium">{p.id}</div>
                    <div className="text-muted-foreground">{p.version}</div>
                  </div>
                  <Switch
                    checked={p.allowed}
                    disabled={saving !== null}
                    onCheckedChange={(next) => { void onToggle(p.id, next); }}
                    aria-label={t('settings.connectors.pluginAccess.allow', { plugin: p.id })}
                    data-testid={`plugin-access-${p.id}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
