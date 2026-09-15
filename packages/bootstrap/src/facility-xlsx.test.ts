import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { FACILITY_IMPORT_MAX_XLSX_BYTES, FacilityXlsxError, facilityXlsxToCsv } from './facility-xlsx';

/** A workbook built in memory, one entry per sheet, in order. */
function workbook(sheets: Array<[name: string, rows: unknown[][]]>, edit?: (wb: XLSX.WorkBook) => void): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  }
  edit?.(wb);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function refusal(bytes: Uint8Array): FacilityXlsxError {
  try {
    facilityXlsxToCsv(bytes);
  } catch (err) {
    if (err instanceof FacilityXlsxError) return err;
    throw err;
  }
  throw new Error('expected facilityXlsxToCsv to refuse this file');
}

describe('facilityXlsxToCsv', () => {
  it('turns the first worksheet into CSV and names it', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Facilities', [['code', 'name'], ['ZM-1', 'Kabwe Clinic'], ['ZM-2', 'Mansa Hospital']]],
    ]));
    expect(out.csv).toBe('code,name\nZM-1,Kabwe Clinic\nZM-2,Mansa Hospital');
    expect(out.sheetName).toBe('Facilities');
    expect(out.sheetCount).toBe(1);
  });

  // The upload route hands these to the Mapping step, which is the only way a browser that cannot
  // unzip a workbook learns its columns. Parsed as CSV, so a header holding a comma stays one header.
  it('returns the header row, a header holding a comma kept whole', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Facilities', [[], ['code', 'Name, official', ' level '], ['ZM-1', 'Kabwe Clinic', 'Hospital']]],
    ]));
    expect(out.headers).toEqual(['code', 'Name, official', 'level']);
  });

  it('reads only the first sheet and counts the rest', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Register', [['code'], ['ZM-1']]],
      ['Notes', [['not a facility']]],
      ['Lookups', [['level'], ['Hospital']]],
    ]));
    expect(out.csv).toBe('code\nZM-1');
    expect(out.sheetName).toBe('Register');
    expect(out.sheetCount).toBe(3);
  });

  // Excel's "General" format DISPLAYS a 15-digit number as 1.23457E+14 and a coordinate to 8
  // decimals. SheetJS copies that display text by default, which would rewrite a facility's code.
  it('keeps a long numeric code and a coordinate exactly as stored', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Facilities', [['code', 'latitude', 'beds'], [123456789012345, -15.123456789012, 42]]],
    ]));
    expect(out.csv).toBe('code,latitude,beds\n123456789012345,-15.123456789012,42');
  });

  // The other half of the same rule: a number the workbook FORMATS on purpose keeps the text the
  // operator sees, so a code padded with a 000000 format keeps its zeros.
  it('keeps the displayed text of a number or date with its own format', () => {
    const out = facilityXlsxToCsv(workbook(
      [['Facilities', [['code', 'opened'], [123, new Date(Date.UTC(2001, 0, 31, 12))]]]],
      (wb) => {
        const ws = wb.Sheets.Facilities!;
        ws.A2!.z = '000000';
        ws.B2!.z = 'yyyy-mm-dd';
      },
    ));
    expect(out.csv).toBe('code,opened\n000123,2001-01-31');
  });

  it('quotes a value holding a comma or a quote', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Facilities', [['code', 'name'], ['ZM-1', 'Kabwe, "Central"']]],
    ]));
    expect(out.csv).toBe('code,name\nZM-1,"Kabwe, ""Central"""');
  });

  it('drops blank rows, so a sheet with empty rows below the data adds no empty records', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Facilities', [['code', 'name'], [], ['ZM-1', 'Kabwe Clinic'], [], []]],
    ]));
    expect(out.csv).toBe('code,name\nZM-1,Kabwe Clinic');
  });

  it('gives every row the header row\'s width, so a short row is not read as malformed', () => {
    const out = facilityXlsxToCsv(workbook([
      ['Facilities', [['code', 'name', 'level'], ['ZM-1']]],
    ]));
    expect(out.csv).toBe('code,name,level\nZM-1,,');
  });

  it('refuses a file over the XLSX cap before reading it', () => {
    const err = refusal(new Uint8Array(FACILITY_IMPORT_MAX_XLSX_BYTES + 1));
    expect(err.reason).toBe('too_large');
    expect(err.message).toContain('20 MB');
    expect(err.message).toContain('CSV');
  });

  it('accepts a file of exactly the cap as far as the size check goes', () => {
    // Zero bytes are not a ZIP, so this reaches the NEXT check. What matters is that it is not
    // refused for its size.
    expect(refusal(new Uint8Array(FACILITY_IMPORT_MAX_XLSX_BYTES)).reason).toBe('not_xlsx');
  });

  it('refuses a file that is not a ZIP, such as a CSV given the wrong extension', () => {
    const err = refusal(Buffer.from('code,name\nZM-1,Kabwe Clinic\n', 'utf8'));
    expect(err.reason).toBe('not_xlsx');
  });

  it('refuses a ZIP signature followed by garbage', () => {
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]);
    expect(refusal(bytes).reason).toBe('unreadable');
  });

  it('refuses a workbook whose first worksheet has no rows', () => {
    const err = refusal(workbook([['Empty', []], ['Facilities', [['code'], ['ZM-1']]]]));
    expect(err.reason).toBe('empty_sheet');
    expect(err.message).toContain('"Empty"');
  });
});
