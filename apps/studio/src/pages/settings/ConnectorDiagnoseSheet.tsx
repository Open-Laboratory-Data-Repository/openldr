import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, MinusCircle, MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/ui/spinner';
import { diagnoseConnector, type Connector, type DiagnoseResult, type DiagnoseStatus } from '@/api';

const ICON: Record<DiagnoseStatus, JSX.Element> = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />,
  fail: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />,
  skip: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />,
};

/** Step-by-step connection check for one host connector. Runs when it opens; the header menu reruns it. */
export function ConnectorDiagnoseSheet({ connector, onOpenChange }: {
  connector: Connector | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async (id: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await diagnoseConnector(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (connector) void run(connector.id);
  }, [connector, run]);

  const failed = result?.steps.find((s) => s.status === 'fail');

  return (
    <Sheet open={connector !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{t('settings.connectors.diagnose.title', { name: connector?.name ?? '' })}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="diagnose-menu" aria-label={t('settings.connectors.colActions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="diagnose-run-again"
                  disabled={running || !connector}
                  onSelect={() => { if (connector) void run(connector.id); }}
                >
                  {t('settings.connectors.diagnose.runAgain')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>{t('settings.connectors.diagnose.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-sm">
          {running ? (
            <LoadingState className="min-h-[16rem] flex-1" label={t('settings.connectors.diagnose.running')} />
          ) : error ? (
            <div className="px-6 py-4 text-destructive" data-testid="diagnose-error">
              {t('settings.connectors.diagnose.error', { error })}
            </div>
          ) : result ? (
            <>
              {/* Reset the browser's list padding so the dividers run to the pane edges. */}
              <ol className="m-0 list-none divide-y divide-border p-0">
                {result.steps.map((step) => (
                  <li key={step.id} className="flex gap-3 px-6 py-3" data-testid={`diagnose-step-${step.id}`} data-status={step.status}>
                    <span className="mt-0.5" aria-label={t(`settings.connectors.diagnose.status.${step.status}`)}>{ICON[step.status]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t(`settings.connectors.diagnose.step.${step.id}`)}</div>
                      {step.detail ? <div className="break-words text-muted-foreground">{step.detail}</div> : null}
                      {step.hint ? (
                        <div className="mt-1 break-words" data-testid={`diagnose-hint-${step.id}`}>
                          {t(`settings.connectors.diagnose.hint.${step.hint}`)}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="border-t border-border px-6 py-3 text-muted-foreground" data-testid="diagnose-summary">
                {failed
                  ? t('settings.connectors.diagnose.failed', { step: t(`settings.connectors.diagnose.step.${failed.id}`) })
                  : t('settings.connectors.diagnose.allPassed')}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
