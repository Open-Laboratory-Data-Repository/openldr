import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { CapabilityDiagnosis } from '@openldr/db';

const mocks = vi.hoisted(() => ({
  dbCtx: { internalDb: { marker: 'internal-db' }, close: vi.fn() },
  createDbContext: vi.fn(),
  createAppContext: vi.fn(),
  diagnoseCapabilities: vi.fn(),
  createRoleStore: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createDbContext: mocks.createDbContext,
  createAppContext: mocks.createAppContext,
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@openldr/db');
  return { ...actual, createRoleStore: mocks.createRoleStore };
});

import { runRolesDoctor, summarizeDiagnosis } from './roles';

const clean: CapabilityDiagnosis = {
  roles: [{ slug: 'lab_admin', present: true, ok: ['roles.manage'], revoked: [], pending: [] }],
  orphaned: [],
  ledgerAvailable: true,
};

describe('summarizeDiagnosis', () => {
  it('exits 0 and says so when there is no drift', () => {
    const { exitCode, lines } = summarizeDiagnosis(clean);
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('no capability drift requiring action');
  });

  // A revoke is an operator DECISION, not a defect — reporting it must not fail the command.
  it('exits 0 for a revoked-only diagnosis but still names it', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_technician', present: true, ok: ['forms.view'], revoked: ['forms.submit'], pending: [] }],
      orphaned: [],
      ledgerAvailable: true,
    });
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('forms.submit');
  });

  // This is the state the live defect produces; the command exists to make it visible.
  it('exits 1 when a capability is pending', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_admin', present: true, ok: [], revoked: [], pending: ['data_exposure.manage'] }],
      orphaned: [],
      ledgerAvailable: true,
    });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('pending=[data_exposure.manage]');
  });

  it('exits 1 when a capability key is orphaned', () => {
    const { exitCode } = summarizeDiagnosis({ ...clean, orphaned: [{ slug: 'bench', capability: 'retired.key' }] });
    expect(exitCode).toBe(1);
  });

  it('exits 1 when a preset role row is missing entirely', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_admin', present: false, ok: [], revoked: [], pending: [] }],
      orphaned: [],
      ledgerAvailable: true,
    });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('MISSING');
  });

  // The ledger being unreadable means reconciliation is silently disabled for unlocked presets AND
  // that every missing capability gets folded into the conservative `revoked` class below — a
  // benign-looking, all-`revoked` report is exactly what this state produces. Without this signal
  // an operator (or a script) has no way to tell "deliberately revoked" from "we cannot tell".
  it('exits 1 and names the condition when the ledger is unavailable', () => {
    const { exitCode, lines } = summarizeDiagnosis({ ...clean, ledgerAvailable: false });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('ledger unavailable');
    expect(lines.join('\n')).toContain('DISABLED');
  });
});

describe('runRolesDoctor', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
    mocks.diagnoseCapabilities.mockResolvedValue({ ...clean });
    mocks.createRoleStore.mockReturnValue({ diagnoseCapabilities: mocks.diagnoseCapabilities });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // THE crux of Fix 1: this command must be read-only. createAppContext() reconciles on
  // construction (seedSystemRoles()), which would repair the very drift being diagnosed before
  // diagnoseCapabilities() ever runs — making `pending` and `present: false` unreachable through
  // this command. Going through createDbContext + createRoleStore instead means no seeding ever
  // happens.
  it('goes through createDbContext, never createAppContext, and calls diagnoseCapabilities via createRoleStore', async () => {
    const code = await runRolesDoctor({ json: false });

    expect(mocks.createDbContext).toHaveBeenCalledOnce();
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    expect(mocks.createRoleStore).toHaveBeenCalledWith(mocks.dbCtx.internalDb);
    expect(mocks.diagnoseCapabilities).toHaveBeenCalledOnce();
    expect(code).toBe(0);
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('emits the computed exit code alongside the diagnosis in --json output', async () => {
    mocks.diagnoseCapabilities.mockResolvedValue({
      roles: [{ slug: 'lab_admin', present: true, ok: [], revoked: [], pending: ['data_exposure.manage'] }],
      orphaned: [],
      ledgerAvailable: true,
    });

    const code = await runRolesDoctor({ json: true });

    expect(code).toBe(1);
    const payload = JSON.parse(out);
    expect(payload.exitCode).toBe(1);
    expect(payload.roles[0].pending).toContain('data_exposure.manage');
  });
});
