import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { PackDatasetRef } from './api';

/** Seconds with one decimal under ten seconds, whole seconds above. */
function seconds(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? s.toFixed(1) : String(Math.round(s));
}

/**
 * What a pack dataset's table cannot say about itself: which pack owns it, when it was last built,
 * how long that took, and why the newest build failed. Read-only. Rebuild and Delete are in the
 * row's menu in the explorer.
 */
export function DatasetInfoSheet({ dataset, onClose }: { dataset: PackDatasetRef; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const built = dataset.builtAt
    ? new Date(dataset.builtAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const state = !built
    ? t('query.dataset.notBuilt')
    : dataset.stale ? t('query.dataset.stale') : t('query.dataset.upToDate');
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex flex-col gap-4">
        <SheetHeader>
          <SheetTitle className="break-all">{dataset.name}</SheetTitle>
          <SheetDescription>{t('query.dataset.description')}</SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">{t('query.dataset.owner')}</dt>
          <dd className="break-all">{dataset.ownerPack}</dd>
          <dt className="text-muted-foreground">{t('query.dataset.state')}</dt>
          <dd>{state}</dd>
          <dt className="text-muted-foreground">{t('query.dataset.rows')}</dt>
          <dd className="tabular-nums">{dataset.rowCount === null ? '-' : dataset.rowCount.toLocaleString(i18n.language)}</dd>
          <dt className="text-muted-foreground">{t('query.dataset.lastBuilt')}</dt>
          <dd>{built ?? '-'}</dd>
          <dt className="text-muted-foreground">{t('query.dataset.buildTime')}</dt>
          <dd className="tabular-nums">{dataset.buildMs === null ? '-' : t('query.dataset.seconds', { seconds: seconds(dataset.buildMs) })}</dd>
          {dataset.lastError && (
            <>
              <dt className="text-destructive">{t('query.dataset.lastError')}</dt>
              <dd className="break-words text-destructive">{dataset.lastError}</dd>
            </>
          )}
        </dl>
      </SheetContent>
    </Sheet>
  );
}
