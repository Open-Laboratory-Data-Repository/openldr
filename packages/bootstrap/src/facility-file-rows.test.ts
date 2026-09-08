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
});
