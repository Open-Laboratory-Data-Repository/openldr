import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';
import './index';

describe('ServiceRequest with a contained PractitionerRole requester', () => {
  it('validates', () => {
    const result = validateResource({
      resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order',
      subject: { reference: 'Patient/p1' },
      contained: [{
        resourceType: 'PractitionerRole', id: 'requester',
        practitioner: { display: 'Dr Mushi' },
        organization: { identifier: { system: 'urn:openldr:default_fac', value: 'IBPAA' }, display: 'KCMC' },
      }],
      requester: { reference: '#requester' },
    });
    expect(result.ok).toBe(true);
  });
});
