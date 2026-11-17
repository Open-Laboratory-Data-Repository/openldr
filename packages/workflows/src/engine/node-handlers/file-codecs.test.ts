import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { itemsToCsv, itemsToXlsx, fileToRows } from './file-codecs';

describe('file-codecs', () => {
  it('round-trips items → csv bytes → rows', () => {
    const items = [{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }];
    const csv = itemsToCsv(items);
    expect(new TextDecoder().decode(csv)).toContain('a,b');
    expect(fileToRows(csv)).toEqual([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
  });
  it('round-trips items → xlsx bytes → rows', () => {
    const items = [{ json: { name: 'Ann', age: 30 } }];
    const xlsx = itemsToXlsx(items);
    expect(xlsx.byteLength).toBeGreaterThan(0);
    expect(fileToRows(xlsx)).toEqual([{ name: 'Ann', age: 30 }]);
  });
  it('without cellsAsText, a CSV cell is read as a guessed type (pinned, unchanged)', () => {
    const csv = new TextEncoder().encode('id,val,dob,d2\n00123,"12,5",1990-04-12,01/12/2024\n');
    expect(fileToRows(csv)).toEqual([{ id: 123, val: 125, dob: 32975, d2: 45303 }]);
  });
  it('with cellsAsText, every CSV cell is the text in the file, and blank cells are still dropped', () => {
    const csv = new TextEncoder().encode('id,val,dob,d2,blank\n00123,"12,5",1990-04-12,01/12/2024,\n');
    expect(fileToRows(csv, { cellsAsText: true })).toEqual([{ id: '00123', val: '12,5', dob: '1990-04-12', d2: '01/12/2024' }]);
  });
  it('with cellsAsText, keeps 007, 12.5, 12,5, a 20-digit string and both date forms as the text in the file', () => {
    const csv = new TextEncoder().encode('a,b,c,d,e,f\n007,12.5,"12,5",12345678901234567890,03/11/2026,2026-11-03\n');
    expect(fileToRows(csv, { cellsAsText: true })).toEqual([
      { a: '007', b: '12.5', c: '12,5', d: '12345678901234567890', e: '03/11/2026', f: '2026-11-03' },
    ]);
  });
  it('with cellsAsText, keeps the spaces around a cell, and a cell of spaces', () => {
    const csv = new TextEncoder().encode('a,b\n QZX 1 ,   \n');
    expect(fileToRows(csv, { cellsAsText: true })).toEqual([{ a: ' QZX 1 ', b: '   ' }]);
  });
  it('tells an Excel file from a CSV by its bytes (a zip), not by the option or a name', () => {
    const xlsx = itemsToXlsx([{ json: { n: 7 } }]);
    expect([...xlsx.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(fileToRows(xlsx, { cellsAsText: true })).toEqual([{ n: 7 }]);
    expect(fileToRows(new TextEncoder().encode('n\n7\n'), { cellsAsText: true })).toEqual([{ n: '7' }]);
  });
  it('gives an Excel date cell as its serial day number, with the option on or off', () => {
    const ws = XLSX.utils.aoa_to_sheet([['when'], [{ t: 'n', v: 46329, z: 'yyyy-mm-dd' }]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(fileToRows(bytes)).toEqual([{ when: 46329 }]);
    expect(fileToRows(bytes, { cellsAsText: true })).toEqual([{ when: 46329 }]);
  });
  it('cellsAsText does not change an XLSX cell, which keeps the type it was saved with', () => {
    const xlsx = itemsToXlsx([{ json: { id: '00123', n: 12.5 } }]);
    expect(fileToRows(xlsx, { cellsAsText: true })).toEqual([{ id: '00123', n: 12.5 }]);
  });
  it('returns [] for an empty workbook', () => {
    expect(fileToRows(itemsToCsv([]))).toEqual([]);
  });
});
