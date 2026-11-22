import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';
import { listResourceTypes } from '../registry';

const task = {
  resourceType: 'Task',
  status: 'requested',
  intent: 'order',
  focus: { reference: 'ServiceRequest/sr1' },
  for: { reference: 'Patient/p1' },
  owner: { reference: 'Organization/lab1' },
  authoredOn: '2026-11-22T08:00:00Z',
  note: [{ text: 'sent from the ward' }],
};

const provenance = {
  resourceType: 'Provenance',
  target: [{ reference: 'Observation/o1' }],
  recorded: '2026-11-22T08:00:00Z',
  agent: [{ who: { display: 'jane' } }],
  reason: [{ text: 'wrong unit' }],
};

describe('Task / Provenance', () => {
  it('validates a Task', () => {
    expect(validateResource(task).ok).toBe(true);
  });
  it('rejects a Task with a status outside the list', () => {
    expect(validateResource({ ...task, status: 'finished' }).ok).toBe(false);
  });
  it('rejects a Task with no intent', () => {
    const { intent: _intent, ...noIntent } = task;
    expect(validateResource(noIntent).ok).toBe(false);
  });
  it('validates a Provenance', () => {
    expect(validateResource(provenance).ok).toBe(true);
  });
  it('rejects a Provenance with no target', () => {
    const { target: _target, ...noTarget } = provenance;
    expect(validateResource(noTarget).ok).toBe(false);
  });
  it('rejects a Provenance with an empty target list', () => {
    expect(validateResource({ ...provenance, target: [] }).ok).toBe(false);
  });
  it('registers both resource types', () => {
    const types = listResourceTypes();
    expect(types).toContain('Task');
    expect(types).toContain('Provenance');
  });
});

describe('Specimen and ServiceRequest lab fields', () => {
  it('keeps Specimen.condition', () => {
    const condition = [{ text: 'haemolysed' }];
    const r = validateResource({ resourceType: 'Specimen', condition });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resource['condition']).toEqual(condition);
  });
  it('keeps ServiceRequest.requisition and replaces', () => {
    const requisition = { system: 'urn:example:requisition', value: 'REQ-1' };
    const replaces = [{ reference: 'ServiceRequest/old1' }];
    const r = validateResource({
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: 'Patient/p1' },
      requisition,
      replaces,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resource['requisition']).toEqual(requisition);
      expect(r.resource['replaces']).toEqual(replaces);
    }
  });
  it('rejects a Specimen.condition that is not a list', () => {
    expect(validateResource({ resourceType: 'Specimen', condition: { text: 'haemolysed' } }).ok).toBe(false);
  });
});
