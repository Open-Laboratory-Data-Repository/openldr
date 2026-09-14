import { describe, expect, it } from 'vitest';
import { childrenOf, descendantIds, eligibleParents, groupDepth } from './group-tree';
import { makeField } from './__fixtures__/forms';

const outer = makeField({ id: 'outer', displayLabel: 'Visit', fieldType: 'group', order: 0 });
const inner = makeField({ id: 'inner', displayLabel: 'Symptom', fieldType: 'group', order: 1, groupId: 'outer' });
const leafB = makeField({ id: 'leafB', displayLabel: 'Severity', fieldType: 'text', order: 3, groupId: 'inner' });
const leafA = makeField({ id: 'leafA', displayLabel: 'Duration', fieldType: 'text', order: 2, groupId: 'inner' });
const other = makeField({ id: 'other', displayLabel: 'Other group', fieldType: 'group', order: 4 });
const loose = makeField({ id: 'loose', displayLabel: 'Notes', fieldType: 'text', order: 5 });
const FIELDS = [outer, inner, leafB, leafA, other, loose];

describe('childrenOf', () => {
  it('returns direct children in form order', () => {
    expect(childrenOf(FIELDS, 'inner').map((f) => f.id)).toEqual(['leafA', 'leafB']);
  });
});

describe('descendantIds', () => {
  it('collects every id beneath a group, at any depth', () => {
    expect([...descendantIds(FIELDS, 'outer')].sort()).toEqual(['inner', 'leafA', 'leafB']);
  });

  it('stops on a cycle instead of hanging', () => {
    const a = makeField({ id: 'a', displayLabel: 'A', fieldType: 'group', order: 0, groupId: 'b' });
    const b = makeField({ id: 'b', displayLabel: 'B', fieldType: 'group', order: 1, groupId: 'a' });
    expect([...descendantIds([a, b], 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('groupDepth', () => {
  it('is 0 at the top level and counts ancestors below it', () => {
    expect(groupDepth(FIELDS, 'outer')).toBe(0);
    expect(groupDepth(FIELDS, 'inner')).toBe(1);
    expect(groupDepth(FIELDS, 'leafA')).toBe(2);
  });

  it('stops on a cycle instead of hanging', () => {
    const a = makeField({ id: 'a', displayLabel: 'A', fieldType: 'group', order: 0, groupId: 'b' });
    const b = makeField({ id: 'b', displayLabel: 'B', fieldType: 'group', order: 1, groupId: 'a' });
    expect(groupDepth([a, b], 'a')).toBe(1);
  });
});

describe('eligibleParents', () => {
  it('offers every group except the field itself and its descendants', () => {
    expect(eligibleParents(FIELDS, 'outer').map((f) => f.id)).toEqual(['other']);
  });

  it('offers only groups', () => {
    expect(eligibleParents(FIELDS, 'loose').map((f) => f.id)).toEqual(['outer', 'inner', 'other']);
  });
});
