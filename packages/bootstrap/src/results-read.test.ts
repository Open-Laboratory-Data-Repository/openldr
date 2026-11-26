import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createResultsRead, decodeResultsKey, encodeResultsKey, ResultsKeyError, RELEASED_STATUSES } from './results-read';

// Layer: the released-results query on pg-mem, with no data limit. Not covered here: the data limit.
// It is the dashboards' rule (correlated EXISTS), which pg-mem cannot run, so it is checked against
// the dev warehouse on real Postgres. pg-mem also keeps a stable scan order, so the page order is
// pinned by created_at then id, which are unique together.

async function seed(): Promise<Kysely<ExternalSchema>> {
  const db = (await makeMigratedExternalDb()) as unknown as Kysely<ExternalSchema>;
  await db.insertInto('lab_requests').values({ id: 'q1', requester_code: 'FAC-1', requester_system: 'urn:x' } as never).execute();
  const row = (id: string, status: string | null, created: string, over: Record<string, unknown> = {}) => ({
    id, request_id: 'q1', patient_id: 'pat-1', observation_code: 'HGB', observation_system: 'http://loinc.org', observation_desc: 'Haemoglobin',
    result_type: 'numeric', numeric_value: 13.5, numeric_units: 'g/dL', status, result_timestamp: '2026-11-20T08:00:00.000Z',
    specimen_id: 's1', created_at: new Date(created), ...over,
  });
  await db.insertInto('lab_results').values([
    row('r1', 'final', '2026-11-21T00:00:01.000Z'),
    row('r2', 'amended', '2026-11-21T00:00:02.000Z', { result_timestamp: null }),
    row('r3', 'corrected', '2026-11-21T00:00:02.000Z', { patient_id: 'pat-2', observation_code: 'WBC' }),
    row('r4', 'preliminary', '2026-11-21T00:00:03.000Z'),
    row('r5', 'entered-in-error', '2026-11-21T00:00:04.000Z'),
    row('r6', null, '2026-11-21T00:00:05.000Z'),
    row('r7', 'final', '2026-11-21T00:00:06.000Z', { result_timestamp: '2026-11-25T08:00:00.000Z', request_id: null }),
  ] as never).execute();
  return db;
}

describe('results read', () => {
  it('lists only final, amended and corrected results, in stored order then id', async () => {
    const read = createResultsRead(await seed());
    const { results, next } = await read.list({ limit: 200 }, undefined);
    expect(results.map((r) => [r.id, r.status])).toEqual([['r1', 'final'], ['r2', 'amended'], ['r3', 'corrected'], ['r7', 'final']]);
    expect(next).toBeNull();
    expect([...RELEASED_STATUSES]).toEqual(['final', 'amended', 'corrected']);
  });

  it('gives each result its value, observation, requester and times', async () => {
    const read = createResultsRead(await seed());
    const r1 = (await read.list({ limit: 1 }, undefined)).results[0]!;
    expect(r1).toEqual({
      id: 'r1', requestId: 'q1', patientId: 'pat-1',
      observation: { code: 'HGB', system: 'http://loinc.org', display: 'Haemoglobin' },
      value: { type: 'numeric', number: 13.5, units: 'g/dL', comparator: null, code: null, text: null },
      abnormalFlag: null, status: 'final', resultTime: '2026-11-20T08:00:00.000Z', specimenId: 's1',
      requester: { code: 'FAC-1', system: 'urn:x' }, storedAt: '2026-11-21T00:00:01.000Z',
    });
    // A result with no request still comes back, with no requester.
    const r7 = (await read.get('r7', undefined))!;
    expect(r7.requester).toEqual({ code: null, system: null });
  });

  it('pages by a key, with ties on the stored time broken by id, and no row twice or missed', async () => {
    const read = createResultsRead(await seed());
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: { results: Array<{ id: string }>; next: string | null } = await read.list({ limit: 1, after }, undefined);
      seen.push(...page.results.map((r) => r.id));
      if (!page.next) break;
      after = page.next;
    }
    expect(seen).toEqual(['r1', 'r2', 'r3', 'r7']);
  });

  it('a result stored after a page was read shows on a later page, not an earlier one', async () => {
    const db = await seed();
    const read = createResultsRead(db);
    const first = await read.list({ limit: 2 }, undefined);
    await db.insertInto('lab_results').values({ id: 'r8', status: 'final', created_at: new Date('2026-11-22T00:00:00.000Z') } as never).execute();
    const rest = await read.list({ limit: 200, after: first.next }, undefined);
    expect(rest.results.map((r) => r.id)).toEqual(['r3', 'r7', 'r8']);
  });

  it('filters by result time, patient and observation; a time filter leaves out a result with no time', async () => {
    const read = createResultsRead(await seed());
    const ids = async (q: Parameters<typeof read.list>[0]) => (await read.list(q, undefined)).results.map((r) => r.id);
    expect(await ids({ limit: 200, since: '2026-11-24T00:00:00.000Z' })).toEqual(['r7']);
    expect(await ids({ limit: 200, until: '2026-11-24T00:00:00.000Z' })).toEqual(['r1', 'r3']);
    expect(await ids({ limit: 200, patientId: 'pat-2' })).toEqual(['r3']);
    expect(await ids({ limit: 200, observation: 'WBC' })).toEqual(['r3']);
  });

  it('gets one released result, and null for a missing or unreleased one', async () => {
    const read = createResultsRead(await seed());
    expect((await read.get('r3', undefined))?.status).toBe('corrected');
    expect(await read.get('r4', undefined)).toBeNull();
    expect(await read.get('nope', undefined)).toBeNull();
  });

  it('refuses a key it did not give, and reads back one it did', async () => {
    const read = createResultsRead(await seed());
    await expect(read.list({ limit: 5, after: 'not-a-key' }, undefined)).rejects.toBeInstanceOf(ResultsKeyError);
    expect(decodeResultsKey(encodeResultsKey('2026-11-21T00:00:01.000Z', 'r1'))).toEqual({ storedAt: '2026-11-21T00:00:01.000Z', id: 'r1' });
    expect(decodeResultsKey(Buffer.from('["nope","r1"]').toString('base64url'))).toBeNull();
  });
});
