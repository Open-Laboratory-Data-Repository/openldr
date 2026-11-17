import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, MoreHorizontal, TriangleAlert, XCircle } from 'lucide-react';
import type { MapTestResult } from '@/api';
import { LoadingState } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { GeneratedFhirSheet } from './GeneratedFhirSheet';
import { reasonText } from './reasonText';
import type { RowDraft } from './rows';

export type TestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; results: MapTestResult[] } | { kind: 'failed'; message: string };

/**
 * Per sample row: the record types and "passes", or the server's reason in the sheet's labels. A
 * reason names fields and paths only, never a value. Shown inline, never in a toast.
 */
export function TestResults({ state, drafts }: { state: TestState; drafts: RowDraft[] }) {
  const { t } = useTranslation();
  const P = 'workflows.mapToFhir.sheet';
  const [preview, setPreview] = useState<{ row: number; resources: unknown[] } | null>(null);
  useEffect(() => { setPreview(null); }, [state]);
  if (state.kind === 'idle') return null;
  if (state.kind === 'running') return <LoadingState label={t(`${P}.testing`)} className="h-16" />;
  if (state.kind === 'failed') {
    return <p className="px-6 py-3 text-xs text-destructive">{t(`${P}.testFailed`, { message: state.message })}</p>;
  }
  return (
    <>
      <ul className="space-y-1.5 px-6 py-3 text-xs" data-testid="map-test-results">
        {state.results.map((r, i) => (
          <li key={i} className="flex min-w-0 items-start gap-2">
            {r.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
            )}
            <span className="shrink-0 font-medium text-foreground">{t(`${P}.testRow`, { n: i + 1 })}</span>
            <div className="min-w-0 flex-1">
              <span className="break-words text-muted-foreground">
                {r.ok ? `${r.resourceTypes.join(', ')} ${t(`${P}.passes`)}` : reasonText(r.reason, r.field, drafts, t(`${P}.addValuesRule`))}
              </span>
              {/* What the row held that is not stored: a nested column, or a unit with no number. */}
              {r.ok && r.notes && r.notes.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {r.notes.map((n) => (
                    <li key={n} className="flex min-w-0 items-start gap-1.5 text-amber-500" data-testid="map-test-note">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {r.ok && r.resources.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`${t(`${P}.rowActions`)}: ${t(`${P}.testRow`, { n: i + 1 })}`}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setPreview({ row: i + 1, resources: r.resources })}>
                    {t(`${P}.viewGenerated`)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
      <GeneratedFhirSheet preview={preview} onClose={() => setPreview(null)} />
    </>
  );
}
