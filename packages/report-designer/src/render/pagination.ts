/**
 * The pagination math, reachable WITHOUT pdfkit.
 *
 * `render/draw.ts` computes chunk counts, flow positions and row capacity from schema fields and
 * resolved rows alone — its only pdfkit tie is the ambient `PDFKit.PDFDocument` TYPE, which the
 * compiler erases. The runtime pdfkit import lives solely in `render/index.ts`. This module is the
 * browser-safe doorway to that math: the studio's page strip and break lines must count pages with
 * the SAME arithmetic the renderer draws with, or the two drift apart one row at a time.
 *
 * ⛔ Re-export only measurement here, never drawing. A `drawX` function is runtime-clean today,
 * but exporting it through `/pure` would invite the studio to call renderer internals.
 */

/** A bound element's resolved data: the query's columns and rows, or the error that replaced them.
 *  Lives here (not in the pdfkit barrel) so browser code can name the type; `render/index.ts`
 *  re-exports it, so existing imports keep working. */
export type ResolvedTable =
  | { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
  | { error: string };

export {
  pageChunkCount, totalPhysicalPages, elementChunkCount, drawsOnChunk, resolveFlowY,
  rowsFor, maxRowsFor, ROW_H, headerBandHeight,
} from './draw';
export { cellGridRowSchedule, cellGridMaxRows, cellGridChunkStart, CELL_HEAD_H, CELL_ROW_H } from './cellgrid';
// The unit converters ride along: every consumer of this math needs them, and capacity computed
// in px@96 against these point constants is the exact bug the px-vs-pt memory documents.
export { toPt, PX_TO_PT, paperSizePt } from './units';
