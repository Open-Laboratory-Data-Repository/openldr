import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { SetupCheckRow } from '@/components/setup/SetupCheckRow';
import { runSetupChecks, type SetupCheck } from '@/api';

/**
 * Step 3: the setup checks that still need the person, each with its link. Passing and skipped
 * checks are not listed. Following a link ends the flow and opens that page.
 */
export function ReadyStep({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState<SetupCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runSetupChecks().then(
      (r) => { if (!cancelled) setOpen(r.checks.filter((c) => c.status === 'warn' || c.status === 'fail')); },
      (err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); },
    );
    return () => { cancelled = true; };
  }, []);

  return (
    // `min-h-0 flex-1` lets a long list scroll inside the card instead of pushing the button off it.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('firstRun.ready.title')}</h1>
      {error ? (
        <p role="alert" className="break-words text-destructive">{t('firstRun.ready.error', { error })}</p>
      ) : open === null ? (
        <LoadingState className="min-h-[6rem]" label={t('firstRun.ready.running')} />
      ) : open.length === 0 ? (
        <p className="text-muted-foreground">{t('firstRun.ready.nothing')}</p>
      ) : (
        <>
          <p className="text-muted-foreground">{t('firstRun.ready.intro')}</p>
          {/* The rules run to the card's edges; the rows keep the card's inset. */}
          <div className="-mx-4 min-h-0 overflow-y-auto border-y border-border sm:-mx-6">
            <ol className="m-0 list-none divide-y divide-border p-0">
              {open.map((check) => <SetupCheckRow key={check.id} check={check} onOpen={onDone} className="sm:px-6" />)}
            </ol>
          </div>
        </>
      )}
      <Button type="button" className="shrink-0" onClick={onDone}>{t('firstRun.ready.open')}</Button>
    </div>
  );
}
