import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPatientIndex } from './patient-index';
import { createPatientDuplicates, groupExact, parseDuplicateListQuery, parsePairInput } from './patient-duplicates';
import { buildPatientIndexFixture, seedIdentifier, seedPatient } from './test-support/patient-index-fixture';

const NRC = 'urn:zm:nrc';
const NOW = () => new Date('2026-10-12T00:00:00Z');
const OPEN = { status: 'open' as const, limit: 25, offset: 0 };

async function build() {
  const f = await buildPatientIndexFixture();
  const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', now: NOW, refKey: randomBytes(32) });
  const dups = createPatientDuplicates({ internalDb: f.internalDb, externalDb: f.externalDb, index, systems: f.systems });
  return { ...f, index, dups };
}

describe('patient duplicates: rules', () => {
  it('groups patients sharing an identifier value in one system', async () => {
    const { externalDb, dups } = await build();
    for (const id of ['a', 'b', 'c']) await seedPatient(externalDb, { id, surname: `S${id}`, firstname: 'F', dob: '1990' });
    await seedIdentifier(externalDb, 'a', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'b', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'c', NRC, '111111/10/1');
    const out = await dups.list(OPEN, { unmask: true });
    expect(out.total).toBe(1);
    expect(out.rows[0]).toMatchObject({ rule: 'identifier', evidence: { system: NRC, text: '998877/10/1' }, pairs: 1, dismissedPairs: 0 });
    expect(out.rows[0].members.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('puts three patients sharing one identifier in one group with three pairs', async () => {
    const { externalDb, dups } = await build();
    for (const id of ['a', 'b', 'c']) { await seedPatient(externalDb, { id }); await seedIdentifier(externalDb, id, NRC, 'X1'); }
    const out = await dups.list(OPEN, { unmask: true });
    expect([out.total, out.rows[0].members.length, out.rows[0].pairs]).toEqual([1, 3, 3]);
  });

  it('ignores null-system identifiers, non-searchable systems, and inactive or merged patients', async () => {
    const { externalDb, systems, dups } = await build();
    await seedPatient(externalDb, { id: 'a' }); await seedPatient(externalDb, { id: 'b' });
    await seedPatient(externalDb, { id: 'gone', active: false }); await seedPatient(externalDb, { id: 'merged', replacedBy: 'a' });
    await seedIdentifier(externalDb, 'a', null, 'FOLDER-1'); await seedIdentifier(externalDb, 'b', null, 'FOLDER-1');
    await seedIdentifier(externalDb, 'a', 'urn:x', 'Q'); await seedIdentifier(externalDb, 'b', 'urn:x', 'Q');
    await systems.set({ system: 'urn:x', label: null, listColumn: false, searchable: false });
    await seedIdentifier(externalDb, 'a', NRC, 'N'); await seedIdentifier(externalDb, 'gone', NRC, 'N'); await seedIdentifier(externalDb, 'merged', NRC, 'N');
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(0);
  });

  it('groups same details, ignoring case and accents, when sexes agree or one is missing', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Mwanza', firstname: 'Émile', dob: '1990-01-05', sex: 'M' });
    await seedPatient(externalDb, { id: 'b', surname: 'MWANZA', firstname: 'emile', dob: '1990-01-05', sex: null });
    const out = await dups.list(OPEN, { unmask: true });
    expect(out.rows.map((r) => [r.rule, r.members.map((m) => m.id), r.pairs])).toEqual([['details', ['a', 'b'], 1]]);
    expect(out.rows[0].evidence.text).toBe('Émile Mwanza, 1990-01-05');
  });

  it('does not report same details with different sexes', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'M' });
    await seedPatient(externalDb, { id: 'b', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'F' });
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(0);
  });

  it('keeps a three-member group with one conflict, counting only compatible pairs', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'M' });
    await seedPatient(externalDb, { id: 'b', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'F' });
    await seedPatient(externalDb, { id: 'c', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: null });
    const out = await dups.list(OPEN, { unmask: true });
    expect([out.total, out.rows[0].members.length, out.rows[0].pairs]).toEqual([1, 3, 2]);
  });
});

