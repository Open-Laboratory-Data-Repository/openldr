import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { parse as parseCsvStream } from 'csv-parse';

export interface FileRowWindow {
  headers: string[];
  rows: string[][];
  /** The FILE LINE each entry in `rows` came from, 1-based, same order and same length. Read off
   *  `csv-parse`'s own `info.lines`, which is the number `parseFacilityCsv` quarantines by
   *  (facility-csv.ts) and the number a cell edit is keyed on. NOT `offset + index + 2`: one quoted
   *  field containing a newline puts every later row on a line that arithmetic cannot reach. */
  lines: number[];
  /** Every data row the stream yielded. The stream is always drained, so this is the file's true
   *  row count, which is what the caller needs to paginate. */
  scanned: number;
  /** 1-based line numbers of lines that could not be read at all, capped at
   *  `SKIPPED_LINES_REPORTED`. Empty for a clean file. Only JSONL can produce these: a CSV row is
   *  never unreadable here (see `readCsvRows`). */
  skippedLines: number[];
  /** How many lines were skipped in total, which can exceed `skippedLines.length`. */
  skipped: number;
}

export interface ReadFileRowsOptions {
  format: 'csv' | 'jsonl';
  offset: number;
  limit: number;
}

/** How many skipped line numbers are named back to the operator. A file with 3 000 bad lines has
 *  one problem, not 3 000, and the count says how big it is. */
const SKIPPED_LINES_REPORTED = 20;

/**
 * The file could not be read far enough to answer at all, as opposed to one line inside it that
 * could not. Carries the line number when the parser knew it, so the message names the operator's
 * own file rather than something vague.
 *
 * ⛔ THE CALLER MUST TURN THIS INTO A 4xx, NOT A 500. The reason it exists is that the studio's Data
 * step reported an unhandled throw as "check the connection", sending an operator to look at their
 * network for a bad line in their CSV.
 */
export class FacilityFileUnreadableError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null) {
    super(message);
    this.name = 'FacilityFileUnreadableError';
    this.line = line;
  }
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * ⛔ A REAL CSV PARSE, and `csv-parse` is the same library the authoritative `parseFacilityCsv`
 * uses. It was a `line.split(',')` and that is not a CSV reader: `1,"Clinic, Lusaka"` came back as
 * three cells, every cell right of the quoted comma shifted, and the quotes rendered literally. An
 * embedded newline inside a quoted field counted as two rows, so the pager's `total` disagreed with
 * what the validate found in the same file.
 *
 * ⚠ STILL A VIEW, NOT THE AUTHORITATIVE PARSE. `parseFacilityCsv` decides what gets imported, and
 * it applies a column map, a contract and a quarantine this does not. The options below match its
 * own so the two at least agree about where a cell ends.
 *
 * ⛔ STREAMING, NOT `csv-parse/sync`. The sync entry point takes the whole file as one string, which
 * is exactly the 64MB-in-the-API's-memory this route's `getStream` exists to avoid. The parser is a
 * transform, so the file goes through it a chunk at a time and only the window on screen is kept.
 *
 * ⛔ `relax_column_count`, for the same reason `parseFacilityCsv` sets it: one unescaped comma must
 * not kill the view of a 14 000-row national register. `parseFacilityCsv` is where a ragged row
 * gets quarantined and reported; here it is simply shown as it parsed.
 */
async function readCsvRows(
  stream: Readable,
  offset: number,
  limit: number,
): Promise<{ headers: string[]; rows: string[][]; lines: number[]; scanned: number }> {
  const parser = stream.pipe(parseCsvStream({
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    // The record's true file line. Everything else here is unchanged; `info: true` only changes the
    // SHAPE of what the iterator yields, from `string[]` to `{ record, info }`.
    info: true,
  }));

  let headers: string[] = [];
  const rows: string[][] = [];
  const lines: number[] = [];
  let scanned = 0;
  let first = true;

  try {
    for await (const entry of parser as AsyncIterable<{ record: string[]; info: { lines: number } }>) {
      const record = entry.record;
      if (first) {
        headers = record.map((h, i) => (i === 0 ? stripBom(h) : h));
        first = false;
        continue;
      }
      if (scanned >= offset && rows.length < limit) {
        rows.push(record);
        lines.push(entry.info.lines);
      }
      scanned += 1;
    }
  } catch (err) {
    // `csv-parse` puts the offending line on the error. `relax_quotes` and `relax_column_count`
    // between them leave very little that can still throw, which is why this is a refusal that
    // names the line rather than a skip: whatever reaches here is not a row-shaped problem.
    const line = (err as { lines?: number }).lines;
    throw new FacilityFileUnreadableError(
      `this file could not be read as CSV${typeof line === 'number' ? ` at line ${line}` : ''}: `
      + `${err instanceof Error ? err.message : String(err)}`,
      typeof line === 'number' ? line : null,
    );
  }

  return { headers, rows, lines, scanned };
}

/**
 * ⛔ EVERY `JSON.parse` HERE IS GUARDED, and the guard is newly load-bearing: Source now STORES the
 * file without parsing it, so a line that is not JSON reaches this reader for the first time. It
 * used to throw, the route answered 500, and the studio told the operator to check their network
 * connection.
 *
 * A line that parses to something other than an object (an array, a string, `null`) is the same
 * defect one step further on: it threw at `Object.keys` instead. Both are skipped and counted.
 *
 * ⛔ SKIP AND REPORT, not fail. One bad line in a 3 788-line release must not hide the other 3 787
 * from the operator who has to find it. The count and the line numbers travel back with the window
 * so the studio can say which lines, and say that it is the file.
 */
function readJsonlLine(
  line: string,
  headers: string[],
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
  return obj;
}

export async function readFileRows(
  stream: Readable,
  { format, offset, limit }: ReadFileRowsOptions,
): Promise<FileRowWindow> {
  if (format === 'csv') {
    const w = await readCsvRows(stream, offset, limit);
    return { ...w, skippedLines: [], skipped: 0 };
  }

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const headers: string[] = [];
  const rows: string[][] = [];
  const lines: number[] = [];
  const skippedLines: number[] = [];
  let scanned = 0;
  let skipped = 0;
  let lineNumber = 0;
  let first = true;

  for await (const raw of rl) {
    lineNumber += 1;
    const line = first ? stripBom(raw) : raw;
    first = false;
    if (line.trim() === '') continue;
    const obj = readJsonlLine(line, headers);
    if (obj === null) {
      skipped += 1;
      if (skippedLines.length < SKIPPED_LINES_REPORTED) skippedLines.push(lineNumber);
      continue;
    }
    if (scanned >= offset && rows.length < limit) {
      rows.push(headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))));
      lines.push(lineNumber);
    }
    scanned += 1;
  }
  rl.close();
  return { headers, rows, lines, scanned, skippedLines, skipped };
}
