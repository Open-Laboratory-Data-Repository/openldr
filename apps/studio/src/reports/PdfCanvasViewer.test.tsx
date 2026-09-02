import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise i18next so useTranslation() resolves

const getDocumentSpy = vi.fn();
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (opts: unknown) => (getDocumentSpy(opts), {
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 10, height: 10 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
    destroy: () => {},
  }),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker-url' }));

import { PdfCanvasViewer } from './PdfCanvasViewer';

describe('PdfCanvasViewer', () => {
  it('renders a toolbar with a download button', async () => {
    render(<PdfCanvasViewer blob={new Blob(['%PDF'])} fileName="r.pdf" />);
    expect(await screen.findByText(/download|télécharger|baixar/i)).toBeInTheDocument();
  });

  it('invokes onDownload when the download button is clicked', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const onDownload = vi.fn();
    render(<PdfCanvasViewer blob={new Blob(['%PDF'])} fileName="r.pdf" onDownload={onDownload} />);
    const btn = await screen.findByText(/download|télécharger|baixar/i);
    btn.click();
    expect(onDownload).toHaveBeenCalled();
  });
});

// ⛔ A report PDF references Helvetica and embeds nothing: without the standard font data pdfjs
// substitutes a fallback with the wrong metrics and every preview renders with the letters spaced
// apart. The directory is served by `pdfjsStandardFonts` in vite.config.ts; the trailing slash
// matters, because pdfjs appends the filename to it.
describe('PdfCanvasViewer standard fonts', () => {
  it('asks pdfjs for the standard font data directory', async () => {
    getDocumentSpy.mockClear();
    render(<PdfCanvasViewer blob={new Blob(['%PDF'])} fileName="r.pdf" />);
    // The toolbar renders before the blob is read, so wait on the CALL, not on the chrome.
    await waitFor(() => expect(getDocumentSpy).toHaveBeenCalled());
    expect(getDocumentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ standardFontDataUrl: expect.stringMatching(/standard_fonts\/$/) }),
    );
  });
});
