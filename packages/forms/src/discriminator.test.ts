import { describe, expect, it } from 'vitest';
import { discriminatorLabel } from './discriminator';

describe('discriminatorLabel', () => {
  it('returns null when there is no discriminator', () => {
    expect(discriminatorLabel(undefined)).toBeNull();
  });

  it('returns null for an empty discriminator, so the row skips the line', () => {
    expect(discriminatorLabel({})).toBeNull();
  });

  it('renders one condition as a sentence', () => {
    expect(discriminatorLabel({ system: 'urn:x' })).toBe('system = urn:x');
  });

  it('sorts keys, so one discriminator always reads the same', () => {
    expect(discriminatorLabel({ use: 'work', system: 'phone' })).toBe('system = phone, use = work');
  });
});
