import { describe, expect, it } from 'vitest';
import { projectResource, tableForResourceType } from './index';

describe('relational projectResource', () => {
  it('maps Patient -> patients (denormalized, sex code)', () => {
    const out = projectResource({ resourceType: 'Patient', id: 'p1', identifier: [{ value: 'MRN-1' }], name: [{ family: 'Doe', given: ['Jane'] }], gender: 'female', birthDate: '1990-01-01', telecom: [{ system: 'phone', value: '123' }], managingOrganization: { reference: 'Organization/org-1' } });
    expect(out?.table).toBe('patients');
    expect(out?.rows[0]).toMatchObject({ id: 'p1', patient_guid: 'MRN-1', surname: 'Doe', firstname: 'Jane', sex: 'F', date_of_birth: '1990-01-01', phone: '123', managing_organization: 'Organization/org-1' });
  });

  it('maps ServiceRequest -> lab_requests (soft patient_id, denormalized code+system)', () => {
    const out = projectResource({ resourceType: 'ServiceRequest', id: 'sr1', identifier: [{ value: 'ACC-1' }], status: 'active', priority: 'routine', authoredOn: '2026-01-01', subject: { reference: 'Patient/p1' }, code: { coding: [{ system: 'http://loinc.org', code: '100', display: 'CBC' }] } });
    expect(out?.table).toBe('lab_requests');
    expect(out?.rows[0]).toMatchObject({ id: 'sr1', request_id: 'ACC-1', patient_id: 'p1', panel_code: '100', panel_system: 'http://loinc.org', panel_desc: 'CBC', status: 'active', priority: 'routine', authored_at: '2026-01-01' });
  });

  it('maps Observation -> lab_results (numeric result, soft request_id)', () => {
    const out = projectResource({ resourceType: 'Observation', id: 'o1', basedOn: [{ reference: 'ServiceRequest/sr1' }], subject: { reference: 'Patient/pt-1' }, specimen: { reference: 'Specimen/sp-1' }, code: { coding: [{ system: 'http://loinc.org', code: '200', display: 'Glucose' }] }, valueQuantity: { value: 5.5, unit: 'mmol/L' }, interpretation: [{ coding: [{ code: 'H' }] }], effectiveDateTime: '2026-01-02' });
    expect(out?.table).toBe('lab_results');
    expect(out?.rows[0]).toMatchObject({ id: 'o1', request_id: 'sr1', observation_code: '200', observation_system: 'http://loinc.org', result_type: 'NM', numeric_value: 5.5, numeric_units: 'mmol/L', abnormal_flag: 'H', result_timestamp: '2026-01-02', patient_id: 'pt-1', specimen_id: 'sp-1' });
  });

  it('maps Organization and Location -> facilities with a source discriminator', () => {
    const org = projectResource({ resourceType: 'Organization', id: 'org1', identifier: [{ value: 'F1' }], name: 'Central Lab', type: [{ text: 'lab' }] });
    expect(org).toMatchObject({ table: 'facilities', rows: [{ id: 'org1', facility_code: 'F1', facility_name: 'Central Lab', facility_type: 'lab', source_resource: 'Organization' }] });
    const loc = projectResource({ resourceType: 'Location', id: 'loc1', name: 'Ward A' });
    expect(loc).toMatchObject({ table: 'facilities', rows: [{ id: 'loc1', facility_name: 'Ward A', source_resource: 'Location' }] });
  });

  // The CDR toolchain now sends an `Organization` per testing facility with `address[0]` carrying
  // `state` (region) and `district` — the two disambiguators for DISA's five identically-named
  // "Aga Khan" facility codes. Measured: no `line`/`city`/`postalCode`/`country` on the wire.
  it('maps Organization.address[0].state/district -> facilities.region/district', () => {
    const org = projectResource({
      resourceType: 'Organization', id: 'facility-BAMAA', identifier: [{ system: 'urn:openldr:default_fac', value: 'BAMAA' }],
      name: 'Aga Khan', address: [{ state: 'Dar es Salaam', district: 'Ilala' }],
    });
    expect(org).toMatchObject({ table: 'facilities', rows: [{ id: 'facility-BAMAA', facility_code: 'BAMAA', region: 'Dar es Salaam', district: 'Ilala' }] });
  });

  it('projects region/district as null when a sender supplies no address at all', () => {
    const org = projectResource({ resourceType: 'Organization', id: 'org2', identifier: [{ value: 'F2' }], name: 'No Address Lab' });
    expect(org).toMatchObject({ table: 'facilities', rows: [{ id: 'org2', region: null, district: null }] });
  });

  it('projects region/district as null (no crash) when address is an empty array', () => {
    const org = projectResource({ resourceType: 'Organization', id: 'org3', identifier: [{ value: 'F3' }], name: 'Empty Address Lab', address: [] });
    expect(org).toMatchObject({ table: 'facilities', rows: [{ id: 'org3', region: null, district: null }] });
  });

  it('projects whichever of region/district is missing as null, keeping the other', () => {
    const stateOnly = projectResource({ resourceType: 'Organization', id: 'org4', identifier: [{ value: 'F4' }], name: 'State Only Lab', address: [{ state: 'Tanga' }] });
    expect(stateOnly).toMatchObject({ table: 'facilities', rows: [{ id: 'org4', region: 'Tanga', district: null }] });
    const districtOnly = projectResource({ resourceType: 'Organization', id: 'org5', identifier: [{ value: 'F5' }], name: 'District Only Lab', address: [{ district: 'Kinondoni' }] });
    expect(districtOnly).toMatchObject({ table: 'facilities', rows: [{ id: 'org5', region: null, district: 'Kinondoni' }] });
  });

  it('still projects a Location with no address exactly as before (region/district null)', () => {
    const loc = projectResource({ resourceType: 'Location', id: 'loc2', name: 'Ward B' });
    expect(loc).toMatchObject({ table: 'facilities', rows: [{ id: 'loc2', facility_name: 'Ward B', region: null, district: null }] });
  });

  it('maps Specimen -> specimens (bare patient_id, received_time)', () => {
    const out = projectResource({ resourceType: 'Specimen', id: 'sp1', subject: { reference: 'Patient/p1' }, receivedTime: '2026-01-01T00:00:00Z', type: { text: 'Blood' }, status: 'available' });
    expect(out?.table).toBe('specimens');
    expect(out?.rows[0]).toMatchObject({ id: 'sp1', patient_id: 'p1', received_time: '2026-01-01T00:00:00Z', type_text: 'Blood', status: 'available' });
  });

  it('maps Specimen -> specimens (origin extension)', () => {
    const out = projectResource({
      resourceType: 'Specimen',
      id: 'sp2',
      subject: { reference: 'Patient/p1' },
      receivedTime: '2026-01-01T00:00:00Z',
      type: { text: 'Blood' },
      status: 'available',
      extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/specimen-origin', valueCode: 'inpatient' }],
    });
    expect(out?.table).toBe('specimens');
    expect(out?.rows[0]).toMatchObject({ id: 'sp2', origin: 'inpatient' });
  });

  it('maps DiagnosticReport -> diagnostic_reports (bare patient_id, code, issued)', () => {
    const out = projectResource({ resourceType: 'DiagnosticReport', id: 'dr1', subject: { reference: 'Patient/p1' }, status: 'final', code: { coding: [{ code: 'CBC' }], text: 'Complete Blood Count' }, issued: '2026-01-02T00:00:00Z', conclusion: 'ok' });
    expect(out?.table).toBe('diagnostic_reports');
    expect(out?.rows[0]).toMatchObject({ id: 'dr1', patient_id: 'p1', status: 'final', code_code: 'CBC', code_text: 'Complete Blood Count', issued: '2026-01-02T00:00:00Z', conclusion: 'ok' });
  });

  // The facility dimension for AMR reporting. `patients.managing_organization` is never set by the
  // CDR/DISA source (1 of 589 measured), but `DiagnosticReport.performer[0].display` is populated on
  // every ingested report — so this is where "resistance by facility" actually gets its facility.
  it('maps DiagnosticReport performer + specimen to the facility columns', () => {
    const out = projectResource({
      resourceType: 'DiagnosticReport', id: 'dr2', subject: { reference: 'Patient/p1' },
      performer: [{ display: 'Mnazi Mmoja' }],
      specimen: [{ reference: 'Specimen/sp-1' }],
    });
    expect(out?.rows[0]).toMatchObject({ performer: 'Mnazi Mmoja', specimen_id: 'sp-1' });
  });

  it('falls back to the performer reference id when a sender contributes Organizations', () => {
    // DISA supplies a bare display and no Organization resource; a richer sender may do the
    // opposite. Neither should land a null facility.
    const out = projectResource({
      resourceType: 'DiagnosticReport', id: 'dr3', performer: [{ reference: 'Organization/org-9' }],
    });
    expect(out?.rows[0]).toMatchObject({ performer: 'org-9' });
  });

  it('leaves the facility columns null when the report carries neither', () => {
    const out = projectResource({ resourceType: 'DiagnosticReport', id: 'dr4' });
    expect(out?.rows[0]).toMatchObject({ performer: null, specimen_id: null });
  });

  it('projects DiagnosticReport.basedOn into based_on_id', () => {
    const out = projectResource({
      resourceType: 'DiagnosticReport', id: 'req1-obr1', basedOn: [{ reference: 'ServiceRequest/req1-obr1' }],
      subject: { reference: 'Patient/pt-1' }, issued: '2013-06-05T10:30:00+03:00',
    });
    expect(out?.rows[0]).toMatchObject({ id: 'req1-obr1', based_on_id: 'req1-obr1' });
  });

  it('leaves based_on_id null when DiagnosticReport has no basedOn', () => {
    const out = projectResource({ resourceType: 'DiagnosticReport', id: 'req2-obr1', subject: { reference: 'Patient/pt-2' } });
    expect(out?.rows[0].based_on_id).toBeNull();
  });

  it('returns null for non-projected types', () => {
    expect(projectResource({ resourceType: 'Bundle' })).toBeNull();
    expect(tableForResourceType('Bundle')).toBeNull();
    expect(tableForResourceType('Patient')).toBe('patients');
    expect(tableForResourceType('Specimen')).toBe('specimens');
    expect(tableForResourceType('DiagnosticReport')).toBe('diagnostic_reports');
  });
});
