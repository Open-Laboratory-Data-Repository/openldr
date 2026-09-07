import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
  restore: vi.fn(),
  recordAuditEvent: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: async () => ({
    forms: { listVersions: mocks.listVersions, restore: mocks.restore },
    audit: {}, logger: {}, close: mocks.close,
  }),
  recordAuditEvent: mocks.recordAuditEvent,
}));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runFormsExtract, runFormsRestore, runFormsVersions } from './forms';

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('runFormsExtract', () => {
  it('extracts clinical resources from the sample form + response into a transaction bundle', () => {
    // The new model extracts domain resources (Observation/ServiceRequest) via the
    // ported extractors; entity records (Patient/facility/user) are created by the
    // page-target Save handlers, not by FHIR extraction.
    const out = runFormsExtract(fixture('sample-questionnaire.json'), fixture('sample-response.json'), { subject: { reference: 'Patient/1' } });
    expect(out.invalidCount).toBe(0);
    expect(out.resourceTypes).toContain('ServiceRequest');
    expect((out.bundle as { type: string }).type).toBe('transaction');
  });
});

describe('runFormsVersions', () => {
  it('lists versions newest first', async () => {
    mocks.listVersions.mockResolvedValue([
      { version: 2, versionLabel: 'v2', publishedAt: '2026-01-02T00:00:00.000Z' },
      { version: 1, versionLabel: 'v1', publishedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(await runFormsVersions('form-1', { json: true })).toBe(0);
  });
});

describe('runFormsRestore', () => {
  it('refuses without --force and writes nothing', async () => {
    expect(await runFormsRestore('form-1', '1', { json: false, force: false })).toBe(1);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('rejects a version that is not a positive integer', async () => {
    expect(await runFormsRestore('form-1', 'abc', { json: false, force: true })).toBe(1);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('restores with --force and audits as the cli actor', async () => {
    mocks.restore.mockResolvedValue({ id: 'form-1', name: 'Specimen intake', status: 'draft' });

    expect(await runFormsRestore('form-1', '1', { json: false, force: true })).toBe(0);

    expect(mocks.restore).toHaveBeenCalledWith('form-1', 1);
    // actorType, NOT actorName. cliActor() returns the OS username and only falls back to 'cli'
    // when it cannot read one, so asserting the name passes on CI and fails on a dev machine.
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'form.restore' }),
    );
  });
});
