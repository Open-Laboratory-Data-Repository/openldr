import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingState } from '@/components/ui/spinner';
import { LoadFailed, useLoadErrorToast } from '@/components/ui/load-failed';
import { AppShell } from '@/shell/AppShell';
import { PluginFrame, pluginFrameContext } from './PluginFrame';
import { DeclarativeForm } from './DeclarativeForm';
import { pluginUiAllowed } from './pluginAccess';

export function PluginContainer(): JSX.Element {
  const { pluginId = '' } = useParams();
  const { t } = useTranslation();
  const { user, hasCapability, capabilities } = useAuth();
  const [entry, setEntry] = useState<PluginUiEntry | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  useLoadErrorToast(loadError, t('plugins.loadFailed'));

  useEffect(() => {
    let cancelled = false;
    setEntry(undefined);
    setLoadError(null);
    listPluginUis()
      .then((list) => { if (!cancelled) setEntry((Array.isArray(list) ? list : []).find((e) => e.id === pluginId) ?? null); })
      .catch((e: unknown) => { if (!cancelled) { setLoadError(e instanceof Error ? e.message : String(e)); setEntry(null); } });
    return () => { cancelled = true; };
  }, [pluginId]);

  // Render inside AppShell so the plugin UI keeps the app chrome (sidebar to navigate
  // away, header) and a full-height layout. `fullBleed` gives the webview/iframe the
  // whole content area (AppShell is h-dvh; without it h-full has no height to resolve).
  if (entry === undefined) {
    return <AppShell title={pluginId}><LoadingState className="min-h-[16rem]" /></AppShell>;
  }
  if (loadError) {
    return <AppShell title={pluginId}><LoadFailed message={t('plugins.loadFailed')} /></AppShell>;
  }
  // The server lists only the plugins this user may open, so a plugin they may not open is
  // absent and looks the same as one that is not installed. The check here repeats the
  // server's, so a typed /x/<id> never draws the page; it does not say whether the plugin exists.
  if (entry === null || !pluginUiAllowed(entry, user?.roles ?? [], hasCapability)) {
    return <AppShell title={pluginId}><div className="p-6 text-sm text-muted-foreground">{t('plugins.notFound')}</div></AppShell>;
  }

  return (
    <AppShell title={entry.nav.label} fullBleed>
      {entry.hasWebview ? (
        <div className="min-h-0 flex-1">
          <PluginFrame pluginId={entry.id} serialGranted={entry.devices?.serial === true} pluginLabel={entry.nav.label} pluginVersion={entry.version} context={pluginFrameContext(entry.id, 'page', capabilities ?? [], entry.permissionKeys ?? [])} />
        </div>
      ) : entry.hasDeclarative ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <DeclarativeForm pluginId={entry.id} schema={entry.declarative} />
        </div>
      ) : (
        <div className="p-6 text-sm text-muted-foreground">{t('plugins.noUi')}</div>
      )}
    </AppShell>
  );
}
