import { describe, expect, it } from 'vitest';
import { workflowCreateFromImport } from './workflow-import';

const definition = { nodes: [{ id: 'a' }], edges: [] };

describe('workflowCreateFromImport', () => {
  it('returns null for a file with no definition', () => {
    expect(workflowCreateFromImport({ name: 'No definition' }, 'wf_1')).toBeNull();
  });

  it('keeps enabled false when the file says false', () => {
    const input = workflowCreateFromImport({ name: 'Off', definition, enabled: false }, 'wf_1');
    expect(input?.enabled).toBe(false);
  });

  it('defaults enabled to true when the file omits it', () => {
    const input = workflowCreateFromImport({ name: 'On', definition }, 'wf_1');
    expect(input?.enabled).toBe(true);
  });

  it('uses the given id and createdBy null', () => {
    const input = workflowCreateFromImport({ name: 'Named', definition }, 'wf_given');
    expect(input).toEqual({
      id: 'wf_given',
      name: 'Named',
      description: null,
      definition,
      enabled: true,
      createdBy: null,
    });
  });
});
