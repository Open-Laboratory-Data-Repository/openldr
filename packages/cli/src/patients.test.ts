import { describe, it, expect, vi, beforeEach } from 'vitest';

const patientIndex = { list: vi.fn(), getById: vi.fn(), requestsById: vi.fn() };
const patientIdentifierSystems = { list: vi.fn(), get: vi.fn(), set: vi.fn() };
const audit: Array<Record<string, unknown>> = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ patientIndex, patientIdentifierSystems, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: Record<string, unknown>) => { audit.push(e); },
  };
});

import { runIdentifierSystemsList, runIdentifierSystemsSet, runPatientsList, runPatientsShow } from './patients';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

const ROW = { ref: 'r', id: null, name: 'J*** M***', sex: 'M', birthDate: '1990', ageYears: 36, identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: '•••0001' }], managingFacility: null, active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2 };

beforeEach(() => {
  vi.restoreAllMocks();
  audit.length = 0;
  for (const f of [...Object.values(patientIndex), ...Object.values(patientIdentifierSystems)]) f.mockReset();
});

describe('openldr patients', () => {
  it('list is masked by default and writes no audit', async () => {
    patientIndex.list.mockResolvedValue({ rows: [ROW], total: 1, masked: true });
    const io = capture();
    expect(await runPatientsList({ json: false, identifiers: false })).toBe(0);
    expect(patientIndex.list).toHaveBeenCalledWith({ q: '', status: 'active', limit: 25, offset: 0 }, { unmask: false });
    expect(io.out()).toContain('J*** M***');
    expect(io.out()).toContain('MPI •••0001');
    expect(audit).toEqual([]);
  });

  it('list --identifiers unmasks and audits the count, not the search', async () => {
    patientIndex.list.mockResolvedValue({ rows: [{ ...ROW, id: 'hl7-1', name: 'John Mwanza' }], total: 1, masked: false });
    capture();
    expect(await runPatientsList({ search: 'MPI-0001', json: false, identifiers: true })).toBe(0);
    expect(patientIndex.list.mock.calls[0][1]).toEqual({ unmask: true });
    expect(audit).toEqual([{ action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { count: 1 } }]);
  });

  it('list refuses a bad status in the route parser\'s words', async () => {
    const io = capture();
    expect(await runPatientsList({ status: 'gone', json: false, identifiers: false })).toBe(1);
    expect(io.err()).toContain('status must be active, merged or all');
  });

  it('show prints the patient and its requests; --identifiers audits the id', async () => {
    patientIndex.getById.mockResolvedValue({ ...ROW, id: 'hl7-1', name: 'John Mwanza', patientGuid: 'G-1', phone: null, email: null, masked: false });
    patientIndex.requestsById.mockResolvedValue({ rows: [{ authoredAt: '2026-03-04', panel: 'VL', requester: 'Chilenje', status: 'completed', resultCount: 2 }], total: 1 });
    const io = capture();
    expect(await runPatientsShow('hl7-1', { json: false, identifiers: true })).toBe(0);
    expect(io.out()).toContain('John Mwanza');
    expect(io.out()).toContain('2026-03-04  VL  Chilenje  completed  2 result(s)');
    expect(audit).toEqual([{ action: 'patients.view', entityType: 'patient', entityId: 'hl7-1' }]);
  });

  it('show reports a missing patient and exits 1', async () => {
    const { PatientIndexError } = await import('@openldr/bootstrap');
    patientIndex.getById.mockRejectedValue(new PatientIndexError('patient not found', 'not-found'));
    const io = capture();
    expect(await runPatientsShow('nope', { json: false, identifiers: false })).toBe(1);
    expect(io.err()).toContain('patients show failed: patient not found');
  });

  it('identifier-systems list prints label, count and flags', async () => {
    patientIdentifierSystems.list.mockResolvedValue({ rows: [{ system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: false }], total: 1, ownedHere: true });
    const io = capture();
    expect(await runIdentifierSystemsList({ json: false })).toBe(0);
    expect(io.out()).toContain('urn:zm:mpi  MPI  3 patient(s)  listed  not searched');
  });

  it('identifier-systems set keeps unspecified flags and audits', async () => {
    patientIdentifierSystems.get.mockResolvedValue({ system: 'urn:zm:mpi', label: 'Old', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: true });
    patientIdentifierSystems.set.mockResolvedValue({ system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: false });
    capture();
    expect(await runIdentifierSystemsSet('urn:zm:mpi', { label: 'MPI', searchable: 'off', json: false })).toBe(0);
    expect(patientIdentifierSystems.set).toHaveBeenCalledWith({ system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: false });
    expect(audit[0]).toMatchObject({ action: 'patients.identifier_system.update', entityId: 'urn:zm:mpi' });
  });

  it('identifier-systems set refuses a flag that is not on or off', async () => {
    const io = capture();
    expect(await runIdentifierSystemsSet('urn:zm:mpi', { listColumn: 'yes', json: false })).toBe(1);
    expect(io.err()).toContain('--list-column must be on or off');
  });
});
