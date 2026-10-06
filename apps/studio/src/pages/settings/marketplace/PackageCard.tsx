import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { SignatureBadge } from './SignatureBadge';
import { packFailureText, type CardEntry } from './util';

export function PackageCard({ entry, onClick }: { entry: CardEntry; onClick: () => void }) {
  const { t } = useTranslation();
  // A failed pack shows its red failure line below, never a green Active badge beside it.
  const failedPack = entry.type === 'content-pack' && entry.status === 'failed';
  const stateBadge = failedPack ? null : entry.installed
    ? (entry.active
        ? <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.active')}</Badge>
        : <Badge variant="outline">{t('settings.marketplace.installed')}</Badge>)
    : <Badge variant="outline" className="opacity-70">{t('settings.marketplace.install')}</Badge>;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`card-${entry.ref ?? entry.id}`}
      className="w-full rounded-md border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug text-foreground">{entry.id}</span>
        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{entry.type}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {(entry.publisher?.name || '—')} · v{entry.version}
      </p>
      {entry.description ? (
        <p className="mt-1 line-clamp-2 text-xs text-foreground/70">{entry.description}</p>
      ) : null}
      {entry.registryName ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground" data-testid="card-registry-source">
          {t('settings.marketplace.registrySource', { name: entry.registryName })}
        </p>
      ) : null}
      {entry.type === 'content-pack' && entry.status ? (
        <p
          data-testid="card-pack-status"
          title={entry.status === 'failed' ? packFailureText(t, entry.failedStep, entry.error) : undefined}
          className={`mt-1 truncate text-xs ${entry.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {entry.status === 'failed' ? packFailureText(t, entry.failedStep, entry.error) : t('settings.marketplace.installed')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stateBadge}
        {entry.ref ? <SignatureBadge valid={entry.valid} invalidReason={entry.invalidReason} publisher={entry.publisher} /> : null}
      </div>
    </button>
  );
}
