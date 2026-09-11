import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const ctx = vi.hoisted(() => ({ close: vi.fn(), workflows: { receipts: { list: vi.fn(), get: vi.fn() } } }));
vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: vi.fn(async () => ctx), dangerResetDashboards: vi.fn(), dangerClearAudit: vi.fn(), dangerFactoryReset: vi.fn() }));
import { buildProgram } from './program';
const receipt = { id: 'request-1', workflowId: 'workflow-1', status: 'interrupted', runId: 'run-1', createdAt: '2026-09-11T00:00:00Z', startedAt: '2026-09-11T00:00:01Z', finishedAt: null, reason: 'Worker stopped', outcome: null };
describe('workflow receipt CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });
  it('lists the requested page as JSON through the shared receipt service', async () => {
    ctx.workflows.receipts.list.mockResolvedValue([receipt]);
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'list', 'workflow-1', '--limit', '10', '--offset', '20', '--json']);
    expect(ctx.workflows.receipts.list).toHaveBeenCalledWith('workflow-1', { limit: 10, offset: 20 });
    expect(process.stdout.write).toHaveBeenCalledWith(JSON.stringify([receipt], null, 2) + '\n');
    expect(ctx.close).toHaveBeenCalledOnce();
  });
  it('shows interruption details without invoking execution', async () => {
    ctx.workflows.receipts.get.mockResolvedValue(receipt);
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'show', 'request-1', '--json']);
    expect(ctx.workflows.receipts.get).toHaveBeenCalledWith('request-1');
    expect(process.stdout.write).toHaveBeenCalledWith(JSON.stringify(receipt, null, 2) + '\n');
    expect(ctx.close).toHaveBeenCalledOnce();
  });
  it.each(['0', '101', '1.5', '10oops'])('rejects invalid limit %s before reading receipts', async limit => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'list', 'workflow-1', '--limit', limit]);
    expect(process.exitCode).toBe(1);
    expect(ctx.workflows.receipts.list).not.toHaveBeenCalled();
  });
  it('uses bounded defaults and prints an empty page', async () => {
    ctx.workflows.receipts.list.mockResolvedValue([]);
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'list', 'workflow-1']);
    expect(ctx.workflows.receipts.list).toHaveBeenCalledWith('workflow-1', { limit: 25, offset: 0 });
    expect(process.stdout.write).toHaveBeenCalledWith('(no receipts)\n');
  });
  it.each(['-1', '1.5', '9007199254740992'])('rejects invalid offset %s before reading receipts', async offset => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'list', 'workflow-1', '--offset', offset]);
    expect(process.exitCode).toBe(1);
    expect(ctx.workflows.receipts.list).not.toHaveBeenCalled();
  });
  it('returns failure for a missing receipt and closes resources', async () => {
    ctx.workflows.receipts.get.mockResolvedValue(null);
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'show', 'missing', '--json']);
    expect(process.exitCode).toBe(1);
    expect(process.stdout.write).toHaveBeenCalledWith('{"error":"receipt not found"}\n');
    expect(ctx.close).toHaveBeenCalledOnce();
  });
  it('closes resources after a read failure without printing raw errors', async () => {
    ctx.workflows.receipts.get.mockRejectedValue(new Error('private payload'));
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'receipts', 'show', 'request-1']);
    expect(process.exitCode).toBe(1);
    expect(ctx.close).toHaveBeenCalledOnce();
    expect(process.stderr.write).toHaveBeenCalledWith('Workflow receipt unavailable.\n');
  });
});
