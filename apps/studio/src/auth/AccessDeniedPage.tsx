import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { StripedEmpty } from '@/components/ui/striped-empty';

export function AccessDeniedPage() {
  const { t } = useTranslation();
  return (
    <AppShell title={t('accessDenied.title')} fullBleed>
      <StripedEmpty className="min-h-0 flex-1">
        <div className="max-w-md space-y-3 px-6 py-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">{t('accessDenied.heading')}</h1>
          <p className="text-sm">{t('accessDenied.description')}</p>
        </div>
      </StripedEmpty>
    </AppShell>
  );
}
