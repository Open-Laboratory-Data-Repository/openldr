import PDFDocument from 'pdfkit';
import type { ReportDesign } from '../schema';
import { paperSizePt } from './units';
import { resolveGroups } from '../groups';
import { resolveI18n } from '../i18n';
import { drawElement, paramMap, pageChunkCount, totalPhysicalPages, drawPageFooter, drawsOnChunk, resolveFlowY } from './draw';

// Moved to ./pagination so browser code can name the type without this pdfkit entry point;
// re-exported here so every existing import keeps working.
import type { ResolvedTable } from './pagination';
export type { ResolvedTable } from './pagination';

export { resolveDesignTables, type RunQuery } from './resolve';

// Widened to the package boundary for `@openldr/reporting`'s seed tests: a seeded design's keyvalue
// panel has a FIXED box, and pairs past its bottom are clipped by the drawer rather than
// overflowing — so a panel that has run out of room fails silently at render time. Exporting the
// geometry lets the seed that owns the panel assert its own capacity.
export { pairRects, type PairBox } from './draw';

// Exported alongside `pairRects` because the two are only meaningful TOGETHER: `drawElement`
// converts a design rect px@96 -> pt before handing it to `pairRects`, whose KV_* constants are
// raw POINTS. A caller that measures a panel's capacity using the unconverted rect mixes two
// scales and silently computes a row too many — the exact error that shipped a clipped row.
export { toPt, PX_TO_PT } from './units';

// Exported for the same reason as `toPt`/`PX_TO_PT`: a seed that lays out page-relative elements
// (a footer pinned near the bottom edge) needs the SAME page-size math this renderer uses, not a
// hardcoded A4-portrait number — that hardcoding is exactly what shipped a footer off the bottom
// of the two Letter/landscape seeded designs.
export { paperSizePt } from './units';

// Exported for the same reason as pairRects above: a seed that binds a cellgrid needs to assert
// its OWN declared geometry fits the page it is authored for, using the same arithmetic the
// renderer itself uses rather than a hand-copied number that can drift out of sync with it.
export { cellGridWidth, CELL_LABEL_W } from './cellgrid';

// Same reason again, for the VERTICAL direction. A seeded design that puts a cellgrid in a fixed
// band has to prove the band holds the tallest result that design can produce, and a hand-copied
// row pitch drifts the moment the renderer's own changes.
export { cellGridMaxRows, CELL_HEAD_H, CELL_ROW_H } from './cellgrid';

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
  /** The RUN's parameter values. Supplied by the caller because the renderer is handed the stored
   *  design, whose `parameters[].value` are the AUTHORED DEFAULTS — a header built from those
   *  describes the design rather than the run it is printed from. */
  values?: Record<string, unknown>;
  /** Language to PRINT in (`fr`, `pt`, …). Applied to the design's own `i18n` overrides before
   *  anything draws; an absent language, or one the design has no entries for, prints the authored
   *  text. Supplied by the caller the same way `identity` and `values` are. */
  lang?: string;
}

export function renderReportDesignPdf(
  rawDesign: ReportDesign,
  resolved: Map<string, ResolvedTable>,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const now = opts.now ?? new Date();
  // ⛔ Translations resolved FIRST, before tokens or pages. Everything below works on an ordinary
  // design whose text happens to be in the run's language, so no drawing code knows languages
  // exist — the same discipline `resolveGroups` follows on the next line.
  const design = resolveI18n(rawDesign, opts.lang);
  const tokens = paramMap(design, now, opts.identity, opts.values, opts.lang);
  // ⛔ Groups resolved ONCE, here, before anything counts or draws. Downstream every function sees
  // plain `hidden`/`locked` element flags and needs no knowledge of groups — which is what stops
  // the chunk count and the drawing loop from ever disagreeing about a hidden group.
  const pages = (design.pages.length ? design.pages : [{ id: '_empty', elements: [] }]).map(resolveGroups);
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
      // ⛔ `drawsOnChunk` FIRST. A page runs as long as its longest table, so on the last pages the
      // shorter tables have no rows left — and a table drawn with an empty slice still paints its
      // header band, its rules and its box. Under a heading, that empty frame reads as "nothing was
      // submitted" rather than "this grid finished earlier".
      for (const el of page.elements) {
        if (!drawsOnChunk(el, page, resolved, c)) continue;
        const y = resolveFlowY(el, page, resolved, c);
        // The page context goes with it: `fillTo` needs the same view of the page the chunk count
        // was computed from, or the drawer and the counter would answer differently.
        drawElement(doc, el, tokens, resolved.get(el.id), c, y, { page, resolved });
      }
      if (design.pageNumbers) drawPageFooter(doc, w, h, physical, total);
      // Painted LAST so nothing covers it: a printed draft used to be indistinguishable from a
      // published report. DRAFT is process vocabulary, not clinical, so the literal is allowed
      // here; a lab wanting other words is a future design field, not a config today.
      if (design.status === 'draft') drawDraftWatermark(doc, w, h);
    }
  }
  doc.end();
  return done;
}

/** One diagonal low-opacity DRAFT per physical page. Stroked, not filled, so the page under it
 *  stays readable even where the letters cross dense content. */
function drawDraftWatermark(doc: InstanceType<typeof PDFDocument> | typeof PDFDocument, w: number, h: number): void {
  const d = doc as typeof PDFDocument;
  d.save();
  d.rotate(-30, { origin: [w / 2, h / 2] });
  d.font('Helvetica-Bold').fontSize(96).opacity(0.12).fillColor('#b4540a')
    .text('DRAFT', 0, h / 2 - 48, { width: w, align: 'center' });
  d.opacity(1);
  d.restore();
}
