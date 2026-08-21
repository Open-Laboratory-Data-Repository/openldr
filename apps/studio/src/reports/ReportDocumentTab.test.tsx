import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const fetchReportPdf = vi.fn(async () => new Blob(['%PDF']));
vi.mock('./PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));
vi.mock('../api', () => ({ fetchReportPdf: (...args: unknown[]) => fetchReportPdf(...(args as [])) }));

import { ReportDocumentTab } from './ReportDocumentTab';

describe('ReportDocumentTab', () => {
  it('fetches the PDF and renders the viewer', async () => {
    render(<ReportDocumentTab reportId="amr-resistance" params={{ from: '2026-01-01' }} />);
    expect(await screen.findByText('pdf-viewer')).toBeInTheDocument();
  });

  // Regression: fetchReportPdf now carries the server's refusal reason (e.g. "no data for this
  // report request" for RP0005) instead of a bare status. The tab must show that reason, not the
  // generic pdfRenderError fallback, or the coded refusal is invisible to the clinician.
  it('shows the thrown error message when the PDF request is rejected with one', async () => {
    fetchReportPdf.mockRejectedValueOnce(new Error('report pdf r-x failed: no data for this report request · RP0005'));
    render(<ReportDocumentTab reportId="r-x" params={{}} />);
    expect(await screen.findByText('report pdf r-x failed: no data for this report request · RP0005')).toBeInTheDocument();
  });

  it('falls back to the translated pdfRenderError when the rejection has no message', async () => {
    fetchReportPdf.mockRejectedValueOnce(new Error());
    render(<ReportDocumentTab reportId="r-y" params={{}} />);
    expect(await screen.findByText('Could not render the PDF.')).toBeInTheDocument();
  });

  // ⛔ THE refresh defect, reported 2026-08-21. Refresh re-runs a report with the SAME parameters
  // on purpose, so `reportId` and every param are byte-identical between the two runs. This tab
  // keyed its effect on exactly those, so the second run never re-fetched and the document on
  // screen stayed the one from the first. The row query re-ran, the timestamp moved, and the page
  // showed the same PDF: "refresh doesn't seem to do anything", which was accurate.
  it('re-fetches on a new run even when the parameters have not changed', async () => {
    fetchReportPdf.mockClear();
    const params = { month: '2018-08' };
    const { rerender } = render(<ReportDocumentTab reportId="r-tg" params={params} runSeq={1} />);
    expect(await screen.findByText('pdf-viewer')).toBeInTheDocument();
    expect(fetchReportPdf).toHaveBeenCalledTimes(1);

    // The same params OBJECT, as `handleRefresh` passes: only the run counter moves.
    rerender(<ReportDocumentTab reportId="r-tg" params={params} runSeq={2} />);
    expect(await screen.findByText('pdf-viewer')).toBeInTheDocument();
    expect(fetchReportPdf).toHaveBeenCalledTimes(2);
  });

  it('does not re-fetch when nothing about the run changed', async () => {
    // The other half: a re-render for any other reason (a parent state change, a resize) must not
    // spend a second PDF render on the server.
    fetchReportPdf.mockClear();
    const params = { month: '2018-08' };
    const { rerender } = render(<ReportDocumentTab reportId="r-tg" params={params} runSeq={7} />);
    expect(await screen.findByText('pdf-viewer')).toBeInTheDocument();
    rerender(<ReportDocumentTab reportId="r-tg" params={{ month: '2018-08' }} runSeq={7} />);
    expect(fetchReportPdf).toHaveBeenCalledTimes(1);
  });
});
