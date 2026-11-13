import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/ui/spinner';
import { SetupCheckRow } from '@/components/setup/SetupCheckRow';
import { runSetupChecks, type SetupReport } from '@/api';
import { SettingsHeader } from './SettingsHeader';

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
              {report.checks.map((check) => <SetupCheckRow key={check.id} check={check} />)}
            </ol>
          </>
        ) : null}
      </div>
    </div>
  );
}
