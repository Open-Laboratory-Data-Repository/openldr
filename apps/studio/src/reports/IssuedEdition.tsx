import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { LoadingState } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/api';

interface Edition {
  id: string;
  version: number;
  earlierVersion: boolean;
  edition?: number;
  title: string;
  issued: string;
  status: string;
  accession: string | null;
  reviewer?: string;
  narrative?: string;
  readings: Array<{ name: string; value: string; interpretation?: string; range?: string }>;
}
export function IssuedEdition() {
  const { plugin = '', edition = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Edition | null>(null),
    [error, setError] = useState<'missing' | 'failed' | null>(null),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    void authFetch('/api/reports/issued/' + encodeURIComponent(plugin) + '/' + encodeURIComponent(edition), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (!controller.signal.aborted)
            setError([401, 403, 404].includes(response.status) ? 'missing' : 'failed');
          return;
        }
        const body: Edition = await response.json();
        if (!controller.signal.aborted) setData(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('failed');
      });
    return () => controller.abort();
  }, [plugin, edition, attempt]);
  const facts = data
    ? [
        [t('issued.accession'), data.accession],
        [t('issued.edition'), data.edition],
        [t('issued.issued'), new Date(data.issued).toLocaleString(i18n.language)],
        [t('issued.reviewer'), data.reviewer],
      ]
    : [];
  return (
    <AppShell title={t('nav.reports')} fullBleed>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b px-4 py-2">
          <Button asChild size="sm" variant="ghost">
            <Link to={'/x/' + encodeURIComponent(plugin) + '?edition=' + encodeURIComponent(edition)}>
              <ArrowLeft className="size-4" />
              {t('issued.back')}
            </Link>
          </Button>
        </div>
        {error ? (
          <section className="p-5" role="status">
            {t('issued.' + error)}{' '}
            {error === 'failed' && (
              <Button variant="outline" onClick={() => retry(attempt + 1)}>
                {t('issued.retry')}
              </Button>
            )}
          </section>
        ) : !data ? (
          <LoadingState />
        ) : (
          <article>
            <header className="border-b p-5">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold">{data.title}</h1>
                <Badge variant="outline">{t('issued.' + data.status)}</Badge>
                {data.earlierVersion && <Badge variant="secondary">{t('issued.earlier')}</Badge>}
              </div>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
                {facts
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
            </header>
            <h2 className="border-b px-5 py-3 font-semibold">{t('issued.results')}</h2>
            <dl>
              {data.readings.map((v, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-1 border-b px-5 py-3 text-sm sm:grid-cols-[minmax(7rem,14rem)_minmax(0,1fr)] sm:gap-3"
                >
                  <dt>{v.name}</dt>
                  <dd className="m-0 min-w-0 break-words">
                    <strong>{v.value}</strong>
                    {v.range && (
                      <p>
                        {t('issued.range')} · {v.range}
                      </p>
                    )}
                    {v.interpretation && <p>{v.interpretation}</p>}
                  </dd>
                </div>
              ))}
            </dl>
            {data.narrative &&
              data.narrative !== data.readings.map((v) => v.name + ': ' + v.value).join('\n') && (
                <ul className="mx-5 my-4 list-disc pl-4 text-sm">
                  <li className="whitespace-pre-wrap break-words">{data.narrative}</li>
                </ul>
              )}
            <footer className="border-t p-5 text-xs text-muted-foreground">
              <span>
                DiagnosticReport · {t('issued.version')} {data.version}
              </span>
              <code className="mt-1 block break-all">{data.id}</code>
            </footer>
          </article>
        )}
      </div>
    </AppShell>
  );
}
