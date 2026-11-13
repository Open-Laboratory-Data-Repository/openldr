import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { loadSampleData } from '@/api';

/** Step 2: load sample data, or skip. FirstRunPage shows it only when the server allows a load. */
export function SampleDataStep({ onNext }: { onNext: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      await loadSampleData();
    } catch (err) {
      setMessage(t('firstRun.sample.failed', { error: err instanceof Error ? err.message : String(err) }));
      setLoading(false);
      return;
    }
    onNext();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('firstRun.sample.title')}</h1>
      <p className="text-muted-foreground">{t('firstRun.sample.intro')}</p>
      {loading && <LoadingState className="min-h-[6rem]" label={t('firstRun.sample.loading')} />}
      {message && <p role="alert" className="break-words text-destructive">{message}</p>}
      <Button type="button" disabled={loading} onClick={() => { void load(); }}>{t('firstRun.sample.load')}</Button>
      <Button type="button" variant="ghost" disabled={loading} onClick={onNext}>{t('firstRun.skip')}</Button>
    </div>
  );
}
