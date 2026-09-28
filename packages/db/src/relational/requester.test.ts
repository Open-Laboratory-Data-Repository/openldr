import { describe, it, expect } from 'vitest';
import { requesterFacility } from './requester';
import { projectServiceRequest } from './service-request';

const FAC = 'urn:openldr:default_fac';
const NONE = { code: null, system: null, display: null };

describe('requesterFacility', () => {
  it('reads the clinic from a contained PractitionerRole', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      contained: [{
        resourceType: 'PractitionerRole', id: 'requester',
        practitioner: { display: 'Dr Mushi' },
        organization: { identifier: { system: FAC, value: 'IBPAA' }, display: 'KCMC' },
      }],
      requester: { reference: '#requester' },
    };
    expect(requesterFacility(sr)).toEqual({ code: 'IBPAA', system: FAC, display: 'KCMC' });
  });

  it('reads a direct facility reference (corlix shape)', () => {
    const sr = { resourceType: 'ServiceRequest', requester: { identifier: { system: 'urn:mfl', value: '10123' }, display: 'Kibong\'oto' } };
    expect(requesterFacility(sr)).toEqual({ code: '10123', system: 'urn:mfl', display: 'Kibong\'oto' });
  });

  it('ignores a free-text clinician (CE lab-order form)', () => {
    expect(requesterFacility({ resourceType: 'ServiceRequest', requester: { display: 'Dr Mushi' } })).toEqual(NONE);
  });

  it('gives nulls for a contained PractitionerRole with no organization', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      contained: [{ resourceType: 'PractitionerRole', id: 'requester', practitioner: { display: 'Dr Mushi' } }],
      requester: { reference: '#requester' },
    };
    expect(requesterFacility(sr)).toEqual(NONE);
  });

  it('gives nulls when the # reference names nothing contained', () => {
    expect(requesterFacility({ resourceType: 'ServiceRequest', requester: { reference: '#missing' } })).toEqual(NONE);
  });

  it('gives nulls when the contained resource is not a PractitionerRole', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      contained: [{ resourceType: 'Organization', id: 'requester', identifier: [{ system: FAC, value: 'IBPAA' }] }],
      requester: { reference: '#requester' },
    };
    expect(requesterFacility(sr)).toEqual(NONE);
  });

  it('gives nulls with no requester', () => {
    expect(requesterFacility({ resourceType: 'ServiceRequest' })).toEqual(NONE);
  });
});

describe('projectServiceRequest requester columns', () => {
  it('writes the clinic into requester_code/system/display', () => {
    const row = projectServiceRequest({
      resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
      contained: [{ resourceType: 'PractitionerRole', id: 'requester', organization: { identifier: { system: FAC, value: 'IBPAA' }, display: 'KCMC' } }],
      requester: { reference: '#requester' },
    }, {});
    expect(row).toMatchObject({ requester_code: 'IBPAA', requester_system: FAC, requester_display: 'KCMC' });
  });
});
