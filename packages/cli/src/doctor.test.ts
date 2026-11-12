import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/bootstrap', async (original) => ({
  ...await original<typeof import('@openldr/bootstrap')>(),
  createAppContext: vi.fn(), runSetupChecks: vi.fn(), setupCheckDeps: vi.fn(() => ({})),
}));
import { createAppContext, runSetupChecks, type SetupReport } from '@openldr/bootstrap';
import { formatSetupReport, runDoctor } from './doctor';
import { buildProgram } from './program';

// Layer proven here: the command's output, exit code and audit row, with the checks faked.
// The checks themselves are tested in packages/bootstrap/src/setup-checks.test.ts.

afterEach(() => vi.restoreAllMocks());

const report: SetupReport = { ok: false, checks: [
  { id: 'adapters', status: 'pass' },
  { id: 'labName', status: 'warn', hint: 'labNameDefault', fix: '/settings/laboratory' },
  { id: 'connectors', status: 'fail', hint: 'connectorFailed', fix: '/settings/connectors', detail: 'V1 SQL Server' },
  { id: 'sync', status: 'skip' },
] };

function context(audits: unknown[] = []) {
  const ctx = { audit: { record: async (value: unknown) => { audits.push(value); } }, logger: { error: vi.fn() }, close: vi.fn() };
  vi.mocked(createAppContext).mockResolvedValue(ctx as never);
  return ctx;
}

it('prints one line per check, the advice under a warning or failure, and a summary', () => {
  const text = formatSetupReport(report);
  expect(text.split('\n')).toEqual([
    'PASS  Services',
    'WARN  Laboratory name',
    '      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.',
    'FAIL  Connectors: V1 SQL Server',
    '      A connector does not answer. Open Settings, Connectors and run Test or Diagnose on it.',
    'SKIP  Sync with central',
    '',
    '1 failed, 1 warning.',
  ]);
  expect(formatSetupReport({ ok: true, checks: [{ id: 'adapters', status: 'pass' }] })).toMatch(/All checks passed\.$/);
});

it('prints the setup advice while local sign-in has no administrator', () => {
  const text = formatSetupReport({ ok: true, checks: [{ id: 'signIn', status: 'warn', hint: 'signInSetup' }] });
  expect(text.split('\n').slice(0, 2)).toEqual([
    'WARN  Sign-in',
    '      No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.',
  ]);
});

it('exits 1 when a check failed, audits the outcome as the cli, and closes the context', async () => {
  const audits: unknown[] = [];
  const ctx = context(audits);
  vi.mocked(runSetupChecks).mockResolvedValue(report);
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  expect(await runDoctor({ json: false })).toBe(1);
  expect(String(out.mock.calls[0][0])).toContain('FAIL  Connectors: V1 SQL Server');
  expect(audits).toEqual([expect.objectContaining({
    actorType: 'cli', actorName: 'cli', action: 'setup.check',
    metadata: { ok: false, failed: ['connectors'], warned: ['labName'] },
  })]);
  expect(ctx.close).toHaveBeenCalled();
});

it('exits 0 with warnings only, and prints the report as JSON on request', async () => {
  context();
  const warned: SetupReport = { ok: true, checks: [{ id: 'labName', status: 'warn', hint: 'labNameDefault' }] };
  vi.mocked(runSetupChecks).mockResolvedValue(warned);
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  expect(await runDoctor({ json: true })).toBe(0);
  expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual(warned);
});

it('is registered as a top-level command with --json', () => {
  const doctor = buildProgram().commands.find((command) => command.name() === 'doctor');
  expect(doctor).toBeDefined();
  expect(doctor!.options.some((option) => option.long === '--json')).toBe(true);
});
