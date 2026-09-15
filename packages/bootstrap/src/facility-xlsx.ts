import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

/** The largest Excel workbook the facility import reads.
 *
 *  ⛔ SMALLER THAN THE CSV CEILING ON PURPOSE. A CSV streams (`FACILITY_IMPORT_MAX_UPLOAD_BYTES`,
 *  64 MiB by default). A workbook is a ZIP, and SheetJS reads the whole of it into memory before it
 *  can hand back a single row. MEASURED 2026-09-15, SheetJS 0.20.3, first sheet only: a 13 000-row
 *  register is 4.3 MB and parses in 0.6 s with about 70 MB of extra memory; 100 000 rows is 33.5 MB,
 *  3.9 s and about 175 MB. So this cap is roughly 60 000 rows.
 *
 *  ⚠ It bounds the COMPRESSED size only. A workbook crafted to inflate far beyond its size is not
 *  caught here. Deferred by the operator on 2026-09-15: the upload needs `facilities.manage`, and no
 *  real register comes near it. */
export const FACILITY_IMPORT_MAX_XLSX_BYTES = 20 * 1024 * 1024;

export type FacilityXlsxRefusal = 'too_large' | 'not_xlsx' | 'unreadable' | 'empty_sheet';

/** A workbook the facility import will not read. `too_large` is the caller's 413; the rest are 400s,
 *  because each one is a fact about the operator's own file. */
export class FacilityXlsxError extends Error {
  readonly reason: FacilityXlsxRefusal;

  constructor(reason: FacilityXlsxRefusal, message: string) {
    super(message);
    this.name = 'FacilityXlsxError';
    this.reason = reason;
  }
}

export interface FacilityXlsxCsv {
  /** The first worksheet as CSV text, header row first. */
  csv: string;
  /** The header row, each name trimmed and blank ones left out. The same rule the `suggest-map`
   *  route applies to a CSV's first line, so the Mapping step lists a workbook's columns the way it
   *  lists a CSV's. */
  headers: string[];
  sheetName: string;
  /** Every sheet in the workbook, so a caller can say that only the first was read. */
  sheetCount: number;
}

/** Every XLSX file starts with a ZIP local-file header. Checked before SheetJS sees the bytes:
 *  SheetJS also reads plain text, so without this a CSV sent as `format=xlsx` would "convert". */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** The refusal for a workbook over the cap. Shared with the upload route, which stops reading the
 *  moment the count passes the cap and so never learns the full size. That is why the message
 *  states the limit and not the file's size. */
export function facilityXlsxTooLarge(): FacilityXlsxError {
  return new FacilityXlsxError(
    'too_large',
    `the Excel workbook is larger than ${FACILITY_IMPORT_MAX_XLSX_BYTES / 1024 / 1024} MB, the limit ` +
    'for a workbook because it cannot be streamed. Save the first sheet as CSV and import that file instead',
  );
}

/**
 * Convert the first worksheet of an Excel workbook into the CSV the facility import already reads.
 *
 * The import reads CSV, so this is the only place that knows a workbook exists. The upload route
 * stores what this returns and every later step (validate, column values, apply) reads it as an
 * ordinary CSV. The CLI calls this too, so both doors convert identically.
 *
 * ⛔ HOW A NUMBER BECOMES TEXT, and why it is not SheetJS's default. By default SheetJS writes the
 * text Excel DISPLAYS, and Excel's "General" format displays a 15-digit number as `1.23457E+14`
 * and a coordinate to 8 decimals. That would rewrite a facility's code on the way in. So a number
 * in the General format is written as its stored value. A number with a format of its own keeps
 * the displayed text instead: a code padded by a `000000` format keeps its zeros, and a date keeps
 * the date the operator sees rather than a day count.
 */
export function facilityXlsxToCsv(bytes: Uint8Array): FacilityXlsxCsv {
  if (bytes.length > FACILITY_IMPORT_MAX_XLSX_BYTES) {
    throw facilityXlsxTooLarge();
  }
  if (!ZIP_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new FacilityXlsxError('not_xlsx', 'the file is not an Excel workbook (.xlsx)');
  }

  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, {
      type: 'buffer',
      // Parse the first sheet only. `SheetNames` still lists every sheet.
      sheets: 0,
      dense: true,
      cellDates: true,
      // Keeps each cell's number format, which is what tells General apart from `000000`.
      cellNF: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
  } catch (err) {
    throw new FacilityXlsxError('unreadable', `the Excel workbook could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }

  const sheetName = book.SheetNames[0];
  const sheet = sheetName === undefined ? undefined : book.Sheets[sheetName];
  if (sheetName === undefined || !sheet) {
    throw new FacilityXlsxError('unreadable', 'the Excel workbook has no worksheets');
  }

  for (const row of sheet['!data'] ?? []) {
    for (const cell of row ?? []) {
      if (cell?.t === 'n' && (cell.z === undefined || cell.z === 'General')) cell.w = String(cell.v);
    }
  }

  const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
  if (csv.trim() === '') {
    throw new FacilityXlsxError('empty_sheet', `the first worksheet, "${sheetName}", has no rows`);
  }
  const [firstRecord = []] = parseCsv(csv, { to: 1, relax_column_count: true }) as string[][];
  const headers = firstRecord.map((h) => h.trim()).filter((h) => h !== '');
  return { csv, headers, sheetName, sheetCount: book.SheetNames.length };
}
