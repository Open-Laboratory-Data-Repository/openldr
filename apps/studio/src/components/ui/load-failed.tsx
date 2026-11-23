import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';

/**
 * What a list shows when its load failed. Plain muted text, no stripes: stripes mean empty, and a
 * failed load is not empty. The reason goes in a toast (useLoadErrorToast).
 */
export function LoadFailed({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground', className)}>
      {t('common.loadFailed')}
    </div>
  );
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
