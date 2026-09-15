import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readTableFile, TableFileError } from './table-file';

const LIMITS = { maxBytes: 1024 * 1024, maxRows: 3 };
const csv = (text: string) => new TextEncoder().encode(text);

function workbook(sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

function refusal(fn: () => unknown): { reason: string; message: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof TableFileError) return { reason: err.reason, message: err.message };
    throw err;
  }
  throw new Error('expected a TableFileError');
}

describe('readTableFile: CSV', () => {
  it('reads the header and rows, trimming cells and skipping a byte order mark and blank lines', () => {
    const file = readTableFile(csv('﻿code , name\n A1 ,Alpha \n\nB2,"Beta, two"\n'), 'csv', LIMITS);
    expect(file).toEqual({
      headers: ['code', 'name'],
      rows: [['A1', 'Alpha'], ['B2', 'Beta, two']],
      sheetName: null,
      sheetCount: 1,
    });
  });

  it('pads a short row with empty cells and drops cells past the header', () => {
    expect(readTableFile(csv('code,name,loinc\nA1\nB2,Beta,1-8,extra\n'), 'csv', LIMITS).rows)
      .toEqual([['A1', '', ''], ['B2', 'Beta', '1-8']]);
  });

  it('refuses a file over the byte limit, over the row limit, or with no rows, and says why', () => {
    expect(refusal(() => readTableFile(csv('x'.repeat(20)), 'csv', { maxBytes: 10, maxRows: 3 })))
      .toEqual({ reason: 'too_large', message: 'The file is larger than 10 bytes, the limit.' });
    expect(refusal(() => readTableFile(csv('code\nA\nB\nC\nD\n'), 'csv', LIMITS)))
      .toEqual({ reason: 'too_many_rows', message: 'The file has 4 rows under its header. The limit is 3.' });
    expect(refusal(() => readTableFile(csv('\n\n'), 'csv', LIMITS)))
      .toEqual({ reason: 'empty', message: 'The file has no rows.' });
  });
});

describe('readTableFile: XLSX', () => {
  it('reads the first worksheet and says which one, and how many there are', () => {
    const bytes = workbook({
      Tests: XLSX.utils.aoa_to_sheet([['code', 'name'], ['A1', 'Alpha']]),
      Notes: XLSX.utils.aoa_to_sheet([['ignored']]),
    });
    expect(readTableFile(bytes, 'xlsx', LIMITS)).toEqual({
      headers: ['code', 'name'], rows: [['A1', 'Alpha']], sheetName: 'Tests', sheetCount: 2,
    });
  });

  it('keeps a 15-digit General number whole, and the zeros a number format pads', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['code', 'padded'], [123456789012345, 123]]);
    sheet.B2.z = '000000';
    const file = readTableFile(workbook({ Tests: sheet }), 'xlsx', LIMITS);
    // SheetJS's default text would read 1.23457E+14 here.
    expect(file.rows).toEqual([['123456789012345', '000123']]);
  });

  it('refuses bytes that are not a workbook, and an empty worksheet', () => {
    expect(refusal(() => readTableFile(csv('code,name\n'), 'xlsx', LIMITS)))
      .toEqual({ reason: 'not_xlsx', message: 'The file is not an Excel workbook (.xlsx).' });
    expect(refusal(() => readTableFile(workbook({ Empty: XLSX.utils.aoa_to_sheet([]) }), 'xlsx', LIMITS)))
      .toEqual({ reason: 'empty', message: 'The worksheet "Empty" has no rows.' });
  });
});
