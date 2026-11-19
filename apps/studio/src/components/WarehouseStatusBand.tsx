import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fetchWarehouseStatus, type WarehouseStatus } from '@/api';

/** While the warehouse is behind the numbers move, so ask often. Up to date, ask now and then. */
const BEHIND_MS = 5000;
const UP_TO_DATE_MS = 30000;

/** Seconds as hours and minutes, minutes, or "under a minute". */
export function timeLeftParts(seconds: number): { key: 'underMinute' | 'minutes' | 'hours'; hours: number; minutes: number } {
  if (seconds < 60) return { key: 'underMinute', hours: 0, minutes: 0 };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { key: 'minutes', hours: 0, minutes };
  return { key: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/**
 * How far the warehouse is behind the records saved. The dashboard and the reports read the
 * warehouse, so while it is behind they show less than was saved. During a large import that was
 * half of everything, with nothing on screen to say so.
 */
export function WarehouseStatusBand({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<WarehouseStatus | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next = UP_TO_DATE_MS;
      try {
        const s = await fetchWarehouseStatus();
        if (stopped) return;
        setStatus(s);
        if (s.behind > 0) next = BEHIND_MS;
      } catch {
        // A failed read keeps the last reading on screen. The next tick tries again.
      }
      if (!stopped) timer = setTimeout(() => { void tick(); }, next);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, []);

  if (!status) return null;
  const n = (v: number) => v.toLocaleString(i18n.language);
  const behind = status.behind > 0;

  let timeLeft: string;
  if (status.fallingBehind) timeLeft = t('activity.warehouse.fallingBehind');
  else if (status.secondsLeft === null) timeLeft = t('activity.warehouse.measuring');
  else {
    const p = timeLeftParts(status.secondsLeft);
    timeLeft = t(`activity.warehouse.left.${p.key}`, { hours: p.hours, minutes: p.minutes });
  }
  const upTo = status.oldestWaitingAt
    ? new Date(status.oldestWaitingAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div
      role="status"
      aria-label={t('activity.warehouse.label')}
      className={cn('flex flex-col gap-1 border-b border-border px-3 py-2 text-sm', className)}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden
          className={cn('h-2 w-2 shrink-0 rounded-full', behind ? 'bg-amber-500' : 'bg-emerald-500')}
        />
        <span className="font-medium">{t('activity.warehouse.label')}</span>
        <span>{behind ? t('activity.warehouse.behind', { changes: n(status.behind) }) : t('activity.warehouse.upToDate')}</span>
        {behind && <span className="font-medium">{timeLeft}</span>}
      </div>
      {behind && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-4 text-xs text-muted-foreground">
          {status.appliedPerSecond !== null && <span>{t('activity.warehouse.rate', { rate: n(status.appliedPerSecond) })}</span>}
          {upTo && <span>{t('activity.warehouse.shownUpTo', { when: upTo })}</span>}
        </div>
      )}
      {behind && <p className="pl-4 text-xs text-muted-foreground">{t('activity.warehouse.meaning')}</p>}
      {status.waitingRetry > 0 && (
        <p className="pl-4 text-xs text-muted-foreground">{t('activity.warehouse.waitingRetry', { count: status.waitingRetry, records: n(status.waitingRetry) })}</p>
      )}
    </div>
  );
}
