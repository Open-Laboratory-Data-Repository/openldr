import { describe, it, expect } from 'vitest';
import { parseContentPack, summarizeContentPack, ContentPackError } from './content-pack';

const full = {
  formatVersion: 1,
  steps: [
    { kind: 'code-system', resource: { resourceType: 'CodeSystem', url: 'urn:x:cs', name: 'Colours' } },
    { kind: 'value-set', resource: { resourceType: 'ValueSet', url: 'urn:x:vs' } },
    { kind: 'facility-register', url: 'urn:x:reg', name: 'Sites', code: 'sites', csv: 'id,name\n1,A\n\n2,B\r\n3,C\n' },
    { kind: 'link-matching', registerUrl: 'urn:x:reg' },
    { kind: 'custom-queries', file: { queries: [{ name: 'Q one' }, { name: 'Q two' }] } },
  ],
};

describe('content pack', () => {
  it('parses a pack with one step of each kind', () => {
    expect(parseContentPack(full).steps).toHaveLength(5);
  });
  it('rejects an unknown formatVersion', () => {
    expect(() => parseContentPack({ ...full, formatVersion: 2 })).toThrow('this pack needs a newer CE');
    expect(() => parseContentPack({ ...full, formatVersion: 2 })).toThrow(ContentPackError);
  });
  it('rejects an unknown step kind', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'dashboard' }] })).toThrow('this pack needs a newer CE');
  });
  it('rejects a malformed known step', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'link-matching' }] })).toThrow(/invalid pack/);
  });
  it('summarizes each step kind', () => {
    expect(summarizeContentPack(parseContentPack(full))).toEqual([
      { kind: 'code-system', label: 'Colours', count: 1 },
      { kind: 'value-set', label: 'urn:x:vs', count: 1 },
      { kind: 'facility-register', label: 'Sites', count: 3 },
      { kind: 'link-matching', label: 'urn:x:reg', count: 1 },
      { kind: 'custom-queries', label: 'Q one, Q two', count: 2 },
    ]);
  });
});
