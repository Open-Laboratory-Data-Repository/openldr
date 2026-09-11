import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbCtx: { pendingMigrations: vi.fn(), close: vi.fn(), internalDb: { marker: 'internalDb' } },
  appCtx: { close: vi.fn() },
  createDbContext: vi.fn(),
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
  readAuthIssuerBinding: vi.fn(),
  rebindAuthIssuer: vi.fn(),
}));

const NEW_ISSUER = 'https://lab.example.org/auth/realms/openldr';
const OLD_ISSUER = 'https://192.168.1.20:8443/auth/realms/openldr';

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ OIDC_ISSUER_URL: NEW_ISSUER })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createDbContext: mocks.createDbContext,
  createAppContext: mocks.createAppContext,
  recordAuditEvent: mocks.recordAuditEvent,
  readAuthIssuerBinding: mocks.readAuthIssuerBinding,
  rebindAuthIssuer: mocks.rebindAuthIssuer,
}));

import { runAuthRebindIssuer } from './auth';

describe('auth rebind-issuer', () => {
  let out: string;
  let err: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { err += String(chunk); return true; });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: [] });
    mocks.readAuthIssuerBinding.mockResolvedValue(OLD_ISSUER);
    mocks.rebindAuthIssuer.mockResolvedValue({ previous: OLD_ISSUER });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('refuses without --force, names both issuers, and changes nothing', async () => {
    const code = await runAuthRebindIssuer({ json: false, force: false });

    expect(code).toBe(1);
    expect(err).toContain(OLD_ISSUER);
    expect(err).toContain(NEW_ISSUER);
    expect(err).toContain('--force');
    expect(mocks.rebindAuthIssuer).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('with --force binds the configured issuer and audits the move as cli', async () => {
    const code = await runAuthRebindIssuer({ json: true, force: true });

    expect(code).toBe(0);
    expect(mocks.rebindAuthIssuer).toHaveBeenCalledWith(mocks.dbCtx.internalDb, NEW_ISSUER);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.appCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'auth.issuer.rebind', entityType: 'auth_issuer_binding', metadata: { from: OLD_ISSUER, to: NEW_ISSUER } }),
    );
    expect(JSON.parse(out)).toEqual({ ok: true, changed: true, from: OLD_ISSUER, to: NEW_ISSUER });
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('reports nothing to change when the binding already matches', async () => {
    mocks.readAuthIssuerBinding.mockResolvedValue(NEW_ISSUER);

    const code = await runAuthRebindIssuer({ json: true, force: true });

    expect(code).toBe(0);
    expect(mocks.rebindAuthIssuer).not.toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual({ ok: true, changed: false, from: NEW_ISSUER, to: NEW_ISSUER });
  });

  it('reports nothing to change before the first start', async () => {
    mocks.readAuthIssuerBinding.mockResolvedValue(null);

    const code = await runAuthRebindIssuer({ json: true, force: false });

    expect(code).toBe(0);
    expect(mocks.rebindAuthIssuer).not.toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual({ ok: true, changed: false, from: null, to: NEW_ISSUER });
  });

  it('refuses while migrations are pending and never reads the binding', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: ['098_auth_issuer_binding'], external: [] });

    const code = await runAuthRebindIssuer({ json: false, force: true });

    expect(code).toBe(1);
    expect(out + err).toContain('openldr db migrate');
    expect(mocks.readAuthIssuerBinding).not.toHaveBeenCalled();
    expect(mocks.rebindAuthIssuer).not.toHaveBeenCalled();
  });

  it('keeps the rebind when the audit write fails', async () => {
    mocks.createAppContext.mockRejectedValue(new Error('audit unavailable'));

    const code = await runAuthRebindIssuer({ json: true, force: true });

    expect(code).toBe(0);
    expect(mocks.rebindAuthIssuer).toHaveBeenCalled();
  });
});
