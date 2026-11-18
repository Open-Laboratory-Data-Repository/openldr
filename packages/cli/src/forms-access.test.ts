import { describe, it, expect, vi, beforeEach } from 'vitest';

// `openldr forms access` (design 2026-11-18-roles-scope, part 1). The checks are the bootstrap
// function the route uses, so the real one runs here against an in-memory store.
const mocks = vi.hoisted(() => ({
  lists: {} as Record<string, { open: string[]; submit: string[] }>,
  recordAuditEvent: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/bootstrap', async () => {
  const real = await vi.importActual<typeof import('../../bootstrap/src/form-access')>('../../bootstrap/src/form-access');
  return {
    setFormAccess: real.setFormAccess,
    FormAccessError: real.FormAccessError,
    recordAuditEvent: mocks.recordAuditEvent,
    createAppContext: async () => ({
      forms: { async get(id: string) { return id === 'form-1' ? { id } : null; } },
      roles: { async list() { return [{ id: 'r-tech', slug: 'lab_technician', name: 'Lab Technician' }, { id: 'r-mgr', slug: 'lab_manager', name: 'Lab Manager' }]; } },
      formAccessStore: {
        async get(id: string) { return mocks.lists[id] ?? { open: [], submit: [] }; },
        async set(id: string, a: { open: string[]; submit: string[] }) { mocks.lists[id] = a; },
      },
      close: mocks.close,
    }),
  };
});
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runFormsAccess } from './forms';

function out(): string {
  return vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
}

describe('runFormsAccess', () => {
  beforeEach(() => {
    mocks.lists = {};
    mocks.recordAuditEvent.mockReset();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('shows the lists by role name, and an empty list as everyone with the permission', async () => {
    mocks.lists['form-1'] = { open: ['r-tech'], submit: [] };
    expect(await runFormsAccess('form-1', { json: false, clear: false })).toBe(0);
    expect(out()).toContain('open: Lab Technician (lab_technician)');
    expect(out()).toContain('submit: everyone with the permission');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('sets the lists from role slugs, keeps the list not named, and audits as the cli', async () => {
    mocks.lists['form-1'] = { open: [], submit: ['r-mgr'] };
    expect(await runFormsAccess('form-1', { json: false, clear: false, open: 'lab_technician,lab_manager' })).toBe(0);
    expect(mocks.lists['form-1']).toEqual({ open: ['r-tech', 'r-mgr'], submit: ['r-mgr'] });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      action: 'form.access.set', entityType: 'form', entityId: 'form-1',
      before: { open: [], submit: ['r-mgr'] }, after: { open: ['r-tech', 'r-mgr'], submit: ['r-mgr'] },
    }));
  });

  it('empties both lists with --clear', async () => {
    mocks.lists['form-1'] = { open: ['r-tech'], submit: ['r-mgr'] };
    expect(await runFormsAccess('form-1', { json: false, clear: true })).toBe(0);
    expect(mocks.lists['form-1']).toEqual({ open: [], submit: [] });
  });

  it('refuses --clear with a list, an unknown role and an unknown form, changing nothing', async () => {
    mocks.lists['form-1'] = { open: ['r-tech'], submit: [] };
    expect(await runFormsAccess('form-1', { json: false, clear: true, open: 'lab_manager' })).toBe(1);
    expect(await runFormsAccess('form-1', { json: false, clear: false, submit: 'ghost' })).toBe(1);
    expect(await runFormsAccess('nope', { json: false, clear: false })).toBe(1);
    expect(mocks.lists['form-1']).toEqual({ open: ['r-tech'], submit: [] });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
