import { describe, it, expect } from 'vitest';
import { summarizeDiagnosis } from './roles';
import type { CapabilityDiagnosis } from '@openldr/db';

const clean: CapabilityDiagnosis = {
  roles: [{ slug: 'lab_admin', present: true, ok: ['roles.manage'], revoked: [], pending: [] }],
  orphaned: [],
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
    });
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('forms.submit');
  });

  // This is the state the live defect produces; the command exists to make it visible.
  it('exits 1 when a capability is pending', () => {
    const { exitCode, lines } = summarizeDiagnosis({
      roles: [{ slug: 'lab_admin', present: true, ok: [], revoked: [], pending: ['data_exposure.manage'] }],
      orphaned: [],
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
    });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('MISSING');
  });
});
