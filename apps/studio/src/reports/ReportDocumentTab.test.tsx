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
});
