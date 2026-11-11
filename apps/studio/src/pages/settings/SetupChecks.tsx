import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, MinusCircle, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/ui/spinner';
import { runSetupChecks, type SetupReport, type SetupStatus } from '@/api';
import { SettingsHeader } from './SettingsHeader';

const ICON: Record<SetupStatus, JSX.Element> = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />,
  fail: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />,
  skip: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />,
};

// The page each fix path opens, by its sub-nav or sidebar label.
const FIX_LABEL: Record<string, string> = {
  '/facilities': 'nav.facilities',
  '/settings/laboratory': 'settings.subNav.laboratory',
  '/settings/connectors': 'settings.subNav.connectors',
  '/settings/sync': 'settings.subNav.sync',
};

/** Settings > Setup checks: what this install still needs before it is ready. Runs when it opens;
 *  the page menu runs it again. The same list as `openldr doctor`. */
export function SetupChecks(): JSX.Element {
  const { t } = useTranslation();
  const [report, setReport] = useState<SetupReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      setReport(await runSetupChecks());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const failed = report?.checks.filter((c) => c.status === 'fail').length ?? 0;
  const warned = report?.checks.filter((c) => c.status === 'warn').length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="setup-checks-page">
      <SettingsHeader
        description={t('settings.setup.description')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="setup-menu" aria-label={t('settings.subNav.setup')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="setup-run-again" disabled={running} onSelect={() => { void run(); }}>
                {t('settings.setup.runAgain')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-sm">
        {running ? (
          <LoadingState className="min-h-[16rem] flex-1" label={t('settings.setup.running')} />
        ) : error ? (
          <div className="px-4 py-4 text-destructive" data-testid="setup-error">
            {t('settings.setup.error', { error })}
          </div>
        ) : report ? (
          <>
            <div className="border-b border-border px-4 py-3 font-medium" data-testid="setup-summary">
              {failed === 0 && warned === 0
                ? t('settings.setup.allPassed')
                : [
                    ...(failed ? [t('settings.setup.failedCount', { count: failed })] : []),
                    ...(warned ? [t('settings.setup.warnedCount', { count: warned })] : []),
                  ].join(', ')}
            </div>
            {/* Reset the browser's list padding so the dividers run to the pane edges. */}
            <ol className="m-0 list-none divide-y divide-border border-b border-border p-0">
              {report.checks.map((check) => (
                <li key={check.id} className="flex gap-3 px-4 py-3" data-testid={`setup-check-${check.id}`} data-status={check.status}>
                  <span className="mt-0.5" aria-label={t(`settings.setup.status.${check.status}`)}>{ICON[check.status]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t(`settings.setup.check.${check.id}`)}</div>
                    {check.detail ? <div className="break-words text-muted-foreground">{check.detail}</div> : null}
                    {check.hint ? (
                      <div className="mt-1 break-words" data-testid={`setup-hint-${check.id}`}>
                        {t(`settings.setup.hint.${check.hint}`)}
                      </div>
                    ) : null}
                    {check.fix ? (
                      <Link
                        to={check.fix}
                        className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline"
                        data-testid={`setup-fix-${check.id}`}
                      >
                        {t('settings.setup.open', { page: t(FIX_LABEL[check.fix] ?? 'settings.title') })}
                      </Link>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-muted-foreground">{t(`settings.setup.status.${check.status}`)}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
    </div>
  );
}
