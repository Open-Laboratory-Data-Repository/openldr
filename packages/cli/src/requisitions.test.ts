import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
  rebuildRequisitions: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/config', async () => {
  const actual = await vi.importActual<typeof import('@openldr/config')>('@openldr/config');
  return { ...actual, loadConfig: vi.fn(() => ({ config: true })) };
});
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }) }));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: mocks.createAppContext, recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@openldr/db', () => ({ rebuildRequisitions: mocks.rebuildRequisitions }));

import { runLabRequisitionsRebuild } from './requisitions';
import { COMMAND_META } from './command-meta';

const ACTOR = { actorType: 'cli', actorId: null, actorName: 'tester' };

describe('openldr lab requisitions rebuild', () => {
  let out: string[];
  let err: string[];
  const internalDb = { db: true };

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({ internalDb, close: mocks.close });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it('refuses without --force and opens nothing', async () => {
    expect(await runLabRequisitionsRebuild({ force: false, json: false })).toBe(1);
    expect(err.join('')).toContain('without --force');
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    expect(mocks.rebuildRequisitions).not.toHaveBeenCalled();
  });

  it('rebuilds with --force, prints the count and audits as the CLI', async () => {
    mocks.rebuildRequisitions.mockResolvedValue({ indexed: 12 });
    expect(await runLabRequisitionsRebuild({ force: true, json: false })).toBe(0);
    expect(mocks.rebuildRequisitions).toHaveBeenCalledWith(internalDb);
    expect(out.join('')).toBe('Indexed 12 orders by requisition number.\n');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), ACTOR, {
      action: 'lab.requisitions.rebuild', entityType: 'lab_requisitions', entityId: 'lab_requisitions', metadata: { indexed: 12 },
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('prints JSON with --json', async () => {
    mocks.rebuildRequisitions.mockResolvedValue({ indexed: 3 });
    await runLabRequisitionsRebuild({ force: true, json: true });
    expect(JSON.parse(out.join(''))).toEqual({ indexed: 3 });
  });

  it('reports a failure and audits nothing', async () => {
    mocks.rebuildRequisitions.mockRejectedValue(new Error('relation "lab_requisitions" does not exist'));
    expect(await runLabRequisitionsRebuild({ force: true, json: false })).toBe(1);
    expect(err.join('')).toContain('lab requisitions rebuild failed:');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  // Served mode: the server refuses an app command when the account lacks this key. It is the only
  // lab command left in CE, and it takes the key of the other whole-table repairs.
  it('is the only lab command, needs settings.danger_zone in served mode, and is destructive', () => {
    expect(Object.keys(COMMAND_META).filter((p) => p.startsWith('lab '))).toEqual(['lab requisitions rebuild']);
    expect(COMMAND_META['lab requisitions rebuild']).toEqual({ kind: 'app', capability: 'settings.danger_zone', destructive: true });
  });
});
