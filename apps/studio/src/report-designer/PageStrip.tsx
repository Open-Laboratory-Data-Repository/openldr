import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The bar between the canvas header and the page: how many PHYSICAL pages this design prints as.
 *
 * The count is a snapshot of the last load, never a guess: page count depends on data, and running
 * every bound query per keystroke is the alternative. `stale` marks a snapshot the design has been
 * edited past; the empty state says "at least 1" because that is all that is knowable without rows.
 */
export function PageStrip({ counts, loading, stale, onLoad }: {
  counts: { perPage: number[]; total: number } | null;
  loading: boolean;
  stale: boolean;
  onLoad(): void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
      {counts && (
        <div className="flex items-center gap-1" aria-hidden={false}>
          {counts.perPage.flatMap((n, pi) =>
            Array.from({ length: n }, (_, ci) => (
              <span key={`${pi}-${ci}`} aria-label={`${t('reportDesigner.physicalPage')} ${pi + 1}.${ci + 1}`}
                className={cn('h-5 w-3.5 rounded-[2px] border border-border bg-background', ci > 0 && 'border-dashed')} />
            )))}
        </div>
      )}
      <span className="text-foreground">
        {counts ? t('reportDesigner.printsAsPages', { count: counts.total }) : t('reportDesigner.printsAsAtLeastOne')}
      </span>
      {stale && <span>{t('reportDesigner.pageCountStale')}</span>}
      <div className="flex-1" />
      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={loading}
        onClick={onLoad}>
        {t('reportDesigner.loadPages')}
      </Button>
    </div>
  );
}
