import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  class LayoutError extends Error { constructor(public code: string, message: string) { super(message); } }
  return {
    LayoutError,
    listLayouts: vi.fn(),
    saveLayout: vi.fn(),
    deleteLayout: vi.fn(),
    recordAuditEvent: vi.fn(),
    ctx: { close: vi.fn(), internalDb: {} },
  };
});
vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => m.ctx),
  listLayouts: m.listLayouts, saveLayout: m.saveLayout, deleteLayout: m.deleteLayout,
  recordAuditEvent: m.recordAuditEvent, LayoutError: m.LayoutError,
}));

import { runLayoutsList, runLayoutsSet, runLayoutsDelete } from './layouts';

const bench = { id: 'l1', name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['bench'] };

describe('openldr layouts', () => {
  let out: { mock: { calls: unknown[][] }; mockRestore(): void };
  let err: { mock: { calls: unknown[][] }; mockRestore(): void };
  beforeEach(() => {
    vi.clearAllMocks();
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { out.mockRestore(); err.mockRestore(); });

  it('lists layouts as JSON or one line each', async () => {
    m.listLayouts.mockResolvedValue({ layouts: [bench], roleOrder: ['bench'] });
    expect(await runLayoutsList({ json: true })).toBe(0);
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toEqual({ layouts: [bench], roleOrder: ['bench'] });
    expect(await runLayoutsList({ json: false })).toBe(0);
    // The id is shown: `openldr user preferences set <user> layout <id>` needs it.
    expect(String(out.mock.calls[1]![0])).toBe('Bench\tl1\tstart /forms\t2 pages\troles bench\n');
  });

  it('set creates a layout by name, with pages, start page and roles from the flags', async () => {
    m.listLayouts.mockResolvedValue({ layouts: [], roleOrder: [] });
    m.saveLayout.mockResolvedValue(bench);
    expect(await runLayoutsSet('Bench', { pages: '/forms, /patients', startPage: '/forms', roles: 'bench', json: false })).toBe(0);
    expect(m.saveLayout).toHaveBeenCalledWith(m.ctx.internalDb, null, { name: 'Bench', pages: ['/forms', '/patients'], startPage: '/forms', roles: ['bench'] }, expect.any(String));
    expect(m.recordAuditEvent).toHaveBeenCalledWith(m.ctx, expect.objectContaining({ actorType: 'cli' }), { action: 'layout.create', entityType: 'layout', entityId: 'l1', metadata: { name: 'Bench' } });
  });

  it('set updates an existing layout by name, keeping roles and start page that were not given', async () => {
    m.listLayouts.mockResolvedValue({ layouts: [bench], roleOrder: ['bench'] });
    m.saveLayout.mockResolvedValue({ ...bench, pages: ['/forms'] });
    expect(await runLayoutsSet('Bench', { pages: '/forms', json: false })).toBe(0);
    expect(m.saveLayout).toHaveBeenCalledWith(m.ctx.internalDb, 'l1', { name: 'Bench', pages: ['/forms'], startPage: '/forms', roles: ['bench'] }, expect.any(String));
    expect(m.recordAuditEvent).toHaveBeenCalledWith(m.ctx, expect.anything(), expect.objectContaining({ action: 'layout.update' }));
  });

  it('set with --start-page none clears the start page', async () => {
    m.listLayouts.mockResolvedValue({ layouts: [bench], roleOrder: [] });
    m.saveLayout.mockResolvedValue({ ...bench, startPage: null });
    await runLayoutsSet('Bench', { pages: '/forms', startPage: 'none', json: false });
    expect(m.saveLayout.mock.calls[0]![2]).toMatchObject({ startPage: null });
  });

  it('a refused layout exits 1 with the reason and no audit row', async () => {
    m.listLayouts.mockResolvedValue({ layouts: [], roleOrder: [] });
    m.saveLayout.mockRejectedValue(new m.LayoutError('unknown-role', 'no role nope'));
    expect(await runLayoutsSet('X', { pages: '/forms', roles: 'nope', json: false })).toBe(1);
    expect(String(err.mock.calls[0]![0])).toBe('layouts set failed: no role nope\n');
    expect(m.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('delete refuses without --force, and deletes by name with it', async () => {
    m.listLayouts.mockResolvedValue({ layouts: [bench], roleOrder: [] });
    expect(await runLayoutsDelete('Bench', { force: false })).toBe(1);
    expect(m.deleteLayout).not.toHaveBeenCalled();
    m.deleteLayout.mockResolvedValue(bench);
    expect(await runLayoutsDelete('Bench', { force: true })).toBe(0);
    expect(m.deleteLayout).toHaveBeenCalledWith(m.ctx.internalDb, 'l1');
    expect(m.recordAuditEvent).toHaveBeenCalledWith(m.ctx, expect.anything(), expect.objectContaining({ action: 'layout.delete', entityId: 'l1' }));
    expect(await runLayoutsDelete('Nope', { force: true })).toBe(1);
  });
});
