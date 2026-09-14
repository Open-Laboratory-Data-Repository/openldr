import { describe, expect, it } from 'vitest';
import {
  discriminatorIdentity,
  discriminatorLabel,
  normalizeDiscriminator,
  toStoredDiscriminator,
} from './discriminator';
import { toQuestionnaire } from './to-questionnaire';
import { fromQuestionnaire } from './from-questionnaire';
import { makeField, makeSchema } from './__fixtures__/forms';

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

  it('says "or" under Any, because a comma would read as "and"', () => {
    const rule = { join: 'any' as const, conds: [{ el: 'system', op: 'equals' as const, val: 'a' }, { el: 'system', op: 'equals' as const, val: 'b' }] };
    expect(discriminatorLabel(rule)).toBe('system = a or system = b');
  });

  it('spells out the other two operators', () => {
    const rule = { join: 'all' as const, conds: [{ el: 'use', op: 'not equals' as const, val: 'old' }, { el: 'system', op: 'starts with' as const, val: 'urn:x:' }] };
    expect(discriminatorLabel(rule)).toBe('use != old, system starts with urn:x:');
  });
});

describe('normalizeDiscriminator', () => {
  it('is null when there is no discriminator', () => {
    expect(normalizeDiscriminator(undefined)).toBeNull();
  });

  it('reads an empty record as an empty All rule, which is a real state', () => {
    expect(normalizeDiscriminator({})).toEqual({ join: 'all', conds: [] });
  });

  it('reads a record as equality conditions, keys sorted', () => {
    expect(normalizeDiscriminator({ use: 'work', system: 'phone' })).toEqual({
      join: 'all',
      conds: [{ el: 'system', op: 'equals', val: 'phone' }, { el: 'use', op: 'equals', val: 'work' }],
    });
  });

  it('passes a rule through unchanged', () => {
    const rule = { join: 'any' as const, conds: [{ el: 'system', op: 'starts with' as const, val: 'urn:' }] };
    expect(normalizeDiscriminator(rule)).toBe(rule);
  });
});

describe('discriminatorIdentity', () => {
  it('gives a record and the rule that means the same thing one identity', () => {
    const rule = { join: 'all' as const, conds: [{ el: 'system', op: 'equals' as const, val: 'x' }] };
    expect(discriminatorIdentity({ system: 'x' })).toBe(discriminatorIdentity(rule));
  });

  it('ignores key order', () => {
    expect(discriminatorIdentity({ a: '1', b: '2' })).toBe(discriminatorIdentity({ b: '2', a: '1' }));
  });

  it('tells All from Any over the same conditions', () => {
    const conds = [{ el: 'system', op: 'equals' as const, val: 'a' }, { el: 'system', op: 'equals' as const, val: 'b' }];
    expect(discriminatorIdentity({ join: 'all', conds })).not.toBe(discriminatorIdentity({ join: 'any', conds }));
  });

  it('keys no discriminator and an empty one alike', () => {
    expect(discriminatorIdentity(undefined)).toBe('');
    expect(discriminatorIdentity({})).toBe('');
  });
});

describe('toStoredDiscriminator', () => {
  const eq = (el: string, val: string) => ({ el, op: 'equals' as const, val });

  it('stores plain equality under All as the old record', () => {
    expect(toStoredDiscriminator({ join: 'all', conds: [eq('system', 'x'), eq('use', 'w')] })).toEqual({ system: 'x', use: 'w' });
  });

  it('keeps a rule for Any', () => {
    const rule = { join: 'any' as const, conds: [eq('system', 'x')] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });

  it('keeps a rule for an operator a record cannot say', () => {
    const rule = { join: 'all' as const, conds: [{ el: 'system', op: 'starts with' as const, val: 'urn:' }] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });

  it('keeps a rule when two conditions share an element, which a record would collapse', () => {
    const rule = { join: 'all' as const, conds: [eq('system', 'a'), eq('system', 'b')] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });

  it('keeps a rule when a record would reorder the rows under the author', () => {
    const rule = { join: 'all' as const, conds: [eq('use', 'w'), eq('system', 'x')] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });
});

describe('export round trip', () => {
  it('carries a rule discriminator through the Questionnaire', () => {
    const rule = { join: 'any' as const, conds: [{ el: 'system', op: 'starts with' as const, val: 'urn:x:' }] };
    const schema = makeSchema({
      id: 'f',
      name: 'F',
      fields: [makeField({ id: 'id1', displayLabel: 'ID', fieldType: 'text', order: 0, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: rule })],
    });
    expect(fromQuestionnaire(toQuestionnaire(schema)).fields[0].fhirDiscriminator).toEqual(rule);
  });
});
