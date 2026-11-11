import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { getPluginSites, setPluginSite, type PluginSiteKey, type PluginSitesState } from '@/api';
import { notifyPluginsChanged } from '@/plugins/pluginEvents';

const SITES: PluginSiteKey[] = ['widget', 'panel'];

/** Where a plugin may appear outside its own page: a dashboard card and a side panel. An admin
 *  switches each on or off for the whole lab. A switch saves as soon as it is flipped, and shows
 *  what the server saved, so a failed save leaves it as it was. */
export function PluginSitesSheet({ plugin, onOpenChange }: {
  plugin: { id: string; label: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<PluginSitesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!plugin) return;
    let cancelled = false;
    setState(null);
    setError(null);
    getPluginSites(plugin.id)
      .then((s) => { if (!cancelled) setState(s); })
      .catch((e: unknown) => { if (!cancelled) { setState({ declared: {}, off: [] }); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { cancelled = true; };
  }, [plugin]);

  async function onToggle(site: PluginSiteKey, on: boolean) {
    if (!plugin) return;
    setSaving(true);
    setError(null);
    try {
      setState(await setPluginSite(plugin.id, site, on));
      notifyPluginsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const declared = state ? SITES.filter((s) => state.declared[s]) : [];

  return (
    <Sheet open={plugin !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="pr-6">{t('plugins.sites.title', { name: plugin?.label ?? '' })}</SheetTitle>
          <SheetDescription>{t('plugins.sites.description')}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-sm">
          {error ? (
            <div className="border-b border-border px-6 py-3 text-destructive" data-testid="plugin-sites-error">
              {t('plugins.sites.error', { error })}
            </div>
          ) : null}
          {state === null ? (
            <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />
          ) : declared.length === 0 ? (
            error ? null : (
              <div className="min-h-[16rem] flex-1"><StripedEmpty>{t('plugins.sites.none')}</StripedEmpty></div>
            )
          ) : (
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-6 py-4">
              {declared.map((site) => (
                <div key={site} className="contents">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{t(`plugins.sites.${site}`)}</span>
                    <span className="text-muted-foreground">{state.declared[site]!.title}</span>
                  </div>
                  <div>
                    <Switch
                      aria-label={t(`plugins.sites.${site}`)}
                      checked={!state.off.includes(site)}
                      disabled={saving}
                      onCheckedChange={(next) => { void onToggle(site, next); }}
                      data-testid={`plugin-site-${site}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
