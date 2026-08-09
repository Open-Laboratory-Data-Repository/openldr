import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFacilityRelease } from './facility-release';

const HFR = 'urn:tz:mfl';
const opts = { nationalSystem: HFR };

const metaLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'meta', country: 'TZ', version: '2026-Q1', publishedAt: '2026-04-17T17:12:06.891Z',
    rowCount: 1, deletionCount: 0, ...over,
  });

const rowLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'row', mflId: 'TZ-000001', name: 'Uwanja Hospital', facilityLevel: 'hospital',
    district: 'Handeni', region: 'Tanga', countryCode: 'TZ', latitude: -2.4048, longitude: 29.912,
    phone: null, email: null, active: true, ...over,
  });

describe('parseFacilityRelease', () => {
  it('parses the meta header', () => {
    const r = parseFacilityRelease(`${metaLine()}\n${rowLine()}\n`, opts);
    expect(r.meta).toEqual({
      country: 'TZ', version: '2026-Q1', publishedAt: '2026-04-17T17:12:06.891Z',
      rowCount: 1, deletionCount: 0,
    });
  });

  it('maps a row record into the same FacilityRecord shape parseFacilityCsv produces', () => {
    const r = parseFacilityRelease(`${metaLine()}\n${rowLine()}\n`, opts);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      nationalSystem: HFR,
      nationalCode: 'TZ-000001',
      name: 'Uwanja Hospital',
      level: 'hospital',
      district: 'Handeni',
      region: 'Tanga',
      country: 'TZ',
      latitude: -2.4048,
      longitude: 29.912,
      status: 'active',
      source: 'import',
    });
  });

  it('maps active:false to status "inactive"', () => {
    const r = parseFacilityRelease(`${metaLine()}\n${rowLine({ active: false })}\n`, opts);
    expect(r.records[0].status).toBe('inactive');
  });

  it('gives a release record the SAME deterministic id as a CSV row for the same register+code', async () => {
    const { parseFacilityCsv } = await import('./facility-csv');
    const csvResult = parseFacilityCsv('national_code,name\nTZ-000001,Uwanja Hospital\n', opts);
    const releaseResult = parseFacilityRelease(`${metaLine()}\n${rowLine()}\n`, opts);
    expect(releaseResult.records[0].id).toBe(csvResult.records[0].id);
  });

  it('puts email into extras — the contract has no column for it', () => {
    const r = parseFacilityRelease(`${metaLine()}\n${rowLine({ email: 'ops@example.org' })}\n`, opts);
    expect(r.records[0].extras).toEqual({ email: 'ops@example.org' });
  });

  it('collects deletion records into `deletions`, never into `records`', () => {
    const jsonl = [
      metaLine({ rowCount: 0, deletionCount: 1 }),
      JSON.stringify({ type: 'deletion', mflId: 'TZ-000500' }),
    ].join('\n');
    const r = parseFacilityRelease(jsonl, opts);
    expect(r.deletions).toEqual(['TZ-000500']);
    expect(r.records).toEqual([]);
  });

  it('rejects a malformed line WITH its line number, never throwing', () => {
    const jsonl = [metaLine(), rowLine(), '{not valid json'].join('\n');
    expect(() => parseFacilityRelease(jsonl, opts)).not.toThrow();
    const r = parseFacilityRelease(jsonl, opts);
    expect(r.quarantined).toEqual([{ line: 3, raw: '{not valid json', reason: 'malformed_json' }]);
  });

  it('reports a declared rowCount that disagrees with what was parsed, without failing the file', () => {
    const jsonl = [metaLine({ rowCount: 5 }), rowLine()].join('\n');
    const r = parseFacilityRelease(jsonl, opts);
    expect(r.records).toHaveLength(1);
    expect(r.countMismatch).toEqual([{ field: 'rowCount', declared: 5, parsed: 1 }]);
  });

  it('reports a declared deletionCount that disagrees with what was parsed', () => {
    const jsonl = [
      metaLine({ rowCount: 0, deletionCount: 3 }),
      JSON.stringify({ type: 'deletion', mflId: 'TZ-000500' }),
    ].join('\n');
    const r = parseFacilityRelease(jsonl, opts);
    expect(r.countMismatch).toEqual([{ field: 'deletionCount', declared: 3, parsed: 1 }]);
  });

  it('validates coordinates as a pair, producing the same RowError shape as CSV', () => {
    const jsonl = [metaLine(), rowLine({ latitude: 200, longitude: 29.912 })].join('\n');
    const r = parseFacilityRelease(jsonl, opts);
    expect(r.records).toEqual([]);
    expect(r.invalid).toEqual([{ line: 2, field: 'latitude', reason: 'out_of_range', raw: '200' }]);
  });

  it('drops a row missing a required field and counts it as skipped, not throwing', () => {
    const jsonl = [metaLine(), rowLine({ name: null })].join('\n');
    const r = parseFacilityRelease(jsonl, opts);
    expect(r.records).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe('parseFacilityRelease — real corpus fixture', () => {
  const fixture = path.resolve(__dirname, '../../../../corlix/fixtures/mfl-TZ-2026-Q1-small.jsonl');

  describe.skipIf(!existsSync(fixture))('mfl-TZ-2026-Q1-small.jsonl', () => {
    it('parses the declared row count with no deletions', async () => {
      const jsonl = await readFile(fixture, 'utf8');
      const r = parseFacilityRelease(jsonl, { nationalSystem: 'urn:tz:mfl' });
      expect(r.meta?.rowCount).toBe(20);
      expect(r.records).toHaveLength(20);
      expect(r.deletions).toHaveLength(0);
    });
  });
});
