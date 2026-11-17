import { describe, it, expect } from 'vitest';
import { buildBody } from './use-workflow-api';

describe('buildBody: Save sends the graph and name only (review C7-1)', () => {
  it('leaves out enabled and description, so the server keeps the stored ones', () => {
    const body = buildBody({ id: 'wf_1', name: 'Copy', nodes: [], edges: [] });
    expect(body).toMatchObject({ id: 'wf_1', name: 'Copy' });
    expect(Object.keys(body)).not.toContain('enabled');
    expect(Object.keys(body)).not.toContain('description');
  });
});
