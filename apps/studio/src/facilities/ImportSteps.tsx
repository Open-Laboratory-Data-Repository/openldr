import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import type { ImportStep } from './importSteps';

const STEPS: { step: ImportStep; key: string }[] = [
  { step: 1, key: 'facilities.import.steps.source' },
  { step: 2, key: 'facilities.import.steps.mapping' },
  { step: 3, key: 'facilities.import.steps.review' },
];

export interface ImportStepsProps {
  current: ImportStep;
  /** The furthest step earned. Anything beyond it is rendered but not reachable. */
  furthest: ImportStep;
  onSelect: (step: ImportStep) => void;
}

/** The "where am I" strip. Presentational only: it holds no state and decides nothing about what is
 *  reachable, which is `importSteps.ts`'s job and is tested there as arithmetic. */
export function ImportSteps({ current, furthest, onSelect }: ImportStepsProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('facilities.import.steps.label')} className="flex items-center gap-1">
      {STEPS.map(({ step, key }) => {
        const reachable = step <= furthest;
        return (
          <Button
            key={step}
            variant="ghost"
            size="sm"
            aria-current={step === current ? 'step' : undefined}
            disabled={!reachable}
            onClick={() => onSelect(step)}
            className={cn(
              'h-7 px-2 text-xs',
              step === current ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}
          >
            <span className="mr-1.5 tabular-nums">{step}</span>
            {t(key)}
          </Button>
        );
      })}
    </nav>
  );
}

export default ImportSteps;
