import * as XLSX from 'xlsx';
import type { WorkflowItem } from '../items';

/** items → CSV bytes (utf8). */
export function itemsToCsv(items: WorkflowItem[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(items.map((i) => i.json));
  return new TextEncoder().encode(XLSX.utils.sheet_to_csv(ws));
}

/** items → XLSX bytes. */
export function itemsToXlsx(items: WorkflowItem[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(items.map((i) => i.json));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Uint8Array(buf);
}

export interface FileToRowsOptions {
  /**
   * CSV only: keep every cell as the text in the file. Without it, xlsx guesses a type, so
   * `00123` becomes 123, `12,5` becomes 125 and a date becomes a day number. For an XLSX file
   * this changes nothing: a cell keeps the type it was saved with. Blank cells are dropped
   * either way.
   */
  cellsAsText?: boolean;
}

/** CSV/XLSX bytes → row objects (first sheet). Empty workbook → []. */
export function fileToRows(bytes: Uint8Array, options: FileToRowsOptions = {}): Record<string, unknown>[] {
  const wb = XLSX.read(bytes, { type: 'array', raw: options.cellsAsText === true });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[first]) as Record<string, unknown>[];
}
