import { describe, expect, it } from 'vitest';
import { buildPathTable, type FhirPathRow } from './build-table';

// A miniature .d.ts in the exact shape @types/fhir emits: optional members typed
// `X | undefined`, string-literal unions wrapped in parentheses, `_x` siblings carrying
// primitive extensions, and a `readonly resourceType` discriminator.
const FIXTURE = `
export interface Element {
  /** Unique id for inter-element referencing */
  id?: string | undefined;
}
export interface Period extends Element {
  /** Starting time with inclusive boundary */
  start?: string | undefined;
}
export interface Reference extends Element {
  /** Literal reference, Relative, internal or absolute URL */
  reference?: string | undefined;
}
export interface Identifier extends Element {
  /**
   * usual | official | temp | secondary | old
   * The purpose of this identifier.
   */
  use?: ('usual'|'official'|'temp'|'secondary'|'old') | undefined;
  _use?: Element | undefined;
  /** The value that is unique */
  value?: string | undefined;
  /** Organization that issued id */
  assigner?: Reference | undefined;
}
export interface Widget {
  /** Resource Type Name (for serialization) */
  readonly resourceType: 'Widget';
  /** Business identifier */
  identifier?: Identifier[] | undefined;
  /**
   * Name of the widget
   * The human readable name, which does not need to be unique.
   */
  name?: string | undefined;
  _name?: Element | undefined;
  /** When it was valid */
  period?: Period | undefined;
}
`;

function build(maxDepth = 3): FhirPathRow[] {
  return buildPathTable(FIXTURE, { roots: ['Widget'], maxDepth, stopTypes: ['Reference'] });
}

function at(rows: FhirPathRow[], path: string): FhirPathRow | undefined {
  return rows.find((r) => r.path === path);
}

describe('buildPathTable', () => {
  it('emits a primitive leaf with the JSDoc first line as its label', () => {
    expect(at(build(), 'Widget.name')).toEqual({
      path: 'Widget.name',
      leafType: 'string',
      isArray: false,
      label: 'Name of the widget',
    });
  });

  it('marks a path as an array when ANY segment on the way is an array', () => {
    // Widget.identifier is Identifier[], so the string leaf below it is still array-reached.
    expect(at(build(), 'Widget.identifier.value')).toMatchObject({ leafType: 'string', isArray: true });
    expect(at(build(), 'Widget.period.start')).toMatchObject({ leafType: 'string', isArray: false });
  });

  it('skips the _x primitive-extension siblings', () => {
    expect(build().some((r) => r.path.split('.').some((seg) => seg.startsWith('_')))).toBe(false);
  });

  it('skips the resourceType discriminator', () => {
    expect(at(build(), 'Widget.resourceType')).toBeUndefined();
  });

  it('flattens a string-literal union to the code type', () => {
    expect(at(build(), 'Widget.identifier.use')).toMatchObject({ leafType: 'code', isArray: true });
  });

  it('emits a stop type but does not recurse into it', () => {
    expect(at(build(), 'Widget.identifier.assigner')).toMatchObject({ leafType: 'Reference' });
    expect(at(build(), 'Widget.identifier.assigner.reference')).toBeUndefined();
  });

  it('follows the extends chain for inherited members', () => {
    // Period declares only `start`; `id` is inherited from Element.
    expect(at(build(), 'Widget.period.id')).toMatchObject({ leafType: 'string' });
  });

  it('honours maxDepth, counting segments after the root', () => {
    const shallow = build(1).map((r) => r.path);
    expect(shallow).toEqual(['Widget.identifier', 'Widget.name', 'Widget.period']);
  });

  it('returns rows sorted by path so output is deterministic', () => {
    const paths = build().map((r) => r.path);
    expect(paths).toEqual([...paths].sort());
  });
});
