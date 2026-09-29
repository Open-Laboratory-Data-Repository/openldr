import { describe, it, expect } from 'vitest';
import { requestFacts, reportFacts } from './request-facts';
import { projectServiceRequest, projectServiceRequestAttributes } from './service-request';
import { projectDiagnosticReport } from './diagnostic-report';

const ext = (url: string, value: Record<string, unknown>) => ({ url: `urn:openldr:ext:${url}`, ...value });

const fullRequest = {
  resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
  identifier: [
    { system: 'urn:openldr:request-id', value: 'TZDISATDS0012345' },
    { system: 'urn:openldr:obr-set-id', value: '2' },
  ],
  locationCode: [{ text: 'KCMC~Medical Ward 2' }],
  note: [{ text: 'fever' }],
  contained: [{ resourceType: 'PractitionerRole', id: 'requester', practitioner: { display: 'Dr Mushi' } }],
  requester: { reference: '#requester' },
  extension: [
    ext('analysis-time', { valueDateTime: '2018-06-01T10:00:00+03:00' }),
    ext('registered-by', { valueString: 'AB' }),
    ext('tested-by', { valueString: 'CD' }),
    ext('request-type', { valueCode: 'D' }),
    ext('age-at-request', { extension: [{ url: 'years', valueInteger: 34 }, { url: 'days', valueInteger: 12418 }] }),
    ext('analyzer', { valueCode: 'ALINK' }),
    ext('rejection', { extension: [{ url: 'code', valueCode: 'R01' }, { url: 'reason', valueString: 'Haemolysed' }] }),
    ext('some-future-thing', { valueString: 'ignored' }),
  ],
};

describe('requestFacts', () => {
  it('reads every slot', () => {
    expect(requestFacts(fullRequest)).toEqual({
      obr_set_id: 2, analysis_at: '2018-06-01T10:00:00+03:00', point_of_care: 'KCMC~Medical Ward 2',
      request_type: 'D', registered_by: 'AB', tested_by: 'CD', requester_practitioner: 'Dr Mushi',
      age_years: 34, age_days: 12418, clinical_info: 'fever', analyzer_code: 'ALINK',
      rejection_code: 'R01', rejection_reason: 'Haemolysed',
    });
  });

  it('gives NULL for every absent fact', () => {
    const facts = requestFacts({ resourceType: 'ServiceRequest', id: 'sr-2' });
    expect(Object.values(facts).every((v) => v === null)).toBe(true);
    expect(Object.keys(facts)).toHaveLength(13);
  });

  it('ignores a non-numeric OBR set id instead of guessing', () => {
    const facts = requestFacts({ ...fullRequest, identifier: [{ system: 'urn:openldr:obr-set-id', value: 'x' }] });
    expect(facts.obr_set_id).toBeNull();
  });

  it('is part of the lab_requests row', () => {
    expect(projectServiceRequest(fullRequest, {})).toMatchObject({ analysis_at: '2018-06-01T10:00:00+03:00', obr_set_id: 2 });
  });
});

describe('reportFacts', () => {
  it('reads section and authorised by', () => {
    const dr = {
      resourceType: 'DiagnosticReport', id: 'dr-1',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'HM' }] }],
      resultsInterpreter: [{ display: 'Dr Kimaro' }],
    };
    expect(reportFacts(dr)).toEqual({ section_code: 'HM', authorised_by: 'Dr Kimaro' });
    expect(projectDiagnosticReport(dr, {})).toMatchObject({ section_code: 'HM', authorised_by: 'Dr Kimaro' });
  });

  it('ignores a category from another system', () => {
    const dr = { resourceType: 'DiagnosticReport', id: 'dr-2', category: [{ coding: [{ system: 'urn:other', code: 'X' }] }] };
    expect(reportFacts(dr).section_code).toBeNull();
  });
});

describe('projectServiceRequestAttributes', () => {
  const attr = (code: string, value: Record<string, unknown>) => ({
    url: 'urn:openldr:ext:request-attribute',
    extension: [{ url: 'code', valueCoding: { system: 'urn:openldr:cs:request-attribute', code } }, { url: 'value', ...value }],
  });

  it('writes one row per attribute, each value in its typed column', () => {
    const rows = projectServiceRequestAttributes({
      resourceType: 'ServiceRequest', id: 'sr-1',
      extension: [
        attr('therapy', { valueString: 'ART' }),
        attr('cost-units', { valueDecimal: 12.5 }),
        attr('newborn', { valueBoolean: true }),
        attr('prereg-registration-time', { valueDateTime: '2018-06-01T08:00:00+03:00' }),
      ],
    }, { sourceSystem: 'webhook-ingest' });
    expect(rows.map((r) => [r.code, r.value_text, r.value_number, r.value_boolean, r.value_datetime])).toEqual([
      ['therapy', 'ART', null, null, null],
      ['cost-units', null, 12.5, null, null],
      ['newborn', null, null, true, null],
      ['prereg-registration-time', null, null, null, '2018-06-01T08:00:00+03:00'],
    ]);
    expect(rows.every((r) => r.lab_request_id === 'sr-1' && r.system === 'urn:openldr:cs:request-attribute' && r.source_system === 'webhook-ingest')).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  });

  it('skips an attribute with no code or no value', () => {
    const rows = projectServiceRequestAttributes({
      resourceType: 'ServiceRequest', id: 'sr-1',
      extension: [
        { url: 'urn:openldr:ext:request-attribute', extension: [{ url: 'value', valueString: 'orphan' }] },
        { url: 'urn:openldr:ext:request-attribute', extension: [{ url: 'code', valueCoding: { system: 'urn:openldr:cs:request-attribute', code: 'therapy' } }] },
      ],
    }, {});
    expect(rows).toEqual([]);
  });

  it('keeps the last value when the same code repeats, so the row id stays unique', () => {
    const rows = projectServiceRequestAttributes({
      resourceType: 'ServiceRequest', id: 'sr-1',
      extension: [attr('therapy', { valueString: 'A' }), attr('therapy', { valueString: 'B' })],
    }, {});
    expect(rows.map((r) => r.value_text)).toEqual(['B']);
  });
});
