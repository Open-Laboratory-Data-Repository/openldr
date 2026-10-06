import { describe, it, expect } from 'vitest';
import { codeSystemProjection } from './code-system-projection';

describe('codeSystemProjection', () => {
  it('uses the resource name and description, and marks a pack import deletable', () => {
    const p = codeSystemProjection('urn:test:cs:sites', null, { name: 'Test sites', description: 'Sites.', origin: 'pack', originRef: 'p1' });
    expect(p).toMatchObject({ url: 'urn:test:cs:sites', systemName: 'Test sites', description: 'Sites.', origin: 'pack', originRef: 'p1', seeded: false });
  });
  it('keeps a core seed protected', () => {
    expect(codeSystemProjection('urn:test:cs:x', '1', { origin: 'core' }).seeded).toBe(true);
  });
  it('derives the name and sets no origin or seeded flag without meta', () => {
    const p = codeSystemProjection('urn:test:cs:x', null);
    expect(p.systemName).toBe(p.systemCode);
    expect(p).not.toHaveProperty('origin');
    expect(p).not.toHaveProperty('seeded');
    expect(p).not.toHaveProperty('description');
  });
});
