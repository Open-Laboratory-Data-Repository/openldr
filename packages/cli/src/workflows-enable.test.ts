import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  ctx: { close: vi.fn(), workflows: { store: {} } },
  setWorkflowEnabled: vi.fn(),
  recordAuditEvent: vi.fn(),
}));
vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => h.ctx),
  setWorkflowEnabled: h.setWorkflowEnabled,
  recordAuditEvent: h.recordAuditEvent,
  dangerResetDashboards: vi.fn(), dangerClearAudit: vi.fn(), dangerFactoryReset: vi.fn(),
}));
import { buildProgram } from './program';

const wf = (enabled: boolean) => ({ id: 'wf_1', name: 'Samples', enabled, definition: { nodes: [], edges: [] } });

describe('openldr workflows enable|disable (follow-up C7-7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('disables through the shared function, audits as cli, and says what still needs a restart', async () => {
    h.setWorkflowEnabled.mockResolvedValue({ before: wf(true), after: wf(false) });
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'disable', 'wf_1']);
    expect(h.setWorkflowEnabled).toHaveBeenCalledWith(h.ctx.workflows.store, 'wf_1', false);
    expect(h.recordAuditEvent).toHaveBeenCalledWith(h.ctx, expect.objectContaining({ actorType: 'cli', actorName: 'cli' }),
      expect.objectContaining({ action: 'workflow.disable', entityType: 'workflow', entityId: 'wf_1' }));
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Samples is disabled'));
    expect(process.exitCode).toBe(0);
    expect(h.ctx.close).toHaveBeenCalledOnce();
  });

  it('prints the refusal when another enabled workflow holds the path, and exits 1', async () => {
    h.setWorkflowEnabled.mockRejectedValue(Object.assign(new Error('The webhook path "samples" is already used by the enabled workflow "Samples".'), { name: 'WebhookPathClaimedError' }));
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'enable', 'wf_2']);
    expect(h.setWorkflowEnabled).toHaveBeenCalledWith(h.ctx.workflows.store, 'wf_2', true);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('already used by the enabled workflow "Samples"'));
    expect(h.recordAuditEvent).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 for an unknown workflow', async () => {
    h.setWorkflowEnabled.mockResolvedValue(null);
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'enable', 'nope']);
    expect(process.stderr.write).toHaveBeenCalledWith('Workflow not found: nope\n');
    expect(process.exitCode).toBe(1);
  });
});
