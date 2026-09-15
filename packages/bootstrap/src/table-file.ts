import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

// A table read from an uploaded CSV or Excel file: the header row and the rows under it, every cell
// as trimmed text. Generic on purpose: the test catalog import uses it first, and the facility import
// can move onto it (docs/superpowers/plans/2026-09-15-test-catalog-s3-import-export.md, decision 1).

export type TableFileFormat = 'csv' | 'xlsx';

export interface TableFile {
  headers: string[];
  /** Every row has exactly headers.length cells. */
  rows: string[][];
  /** The worksheet read from an Excel file. Null for CSV. */
  sheetName: string | null;
  /** How many worksheets the workbook holds. Only the first is read. 1 for CSV. */
  sheetCount: number;
}

export type TableFileRefusal = 'too_large' | 'not_xlsx' | 'unreadable' | 'empty' | 'too_many_rows';

export class TableFileError extends Error {
  constructor(message: string, public readonly reason: TableFileRefusal) {
    super(message);
    this.name = 'TableFileError';
  }
}

export interface TableFileLimits {
  maxBytes: number;
  /** Rows under the header. */
  maxRows: number;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function describeBytes(n: number): string {
  return n >= 1024 * 1024 ? `${n / 1024 / 1024} MB` : `${n} bytes`;
}

export function readTableFile(bytes: Uint8Array, format: TableFileFormat, limits: TableFileLimits): TableFile {
  if (bytes.length > limits.maxBytes) {
    throw new TableFileError(`The file is larger than ${describeBytes(limits.maxBytes)}, the limit.`, 'too_large');
  }
  const read = format === 'xlsx' ? readXlsx(bytes) : { records: readCsv(bytes), sheetName: null, sheetCount: 1 };
  const records = read.records.filter((r) => r.some((c) => c.trim() !== ''));
  if (records.length === 0) {
    throw new TableFileError(
      read.sheetName === null ? 'The file has no rows.' : `The worksheet "${read.sheetName}" has no rows.`,
      'empty',
    );
  }
  const [head, ...body] = records;
  if (body.length > limits.maxRows) {
    throw new TableFileError(`The file has ${body.length} rows under its header. The limit is ${limits.maxRows}.`, 'too_many_rows');
  }
  const headers = head.map((h) => h.trim());
  // Every row as long as the header: a short row reads as empty cells, never as missing ones.
  const rows = body.map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  return { headers, rows, sheetName: read.sheetName, sheetCount: read.sheetCount };
}

function readCsv(bytes: Uint8Array): string[][] {
  let text = Buffer.from(bytes).toString('utf8');
  // Excel saves "CSV UTF-8" with a byte order mark, which would otherwise glue onto the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return parseCsv(text, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  } catch (err) {
    throw new TableFileError(`The CSV file could not be read: ${err instanceof Error ? err.message : String(err)}`, 'unreadable');
  }
}

function readXlsx(bytes: Uint8Array): { records: string[][]; sheetName: string; sheetCount: number } {
  if (!ZIP_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new TableFileError('The file is not an Excel workbook (.xlsx).', 'not_xlsx');
  }
  let book: XLSX.WorkBook;
  try {
    // A Buffer view over the same memory: SheetJS's 'buffer' type expects a Node Buffer, and a caller
    // may hand over a plain Uint8Array.
    book = XLSX.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      type: 'buffer',
      sheets: 0, // parse the first worksheet only; SheetNames still lists them all
      dense: true,
      cellDates: true,
      cellNF: true, // keeps each cell's number format, which tells General apart from 000000
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
  } catch (err) {
    throw new TableFileError(`The Excel workbook could not be read: ${err instanceof Error ? err.message : String(err)}`, 'unreadable');
  }
  const sheetName = book.SheetNames[0];
  const sheet = sheetName === undefined ? undefined : book.Sheets[sheetName];
  if (sheetName === undefined || !sheet) throw new TableFileError('The Excel workbook has no worksheets.', 'unreadable');

  // ⛔ SheetJS reads the text Excel DISPLAYS. "General" displays a 15-digit number as 1.23457E+14,
  // which would rewrite a code on the way in. So a General number takes its stored value, and a number
  // with a format of its own (000000, a date) keeps the text the operator sees.
  for (const row of sheet['!data'] ?? []) {
    for (const cell of row ?? []) {
      if (cell?.t === 'n' && (cell.z === undefined || cell.z === 'General')) cell.w = String(cell.v);
    }
  }
  const records = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  return {
    records: records.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    sheetName,
    sheetCount: book.SheetNames.length,
  };
}
