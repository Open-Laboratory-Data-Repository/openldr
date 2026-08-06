import PDFDocument from 'pdfkit';
import type { ReportDesign } from '../schema';
import { paperSizePt } from './units';
import { drawElement, paramMap, pageChunkCount, totalPhysicalPages, drawPageFooter } from './draw';

export type ResolvedTable =
  | { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
  | { error: string };

export { resolveDesignTables, type RunQuery } from './resolve';

// Widened to the package boundary for `@openldr/reporting`'s seed tests: a seeded design's keyvalue
// panel has a FIXED box, and pairs past its bottom are clipped by the drawer rather than
// overflowing — so a panel that has run out of room fails silently at render time. Exporting the
// geometry lets the seed that owns the panel assert its own capacity.
export { pairRects, type PairBox } from './draw';

export interface RenderOptions {
  now?: Date;
  /**
   * The issuing laboratory's identity, keyed WITHOUT the `lab.` prefix (`name`, `address`,
   * `contact`, `logo`) — reachable from a design as `{{lab.name}}` and friends.
   *
   * Supplied by the CALLER because this package is pure and has no database reach: the server's
   * preview route and bootstrap's export path each load it and pass it in. Omitted, every
   * `{{lab.*}}` resolves to '' and a design referencing identity still renders.
   */
  identity?: Record<string, string>;
}

export function renderReportDesignPdf(
  design: ReportDesign,
  resolved: Map<string, ResolvedTable>,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const now = opts.now ?? new Date();
  const tokens = paramMap(design, now, opts.identity);
  const pages = design.pages.length ? design.pages : [{ id: '_empty', elements: [] }];
  const [w, h] = paperSizePt(design.paper, design.orientation);

  const doc = new PDFDocument({ size: [w, h], margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const total = totalPhysicalPages(pages, resolved);
  let physical = 0;
  for (const page of pages) {
    const pageCount = pageChunkCount(page, resolved);
    for (let c = 0; c < pageCount; c += 1) {
      doc.addPage({ size: [w, h], margin: 0 });
      physical += 1;
      for (const el of page.elements) drawElement(doc, el, tokens, resolved.get(el.id), c);
      if (design.pageNumbers) drawPageFooter(doc, w, h, physical, total);
    }
  }
  doc.end();
  return done;
}
