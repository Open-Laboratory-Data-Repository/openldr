import { describe, it, expect } from 'vitest';
import { projectDiagnosticReport } from './diagnostic-report';

describe('projectDiagnosticReport', () => {
  // ⛔ THE load-bearing test. `DisaGlobal.dbo.LOCNDIC4` holds five distinct facilities whose
  // DESCRIPTION is all exactly 'Aga Khan' (codes BAMAA/BBFAF/CDABE/EAFAE/NDFAM). Before this fix
  // the projection used `performer[0].display` as the match key, so all five collapsed onto one
  // `performer: 'Aga Khan'` row — Dodoma's results would be attributed to Dar es Salaam. The wire
  // now carries `performer[0].identifier.value` (a FHIR logical reference — `identifier` is for a
  // target with no resource to point at; `display` is a human label that must never be used for
  // matching), and THAT must become the match key.
  it('uses identifier.value, not display, as the match key — two facilities sharing a display stay distinct', () => {
    const bamaa = projectDiagnosticReport(
      { id: 'dr-1', performer: [{ identifier: { system: 'urn:openldr:default_fac', value: 'BAMAA' }, display: 'Aga Khan' }] },
      {},
    );
    const cdabe = projectDiagnosticReport(
      { id: 'dr-2', performer: [{ identifier: { system: 'urn:openldr:default_fac', value: 'CDABE' }, display: 'Aga Khan' }] },
      {},
    );

    expect(bamaa.performer).toBe('BAMAA');
    expect(cdabe.performer).toBe('CDABE');
    expect(bamaa.performer).not.toBe(cdabe.performer);
    expect(bamaa.performer_display).toBe('Aga Khan');
    expect(cdabe.performer_display).toBe('Aga Khan');
    expect(bamaa.performer_system).toBe('urn:openldr:default_fac');
  });

  it('carries the display separately from the match key', () => {
    const r = projectDiagnosticReport(
      { id: 'dr-1', performer: [{ identifier: { value: 'NDFAM' }, display: 'Aga Khan' }] },
      {},
    );
    expect(r.performer).toBe('NDFAM');
    expect(r.performer_display).toBe('Aga Khan');
    // `identifier.system` was omitted on the wire (source has no system id) -> null, not 'undefined'.
    expect(r.performer_system).toBeNull();
  });

  // `identifier.system` is omitted when the source has no system id — must not crash, must not
  // fabricate a system string.
  it('leaves performer_system null when identifier.system is absent', () => {
    const r = projectDiagnosticReport({ id: 'dr-1', performer: [{ identifier: { value: 'BAMAA' } }] }, {});
    expect(r.performer_system).toBeNull();
  });

  // A sender that still only emits `display` (no Organization resource, no identifier either) must
  // still project a usable match key — the pre-existing fallback chain must keep working.
  it('falls back to display when there is no identifier', () => {
    const r = projectDiagnosticReport({ id: 'dr-1', performer: [{ display: 'Mnazi Mmoja' }] }, {});
    expect(r.performer).toBe('Mnazi Mmoja');
    expect(r.performer_display).toBe('Mnazi Mmoja');
    expect(r.performer_system).toBeNull();
  });

  // A sender that contributes a real Organization resource (reference, no display, no identifier)
  // must still fall back to the reference id, exactly as before this change.
  it('falls back to the reference id when there is no identifier and no display', () => {
    const r = projectDiagnosticReport({ id: 'dr-1', performer: [{ reference: 'Organization/org-1' }] }, {});
    expect(r.performer).toBe('org-1');
    expect(r.performer_display).toBeNull();
  });

  it('is null throughout when there is no performer at all', () => {
    const r = projectDiagnosticReport({ id: 'dr-1' }, {});
    expect(r.performer).toBeNull();
    expect(r.performer_display).toBeNull();
    expect(r.performer_system).toBeNull();
  });
});
