import { useTranslation } from 'react-i18next';
import type { JobInterruption } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Says a long job was interrupted, and how each time it came back (design 2026-11-18-interrupted-jobs).
 *  Nothing for a job never interrupted. The tooltip lists every cut, oldest first. Continue is never
 *  here: it lives in the row's dots menu. */
export function InterruptionBadge({ interruptions }: { interruptions: JobInterruption[] | undefined }) {
  const { t } = useTranslation();
  if (!interruptions || interruptions.length === 0) return null;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
  const line = (r: JobInterruption) => {
    const at = when(r.at);
    if (r.resumedBy === 'self') return t('interruptions.carriedOn', { at, back: when(r.resumedAt) });
    if (r.resumedBy === 'person') return t('interruptions.continued', { at, back: when(r.resumedAt) });
    return t('interruptions.waiting', { at });
  };
  const waiting = interruptions.some((r) => r.resumedBy === null);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={waiting ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'}>
            {interruptions.length === 1 ? t('interruptions.badgeOnce') : t('interruptions.badgeMany', { count: interruptions.length })}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <ul className="space-y-1 text-xs">{interruptions.map((r) => <li key={r.id}>{line(r)}</li>)}</ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
