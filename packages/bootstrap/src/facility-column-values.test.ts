import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { readColumnValues, type ColumnValues } from './facility-column-values';
import { FacilityFileUnreadableError } from './facility-file-rows';

const streamOf = (s: string) => Readable.from([Buffer.from(s, 'utf8')]);

describe('readColumnValues', () => {
  it('returns one column\'s distinct values, in first-seen order', async () => {
    const csv = 'code,type\r\n1,Health Post\r\n2,Health Centre\r\n3,Health Post\r\n';
    const r = await readColumnValues(streamOf(csv), { format: 'csv', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post', 'Health Centre']);
    expect(r.distinct).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it('skips empty cells rather than offering an empty value to map', async () => {
    const csv = 'code,type\n1,\n2,Health Post\n3,   \n';
    const r = await readColumnValues(streamOf(csv), { format: 'csv', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post']);
  });

  it('caps the list but still counts what it did not return', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `${i},v${i}`).join('\n');
    const r = await readColumnValues(streamOf(`code,type\n${rows}\n`), { format: 'csv', header: 'type', limit: 10 });
    expect(r.values).toHaveLength(10);
    expect(r.distinct).toBe(30);
    expect(r.truncated).toBe(true);
  });

  it('reads the same column out of a jsonl release', async () => {
    const jsonl = '{"code":"1","type":"Health Post"}\n{"code":"2","type":"Health Post"}\n';
    const r = await readColumnValues(streamOf(jsonl), { format: 'jsonl', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post']);
    expect(r.distinct).toBe(1);
  });

  it('returns nothing for a header the file does not have, rather than throwing', async () => {
    const r = await readColumnValues(streamOf('code,type\n1,Health Post\n'), { format: 'csv', header: 'nope', limit: 50 });
    expect(r.values).toEqual([]);
    expect(r.distinct).toBe(0);
  });

  it('strips UTF-8 BOM from the first header', async () => {
    const bom = '﻿';
    const csv = `${bom}code,type\r\n1,Health Post\r\n`;
    const r = await readColumnValues(streamOf(csv), { format: 'csv', header: 'code', limit: 50 });
    expect(r.values).toEqual(['1']);
  });

  it('skips a malformed JSONL line rather than throwing', async () => {
    const jsonl = '{"code":"1","type":"Health Post"}\ninvalid json\n{"code":"2","type":"Health Centre"}\n';
    const r = await readColumnValues(streamOf(jsonl), { format: 'jsonl', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post', 'Health Centre']);
    expect(r.distinct).toBe(2);
  });

  it('rejects an unterminated-quote CSV with FacilityFileUnreadableError', async () => {
    const csv = 'code,type\n1,"Health Post\n2,Health Centre\n';
    try {
      await readColumnValues(streamOf(csv), { format: 'csv', header: 'type', limit: 50 });
      expect.fail('should have thrown FacilityFileUnreadableError');
    } catch (err) {
      expect(err).toBeInstanceOf(FacilityFileUnreadableError);
      expect((err as Error).message).toMatch(/this file could not be read as CSV/);
    }
  });
});