describe('patient duplicates: bounds', () => {
  it('caps members at 50 but counts the whole group and every pair', async () => {
    const { externalDb, dups } = await build();
    for (let n = 0; n < 60; n += 1) {
      const id = `p${String(n).padStart(2, '0')}`;
      await seedPatient(externalDb, { id }); await seedIdentifier(externalDb, id, NRC, 'PLACEHOLDER');
    }
    const out = await dups.list(OPEN, { unmask: true });
    expect([out.rows[0].memberCount, out.rows[0].members.length, out.rows[0].pairs]).toEqual([60, 50, 1770]);
  });

  it('counts compatible pairs for a details group with mixed sexes', async () => {
    const { externalDb, dups } = await build();
    for (const [id, sex] of [['a', 'M'], ['b', 'M'], ['c', 'F'], ['d', null]] as const) {
      await seedPatient(externalDb, { id, surname: 'Banda', firstname: 'Chris', dob: '1990', sex });
    }
    const out = await dups.list(OPEN, { unmask: true });
    expect([out.rows[0].pairs, out.rows[0].members.length, out.rows[0].memberCount]).toEqual([4, 4, 4]);
  });

  it('lists masked members in md5 order, not id order', async () => {
    const { externalDb, dups } = await build();
    for (const [id, surname] of [['hl7-001', 'Alpha'], ['hl7-002', 'Bravo'], ['hl7-003', 'Charlie']]) {
      await seedPatient(externalDb, { id, surname, firstname: 'John', dob: '1990-01-05' });
      await seedIdentifier(externalDb, id, NRC, 'SHARED-1');
    }
    const out = await dups.list(OPEN, { unmask: false });
    // md5: hl7-001 4612..., hl7-003 5522..., hl7-002 6096...
    expect(out.rows[0].members.map((m) => m.name)).toEqual(['J*** A***', 'J*** C***', 'J*** B***']);
  });

  it('refuses more than 50 ids', async () => {
    const { dups } = await build();
    const ids = Array.from({ length: 51 }, (_, n) => `x${n}`);
    await expect(dups.dismiss({ ids, reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    expect(parsePairInput({ refs: ids })).toEqual({ ok: false, error: 'refs must list at most 50 patients' });
  });
});

describe('patient duplicates: dismissals', () => {
  async function twoSharing() {
    const b = await build();
    for (const id of ['a', 'b', 'c']) { await seedPatient(b.externalDb, { id }); await seedIdentifier(b.externalDb, id, NRC, 'X1'); }
    return b;
  }

  it('hides a group only when every pair is dismissed, whichever way round', async () => {
    const { dups, internalDb } = await twoSharing();
    expect(await dups.dismiss({ ids: ['b', 'a'], reason: 'twins', by: 'dev-admin' })).toEqual({ changed: 1 });
    expect(await internalDb.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b']).execute()).toEqual([{ patient_a: 'a', patient_b: 'b' }]);
    expect((await dups.list(OPEN, { unmask: true })).rows[0].dismissedPairs).toBe(1);
    expect(await dups.dismiss({ ids: ['a', 'b', 'c'], reason: null, by: 'dev-admin' })).toEqual({ changed: 2 });
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(0);
    expect((await dups.list({ ...OPEN, status: 'dismissed' }, { unmask: true })).total).toBe(1);
    expect((await dups.list({ ...OPEN, status: 'all' }, { unmask: true })).total).toBe(1);
  });

  it('restores dismissed pairs and reports how many changed', async () => {
    const { dups } = await twoSharing();
    await dups.dismiss({ ids: ['a', 'b', 'c'], reason: null, by: 'x' });
    expect(await dups.restore({ ids: ['c', 'a'] })).toEqual({ changed: 1 });
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(1);
    expect(await dups.restore({ ids: ['c', 'a'] })).toEqual({ changed: 0 });
  });

  it('refuses fewer than two ids, a repeated id, and an unknown patient', async () => {
    const { dups } = await twoSharing();
    await expect(dups.dismiss({ ids: ['a'], reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(dups.dismiss({ ids: ['a', 'a'], reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(dups.dismiss({ ids: ['a', 'nope'], reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('patient duplicates: masking, paging and export', () => {
  it('masks members and evidence without patients.view_identifiers', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'hl7-111', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05' });
    await seedPatient(externalDb, { id: 'hl7-222', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05' });
    await seedIdentifier(externalDb, 'hl7-111', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'hl7-222', NRC, '998877/10/1');
    const out = await dups.list(OPEN, { unmask: false });
    expect(out.masked).toBe(true);
    expect(out.rows.map((r) => r.evidence.text).sort()).toEqual(['J*** M***, 1990', '•••10/1']);
    expect(JSON.stringify(out)).not.toMatch(/hl7-|Mwanza|John|998877|1990-01-05/);
  });

  it('pages in a stable order', async () => {
    const { externalDb, dups } = await build();
    for (const n of [1, 2, 3]) {
      for (const s of ['a', 'b']) { await seedPatient(externalDb, { id: `${s}${n}` }); await seedIdentifier(externalDb, `${s}${n}`, NRC, `V${n}`); }
    }
    const all = (await dups.list(OPEN, { unmask: true })).rows.map((r) => r.evidence.text);
    const p1 = (await dups.list({ ...OPEN, limit: 2, offset: 0 }, { unmask: true })).rows.map((r) => r.evidence.text);
    const p2 = (await dups.list({ ...OPEN, limit: 2, offset: 2 }, { unmask: true })).rows.map((r) => r.evidence.text);
    expect([...p1, ...p2]).toEqual(all);
    expect(all).toHaveLength(3);
  });

  it('exports one row per member of each open group', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', sex: 'M', guid: 'G-a' });
    await seedPatient(externalDb, { id: 'b', surname: 'Phiri', firstname: 'Ann', dob: '1991', sex: 'F', guid: 'G-b' });
    await seedIdentifier(externalDb, 'a', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'b', NRC, '998877/10/1');
    const { csv, groups } = await dups.exportCsv();
    const lines = csv.trim().split(/\r?\n/);
    expect(groups).toBe(1);
    expect(lines[0]).toBe('group,rule,system_label,evidence,patient_id,patient_guid,surname,firstname,date_of_birth,sex,managing_facility');
    expect(lines.slice(1)).toEqual([
      `1,identifier,${NRC},998877/10/1,a,G-a,Mwanza,John,1990-01-05,M,`,
      `1,identifier,${NRC},998877/10/1,b,G-b,Phiri,Ann,1991,F,`,
    ]);
  });
});

describe('patient duplicates: exact regrouping', () => {
  it('drops a group whose members differ only by case (a case-insensitive collation folded them)', () => {
    expect(groupExact([
      { system: 's', value: 'AB12', patient_id: 'a' },
      { system: 's', value: 'ab12', patient_id: 'b' },
    ])).toEqual([]);
  });

  it('keeps a group of two distinct patients under one exact pair, and drops one patient repeated', () => {
    const out = groupExact([
      { system: 's', value: 'X1', patient_id: 'b' },
      { system: 's', value: 'X1', patient_id: 'a' },
      { system: 's', value: 'Y2', patient_id: 'a' },
      { system: 's', value: 'Y2', patient_id: 'a' },
      { system: null, value: 'X1', patient_id: 'c' },
    ]);
    expect(out).toEqual([{ rule: 'identifier', system: 's', value: 'X1', ids: ['a', 'b'], pairs: 1 }]);
  });
});

describe('patient duplicates: parsers', () => {
  it('parses the list query', () => {
    expect(parseDuplicateListQuery({})).toEqual({ ok: true, query: { status: 'open', limit: 25, offset: 0 } });
    expect(parseDuplicateListQuery({ status: 'gone' })).toEqual({ ok: false, error: 'status must be open, dismissed or all' });
  });

  it('parses refs and reason', () => {
    expect(parsePairInput({ refs: ['r1', 'r2'], reason: '  twins ' })).toEqual({ ok: true, refs: ['r1', 'r2'], reason: 'twins' });
    expect(parsePairInput({ refs: ['r1'] })).toEqual({ ok: false, error: 'refs must list at least two different patients' });
    expect(parsePairInput({ refs: ['r1', 'r1'] })).toEqual({ ok: false, error: 'refs must list at least two different patients' });
    expect(parsePairInput({ refs: 'r1' })).toEqual({ ok: false, error: 'refs must list at least two different patients' });
  });
});
