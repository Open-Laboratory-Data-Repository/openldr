import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import type { SetupCheck, SetupStatus } from '@/api';
import { cn } from '@/lib/cn';

const ICON: Record<SetupStatus, JSX.Element> = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />,
  fail: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />,
  skip: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />,
};

// The page each fix path opens, by its sub-nav or sidebar label.
const FIX_LABEL: Record<string, string> = {
  '/facilities': 'nav.facilities',
  '/settings/laboratory': 'settings.subNav.laboratory',
  '/settings/connectors': 'settings.subNav.connectors',
  '/settings/sync': 'settings.subNav.sync',
};

/**
 * One setup check as a list item: its status icon, title, detail, advice and a link to the page
 * that fixes it. Settings, Setup checks and the first-run flow both render it inside an `<ol>`.
 * `onOpen` runs when the person follows the link. `className` replaces the side padding when the
 * list sits in a box with other padding.
 */
export function SetupCheckRow({ check, onOpen, className }: {
  check: SetupCheck;
  onOpen?: () => void;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <li className={cn('flex gap-3 px-4 py-3', className)} data-testid={`setup-check-${check.id}`} data-status={check.status}>
      <span className="mt-0.5" aria-label={t(`settings.setup.status.${check.status}`)}>{ICON[check.status]}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t(`settings.setup.check.${check.id}`)}</div>
        {check.detail ? <div className="break-words text-muted-foreground">{check.detail}</div> : null}
        {check.hint ? (
          <div className="mt-1 break-words" data-testid={`setup-hint-${check.id}`}>
            {t(`settings.setup.hint.${check.hint}`)}
          </div>
        ) : null}
        {check.fix ? (
          <Link
            to={check.fix}
            onClick={onOpen}
            className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline"
            data-testid={`setup-fix-${check.id}`}
          >
            {t('settings.setup.open', { page: t(FIX_LABEL[check.fix] ?? 'settings.title') })}
          </Link>
        ) : null}
      </div>
      <span className="shrink-0 text-muted-foreground">{t(`settings.setup.status.${check.status}`)}</span>
    </li>
  );
}
