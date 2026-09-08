import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { readFileRows } from './facility-file-rows';

const streamOf = (s: string) => Readable.from([Buffer.from(s, 'utf8')]);

describe('readFileRows', () => {
  it('returns the header row and the requested window of a csv', async () => {
    const csv = 'code,name\r\n1,Alpha\r\n2,Beta\r\n3,Gamma\r\n';
    const w = await readFileRows(streamOf(csv), { format: 'csv', offset: 1, limit: 2 });
    expect(w.headers).toEqual(['code', 'name']);
    expect(w.rows).toEqual([['2', 'Beta'], ['3', 'Gamma']]);
    expect(w.scanned).toBe(3);
  });

  it('strips a utf-8 BOM so the first header is not \\ufeffcode', async () => {
    const w = await readFileRows(streamOf('﻿code,name\n1,Alpha\n'), { format: 'csv', offset: 0, limit: 10 });
    expect(w.headers).toEqual(['code', 'name']);
  });

  it('renders jsonl as the same table, keys in first-seen order', async () => {
    const jsonl = '{"code":"1","name":"Alpha"}\n{"name":"Beta","code":"2"}\n';
    const w = await readFileRows(streamOf(jsonl), { format: 'jsonl', offset: 0, limit: 10 });
    expect(w.headers).toEqual(['code', 'name']);
    expect(w.rows).toEqual([['1', 'Alpha'], ['2', 'Beta']]);
  });

  // ⛔ A QUOTED COMMA. The naive `line.split(',')` this used to do shifted every cell to the right
  // of one and rendered the quotes literally: `1,"Clinic, Lusaka"` came back as
  // `['1', '"Clinic', 'Lusaka"']`. A national register full of `Clinic, Lusaka` place names is the
  // ordinary case, not the exotic one.
  it('keeps a quoted comma inside its cell', async () => {
    const csv = 'code,name\n1,"Clinic, Lusaka"\n2,Beta\n';
    const w = await readFileRows(streamOf(csv), { format: 'csv', offset: 0, limit: 10 });
    expect(w.headers).toEqual(['code', 'name']);
    expect(w.rows).toEqual([['1', 'Clinic, Lusaka'], ['2', 'Beta']]);
    expect(w.scanned).toBe(2);
  });

  // ⛔ AN EMBEDDED NEWLINE inside a quoted field is ONE row, not two. Counting it as two made the
  // pager's `total` disagree with what the validate found in the same file.
  it('counts a quoted newline as one row', async () => {
    const csv = 'code,name\n1,"Clinic\nAnnex"\n2,Beta\n';
    const w = await readFileRows(streamOf(csv), { format: 'csv', offset: 0, limit: 10 });
    expect(w.rows).toEqual([['1', 'Clinic\nAnnex'], ['2', 'Beta']]);
    expect(w.scanned).toBe(2);
  });

  it('pages a csv with quoted commas by the same offsets', async () => {
    const csv = 'code,name\n1,"A, one"\n2,"B, two"\n3,"C, three"\n';
    const w = await readFileRows(streamOf(csv), { format: 'csv', offset: 1, limit: 1 });
    expect(w.rows).toEqual([['2', 'B, two']]);
    expect(w.scanned).toBe(3);
  });

  // ⛔ THE FILE IS STORED WITHOUT BEING PARSED now, so a line that is not JSON reaches this reader.
  // Unguarded `JSON.parse` threw, the route answered 500 and the studio told the operator to check
  // their network connection over a bad line in their own file.
  it('skips an unreadable jsonl line and reports which lines it skipped', async () => {
    const jsonl = '{"code":"1"}\nnot json\n{"code":"3"}\n';
    const w = await readFileRows(streamOf(jsonl), { format: 'jsonl', offset: 0, limit: 10 });
    expect(w.rows).toEqual([['1'], ['3']]);
    expect(w.scanned).toBe(2);
    expect(w.skippedLines).toEqual([2]);
  });

  // A well-formed JSON line that is not an OBJECT threw at `Object.keys` rather than at
  // `JSON.parse`, which is the same defect one step further on.
  it('skips a jsonl line that parses to something other than an object', async () => {
    const jsonl = '{"code":"1"}\n[1,2,3]\n"plain string"\nnull\n{"code":"5"}\n';
    const w = await readFileRows(streamOf(jsonl), { format: 'jsonl', offset: 0, limit: 10 });
    expect(w.rows).toEqual([['1'], ['5']]);
    expect(w.skippedLines).toEqual([2, 3, 4]);
  });

  it('reports no skipped lines for a clean file', async () => {
    const w = await readFileRows(streamOf('code\n1\n'), { format: 'csv', offset: 0, limit: 10 });
    expect(w.skippedLines).toEqual([]);
  });
});
