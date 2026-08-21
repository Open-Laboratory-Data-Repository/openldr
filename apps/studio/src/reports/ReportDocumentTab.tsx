import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchReportPdf } from '../api';
import { PdfCanvasViewer } from './PdfCanvasViewer';

interface Props {
  reportId: string;
  params: Record<string, string>;
  /** Bumped by the page on every completed run, INCLUDING a refresh that re-ran with the very same
   *  parameters. Without it this tab's effect key is `reportId` plus the params, both identical
   *  across a refresh, so the document never re-fetched and the page kept showing the first run's
   *  PDF while the row query and the timestamp both moved on. */
  runSeq?: number;
  onDownload?: () => void;
}

export function ReportDocumentTab({ reportId, params, runSeq = 0, onDownload }: Props) {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  // Holds the thrown error's own message when it has one (e.g. the server's coded refusal
  // reason — RP0005 "no data for this report request"). `true` alone means "failed, no message
  // to show" — the render below falls back to the untranslated-but-generic pdfRenderError copy.
  const [error, setError] = useState<string | boolean>(false);
  const [loading, setLoading] = useState(true);
  // ⛔ `runSeq` is part of the key, not decoration. A refresh re-runs with the SAME parameters by
  // design, so everything else here is byte-identical between two runs and the effect would not
  // fire. Re-rendering for any other reason leaves `runSeq` alone and still costs no second fetch.
  const key = `${reportId}?${new URLSearchParams(params).toString()}#${runSeq}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setBlob(null);
    fetchReportPdf(reportId, params)
      .then((b) => {
        if (active) {
          setBlob(b);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          // Still logged for the technical detail (stack, cause). The message itself is now also
          // shown to the user when the server sent one (e.g. a coded refusal reason) — it's the
          // one thing that tells them "no such request" instead of "the renderer broke". Fall
          // back to the translated pdfRenderError below when there's no message to show (a
          // network failure, or any other rejection that isn't an Error with text).
          console.error('[reports] failed to render report PDF:', e);
          setError(e instanceof Error && e.message ? e.message : true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }
  if (error) {
    // The server's message (when we have one) is data from the API, not UI copy, so it is
    // shown as-is in whatever language the server sent it — not translated. That's a real
    // limitation: an operator on a non-English locale sees an English refusal reason here.
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-destructive">{typeof error === 'string' ? error : t('reports.pdfRenderError')}</p>
      </div>
    );
  }
  if (!blob) return null;
  return <PdfCanvasViewer blob={blob} fileName={`${reportId}.pdf`} onDownload={onDownload} />;
}
