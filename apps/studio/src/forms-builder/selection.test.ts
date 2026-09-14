import { describe, expect, it } from 'vitest';
import { NO_SELECTION, clickSelection, moveAnchor, selectAllRows, selectOnly, withoutRows } from './selection';

const ORDER = ['a', 'b', 'c', 'd'];
const plain = { range: false, toggle: false };
const shift = { range: true, toggle: false };
const ctrl = { range: false, toggle: true };
const ids = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort();

describe('clickSelection', () => {
  it('a plain click selects the row alone and anchors it', () => {
    const next = clickSelection({ ids: new Set(['a', 'b']), anchor: 'a' }, 'c', ORDER, plain);
    expect(ids(next)).toEqual(['c']);
    expect(next.anchor).toBe('c');
  });

  it('Shift-click selects from the anchor to the row, either way, and keeps the anchor', () => {
    expect(ids(clickSelection(selectOnly('b'), 'd', ORDER, shift))).toEqual(['b', 'c', 'd']);
    const up = clickSelection(selectOnly('c'), 'a', ORDER, shift);
    expect(ids(up)).toEqual(['a', 'b', 'c']);
    expect(up.anchor).toBe('c');
  });

  it('Shift-click with no anchor selects the row alone, as corlix does', () => {
    expect(clickSelection(NO_SELECTION, 'b', ORDER, shift)).toEqual(selectOnly('b'));
  });

  it('Shift-click on a row that is not drawn changes nothing', () => {
    const current = selectOnly('a');
    expect(clickSelection(current, 'hidden', ORDER, shift)).toBe(current);
  });

  it('Ctrl-click adds or removes the row and anchors it', () => {
    const added = clickSelection(selectOnly('a'), 'c', ORDER, ctrl);
    expect(ids(added)).toEqual(['a', 'c']);
    expect(added.anchor).toBe('c');
    expect(ids(clickSelection(added, 'a', ORDER, ctrl))).toEqual(['c']);
  });
});

describe('selectAllRows', () => {
  it('selects every drawn row and keeps the anchor', () => {
    const next = selectAllRows(selectOnly('b'), ORDER);
    expect(ids(next)).toEqual(ORDER);
    expect(next.anchor).toBe('b');
  });
});

describe('moveAnchor', () => {
  it('starts at the top going down and the bottom going up', () => {
    expect(moveAnchor(NO_SELECTION, ORDER, 1)).toEqual(selectOnly('a'));
    expect(moveAnchor(NO_SELECTION, ORDER, -1)).toEqual(selectOnly('d'));
  });

  it('moves one row and wraps at the ends', () => {
    expect(moveAnchor(selectOnly('b'), ORDER, 1)).toEqual(selectOnly('c'));
    expect(moveAnchor(selectOnly('d'), ORDER, 1)).toEqual(selectOnly('a'));
    expect(moveAnchor(selectOnly('a'), ORDER, -1)).toEqual(selectOnly('d'));
  });

  it('does nothing on an empty list', () => {
    expect(moveAnchor(NO_SELECTION, [], 1)).toBe(NO_SELECTION);
  });
});

describe('withoutRows', () => {
  it('drops the rows and clears the anchor only when it went too', () => {
    const current = { ids: new Set(['a', 'b', 'c']), anchor: 'b' };
    expect(withoutRows(current, new Set(['c']))).toEqual({ ids: new Set(['a', 'b']), anchor: 'b' });
    expect(withoutRows(current, new Set(['b'])).anchor).toBeNull();
  });
});
