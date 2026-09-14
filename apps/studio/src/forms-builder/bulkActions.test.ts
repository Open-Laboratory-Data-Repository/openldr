import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import { deleteFields, moveFieldsToSection, toggleFieldsEnabled } from './bulkActions';

const f = (id: string, extra: Partial<FormField> = {}): FormField => ({
  id, displayLabel: id, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});

describe('moveFieldsToSection', () => {
  it('moves the chosen fields into a section, or out of every section', () => {
    const fields = [f('a'), f('b', { section: 'old' }), f('c')];
    const moved = moveFieldsToSection(fields, new Set(['a', 'b']), 'vitals');
    expect(moved.map((x) => x.section)).toEqual(['vitals', 'vitals', undefined]);
    expect(moveFieldsToSection(moved, new Set(['a']), undefined)[0].section).toBeUndefined();
  });
});

describe('toggleFieldsEnabled', () => {
  it('switches all off when at least half are on', () => {
    const fields = [f('a'), f('b', { enabled: false })];
    expect(toggleFieldsEnabled(fields, new Set(['a', 'b'])).map((x) => x.enabled)).toEqual([false, false]);
  });

  it('switches all on when fewer than half are on', () => {
    const fields = [f('a'), f('b', { enabled: false }), f('c', { enabled: false })];
    expect(toggleFieldsEnabled(fields, new Set(['a', 'b', 'c'])).map((x) => x.enabled)).toEqual([true, true, true]);
  });

  it('toggles a single field', () => {
    expect(toggleFieldsEnabled([f('a')], new Set(['a']))[0].enabled).toBe(false);
    expect(toggleFieldsEnabled([f('a', { enabled: false })], new Set(['a']))[0].enabled).toBe(true);
  });

  it('leaves a locked field and fields outside the choice alone', () => {
    const fields = [f('a'), f('b', { locked: true }), f('c')];
    expect(toggleFieldsEnabled(fields, new Set(['a', 'b'])).map((x) => x.enabled)).toEqual([false, true, true]);
  });
});

describe('deleteFields', () => {
  it('removes the chosen fields and keeps a locked one', () => {
    const fields = [f('a'), f('b', { locked: true }), f('c')];
    expect(deleteFields(fields, new Set(['a', 'b'])).map((x) => x.id)).toEqual(['b', 'c']);
  });
});
