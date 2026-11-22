import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `openldr forms entries` and `openldr forms void-entry` (design 2026-11-22-form-entries). The form
// open rule is the real bootstrap one, against an in-memory store. The entries service is a fake
// that records what it was asked, since its own rules are tested in @openldr/bootstrap.
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  voidEntry: vi.fn(),
}));

vi.mock('@openldr/bootstrap', async () => {
  const real = await vi.importActual<typeof import('../../bootstrap/src/form-access')>('../../bootstrap/src/form-access');
  const lists: Record<string, { open: string[]; submit: string[] }> = { 'form-locked': { open: ['r-clerk'], submit: [] } };
  const store = {
    async get(id: string) { return lists[id] ?? { open: [], submit: [] }; },
    async forForms(ids: string[]) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
  };
  const summaries = [
    { id: 'form-lab', name: 'Lab order' },
    { id: 'form-locked', name: 'Tracking' },
    { id: 'form-a', name: 'Twin' },
    { id: 'form-b', name: 'Twin' },
  ];
  return {
    formUserOf: real.formUserOf,
    formOpenRule: real.formOpenRule,
    createAppContext: async () => ({
      forms: { async list() { return summaries; } },
      formAccess: real.formAccess({ access: store as never }),
      formEntries: { list: mocks.list, get: mocks.get, voidEntry: mocks.voidEntry },
      users: { async get() { return null; } },
      dataScopes: { async get() { return { limited: false }; } },
      close: async () => {},
    }),
  };
});
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runFormsEntries, runFormsVoidEntry } from './form-entries';
import { resetServedHandoffForTests, setServedHandoff } from './served';

const out = () => vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
const err = () => vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('');

const LIMIT = { limited: true as const, facilities: ['fac-1'], districts: [], regions: [] };

function serve(capabilities: string[], roleIds: string[] = ['r-viewer']) {
  setServedHandoff({
    path: 'forms entries', argv: [], runDir: '/tmp/x', keptDirs: [],
    caller: { id: 'u1', username: 'ada', displayName: null, keyName: null, roleIds, capabilities, dataScope: LIMIT },
  });
}

const entry = {
  id: 'e1', formId: 'form-lab', facilityId: 'fac-1', facilityCode: 'F001', facilityName: 'Clinic',
  entryKey: 'REQ-1', summary: [{ label: 'Patient', value: 'Ada' }, { label: 'Test', value: 'HIV VL' }],
  enteredBy: 'u1', enteredByName: 'Ada Clerk', enteredAt: '2026-11-22T08:00:00.000Z',
  status: 'active', statusBy: null, statusAt: null, statusReason: null, saved: null,
};

const listOpts = (o: Partial<{ json: boolean; status: string; limit: string; offset: string; enteredBy: string; search: string }> = {}) => ({ json: false, limit: '25', offset: '0', ...o });
const voidOpts = (o: Partial<{ json: boolean; force: boolean; reason: string }> = {}) => ({ json: false, force: false, reason: 'wrong patient', ...o });

describe('forms entries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue({ entries: [entry], total: 1 });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => resetServedHandoffForTests());

  it('a local run lists by form id with no data limit, and prints a table', async () => {
    expect(await runFormsEntries('form-lab', listOpts())).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith({ formId: 'form-lab', user: { id: '', dataScope: { limited: false } }, limit: 25, offset: 0 });
    expect(out()).toContain('requisition\tstatus\tentered at\tby\tfacility code\tsummary');
    expect(out()).toContain('REQ-1\tactive\t2026-11-22T08:00:00.000Z\tAda Clerk\tF001\tPatient: Ada; Test: HIV VL');
  });

  it('takes an exact form name, a status, a limit and an offset', async () => {
    expect(await runFormsEntries('Lab order', listOpts({ status: 'entered-in-error', limit: '10', offset: '20' }))).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ formId: 'form-lab', status: 'entered-in-error', limit: 10, offset: 20 }));
  });

  it('refuses a name that matches two forms, naming both ids', async () => {
    expect(await runFormsEntries('Twin', listOpts())).toBe(1);
    expect(err()).toContain('form-a');
    expect(err()).toContain('form-b');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('refuses an unknown form, a bad status and a bad limit', async () => {
    expect(await runFormsEntries('nope', listOpts())).toBe(1);
    expect(await runFormsEntries('form-lab', listOpts({ status: 'deleted' }))).toBe(1);
    expect(await runFormsEntries('form-lab', listOpts({ limit: '0' }))).toBe(1);
    expect(await runFormsEntries('form-lab', listOpts({ limit: '101' }))).toBe(1);
    expect(await runFormsEntries('form-lab', listOpts({ offset: '-1' }))).toBe(1);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('passes --entered-by to the service, and refuses one over 200 characters', async () => {
    expect(await runFormsEntries('form-lab', listOpts({ enteredBy: 'u7' }))).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ enteredBy: 'u7' }));
    mocks.list.mockClear();
    expect(await runFormsEntries('form-lab', listOpts({ enteredBy: 'x'.repeat(201) }))).toBe(1);
    expect(err()).toContain('--entered-by');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('passes --search to the service, and refuses one over 100 characters', async () => {
    expect(await runFormsEntries('form-lab', listOpts({ search: 'REQ-' }))).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'REQ-' }));
    mocks.list.mockClear();
    expect(await runFormsEntries('form-lab', listOpts({ search: 'x'.repeat(101) }))).toBe(1);
    expect(err()).toContain('--search');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('--json prints the service result', async () => {
    expect(await runFormsEntries('form-lab', listOpts({ json: true }))).toBe(0);
    expect(JSON.parse(out())).toEqual({ entries: [entry], total: 1 });
  });

  it('a served caller lists with their own id and data limit', async () => {
    serve(['forms.view']);
    expect(await runFormsEntries('form-lab', listOpts())).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'u1', dataScope: LIMIT } }));
  });

  it('a served caller cannot list a form not open to them, by id or by name', async () => {
    serve(['forms.view']);
    expect(await runFormsEntries('form-locked', listOpts())).toBe(1);
    expect(await runFormsEntries('Tracking', listOpts())).toBe(1);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('a served editor and a listed role may list that form', async () => {
    serve(['forms.view', 'forms.edit'], []);
    expect(await runFormsEntries('form-locked', listOpts())).toBe(0);
    resetServedHandoffForTests();
    serve(['forms.view'], ['r-clerk']);
    expect(await runFormsEntries('Tracking', listOpts())).toBe(0);
  });
});

