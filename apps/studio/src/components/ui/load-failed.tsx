import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';

/**
 * What a list shows when its load failed. Plain muted text, no stripes: stripes mean empty, and a
 * failed load is not empty. The reason goes in a toast (useLoadErrorToast).
 */
export function LoadFailed({ className, message, detail }: {
  className?: string;
  /** Words for what failed, when it is not a list. Defaults to common.loadFailed. */
  message?: string;
  /** A second muted line, such as the server's reason, kept after the toast closes. */
  detail?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex min-h-[16rem] flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground', className)}>
      <p className="m-0">{message ?? t('common.loadFailed')}</p>
      {detail ? <p className="m-0 break-all font-mono text-[11px] leading-snug">{detail}</p> : null}
    </div>
  );
}

/**
 * What a list shows above its rows when a reload failed but the rows from the last good load are
 * still there. The rows stay, since they are what the person last saw; this line says they may be
 * out of date, so a toast that has closed is not the only sign.
 */
export function LoadStale({ className }: { className?: string }) {
  const { t } = useTranslation();
  return <p className={cn('m-0 px-6 py-2 text-xs text-muted-foreground', className)}>{t('common.loadStale')}</p>;
}

/**
 * Shows a load error as a toast, once. The same message again does not toast again, so a list
 * that reloads on every filter or page change toasts one failure once. A null error (a load that
 * worked) clears it, so a later failure toasts again.
 *
 * With a title, the title is the toast and the error is its description.
 */
export function useLoadErrorToast(error: string | null | undefined, title?: string) {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!error) { shown.current = null; return; }
    if (error === shown.current) return;
    shown.current = error;
    if (title) toast.error(title, { description: error });
    else toast.error(error);
  }, [error, title]);
}
