import { describe, it, expect } from 'vitest';
import { testMapId } from './test-map';

describe('testMapId', () => {
  it('is the readable level|system|code while it fits', () => {
    expect(testMapId('test', 'urn:openldr:disa', 'HIVVL')).toBe('test|urn:openldr:disa|HIVVL');
  });

  it('hashes past 200 characters, the same way every time', () => {
    const long = 'x'.repeat(250);
    const a = testMapId('test', 'urn:openldr:disa', long);
    expect(a).toMatch(/^tm-[0-9a-f]+-[0-9a-f]+$/);
    expect(testMapId('test', 'urn:openldr:disa', long)).toBe(a);
  });

  it('keeps the two levels apart for the same code', () => {
    expect(testMapId('test', 's', 'c')).not.toBe(testMapId('result', 's', 'c'));
  });
});