describe('forms void-entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(entry);
    mocks.voidEntry.mockResolvedValue({ entry: { ...entry, status: 'entered-in-error' }, resaved: 3, skipped: 1 });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => resetServedHandoffForTests());

  it('without --force prints the entry, says to use --force, and changes nothing', async () => {
    expect(await runFormsVoidEntry('e1', voidOpts())).toBe(1);
    expect(out()).toContain('REQ-1');
    expect(out()).toContain('Ada Clerk');
    expect(out()).toContain('Patient: Ada; Test: HIV VL');
    expect(err()).toContain('use --force to mark it as entered in error');
    expect(mocks.voidEntry).not.toHaveBeenCalled();
  });

  it('with --force marks it, audits through the CLI actor, and says what it resaved', async () => {
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true, reason: '  wrong patient  ' }))).toBe(0);
    expect(mocks.voidEntry).toHaveBeenCalledWith({
      entryId: 'e1', reason: 'wrong patient', user: { id: '', dataScope: { limited: false } },
      actor: expect.objectContaining({ actorType: 'cli' }),
    });
    expect(out()).toContain('marked e1 as entered in error');
    expect(out()).toContain('resaved 3, skipped 1');
  });

  it('prints the warning when the records were not updated', async () => {
    mocks.voidEntry.mockResolvedValue({ entry, resaved: 0, skipped: 0, warning: 'The records were not updated.' });
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true }))).toBe(0);
    expect(out()).toContain('The records were not updated.');
  });

  it('--json prints the result', async () => {
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true, json: true }))).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ resaved: 3, skipped: 1 });
  });

  it('refuses an empty reason and one over 500 characters', async () => {
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true, reason: '   ' }))).toBe(1);
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true, reason: 'x'.repeat(501) }))).toBe(1);
    expect(mocks.voidEntry).not.toHaveBeenCalled();
  });

  it('answers entry not found for an unknown entry and for one already void', async () => {
    mocks.get.mockResolvedValue(null);
    expect(await runFormsVoidEntry('e9', voidOpts({ force: true }))).toBe(1);
    expect(err()).toContain('entry not found');
    mocks.get.mockResolvedValue(entry);
    mocks.voidEntry.mockResolvedValue('already-void');
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true }))).toBe(1);
    expect(err()).toContain('already marked as entered in error');
  });

  it('a served caller voids with their own id, limit and account as the actor', async () => {
    serve(['forms.view', 'forms.void_entries']);
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true }))).toBe(0);
    expect(mocks.get).toHaveBeenCalledWith('e1', { id: 'u1', dataScope: LIMIT });
    expect(mocks.voidEntry).toHaveBeenCalledWith(expect.objectContaining({
      user: { id: 'u1', dataScope: LIMIT }, actor: expect.objectContaining({ actorType: 'user', actorId: 'u1' }),
    }));
  });

  it('a served caller gets entry not found for an entry of a form not open to them', async () => {
    mocks.get.mockResolvedValue({ ...entry, formId: 'form-locked' });
    serve(['forms.view', 'forms.void_entries']);
    expect(await runFormsVoidEntry('e1', voidOpts({ force: true }))).toBe(1);
    expect(err()).toContain('entry not found');
    expect(out()).not.toContain('REQ-1');
    expect(mocks.voidEntry).not.toHaveBeenCalled();
  });
});
