import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { fetchSampleDataAllowed } from '@/api';
import { LabStep } from './LabStep';
import { SampleDataStep } from './SampleDataStep';
import { ReadyStep } from './ReadyStep';

/** `after-lab`: step 1 is done and the answer on sample data has not come yet. */
type Step = 'lab' | 'after-lab' | 'sample' | 'ready';

const TOTAL = 3;

/**
 * The steps after the first administrator is made: name the laboratory, load sample data, and see
 * what still needs the person. AuthProvider shows it in place of the app, once, to that person.
 * Every step can be skipped. Same layout as SetupPage.
 *
 * Nothing here may import auth/AuthProvider.tsx or pages/settings/SetupChecks.tsx: AuthProvider
 * imports this page, so either import closes a cycle that `pnpm depcruise` counts.
 */
export function FirstRunPage({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('lab');
  // Asked once, while the person is on step 1. A failure counts as "not allowed".
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSampleDataAllowed().then(
      (a) => { if (!cancelled) setAllowed(a); },
      () => { if (!cancelled) setAllowed(false); },
    );
    return () => { cancelled = true; };
  }, []);

  const shown: Step = step === 'after-lab' && allowed !== null ? (allowed ? 'sample' : 'ready') : step;
  const number = shown === 'lab' ? 1 : shown === 'ready' ? 3 : 2;

  return (
    <StripedEmpty className="h-dvh">
      <div className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground shadow-sm sm:p-6">
        <p className="text-xs text-muted-foreground">{t('firstRun.stepOf', { step: number, total: TOTAL })}</p>
        {shown === 'lab' && <LabStep onNext={() => setStep('after-lab')} />}
        {shown === 'after-lab' && (
          <>
            <LoadingState className="min-h-[6rem]" />
            {/* The answer may never come. The person can still go on. */}
            <Button type="button" variant="ghost" onClick={() => setStep('ready')}>{t('firstRun.skip')}</Button>
          </>
        )}
        {shown === 'sample' && <SampleDataStep onNext={() => setStep('ready')} />}
        {shown === 'ready' && <ReadyStep onDone={onDone} />}
      </div>
    </StripedEmpty>
  );
}
