import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import type { ImportStep } from './stepModel';

const STEPS: { step: ImportStep; key: string }[] = [
  { step: 1, key: 'facilities.import.steps.source' },
  { step: 2, key: 'facilities.import.steps.mapping' },
  { step: 3, key: 'facilities.import.steps.review' },
];

export interface ImportStepsProps {
  current: ImportStep;
  /** The furthest step earned. Anything beyond it is rendered but not reachable. */
  furthest: ImportStep;
  /** Round-2 fix: this strip is now the ONLY back affordance — the sheet's own action row used to
   *  also render a labelled Back button, which put two visible buttons on screen at once on Mapping
   *  and Review. A step earlier than `current` is clickable only while this is true (mirrors
   *  `canGoBack`, stepModel.ts: no going back while a run is live). A step from `current` onward, up
   *  to `furthest`, stays reachable regardless — this only ever narrows what was already earned. */
  allowBack: boolean;
  onSelect: (step: ImportStep) => void;
}

/** The "where am I" strip. Presentational only: it holds no state and decides nothing about what is
 *  reachable, which is `stepModel.ts`'s job and is tested there as arithmetic. */
export function ImportSteps({ current, furthest, allowBack, onSelect }: ImportStepsProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('facilities.import.steps.label')} className="flex items-center gap-1">
      {STEPS.map(({ step, key }) => {
        const reachable = step <= furthest && (step >= current || allowBack);
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
