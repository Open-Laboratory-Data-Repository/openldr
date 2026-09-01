import { describe, it, expect } from 'vitest';
import { statusOf, cellStatusesFor } from './draw';
import type { DesignElement } from '../schema';
import type { ResolvedTable } from './pagination';

describe('F3: conditional rules compile into status tokens', () => {
  it('numeric ops, string equality fallback, and no-hit means no status', () => {
    const gte = { key: 'silent', rule: { op: 'gte' as const, value: '10', status: 'critical' as const } };
    expect(statusOf(gte, { silent: 12 })).toBe('critical');
    expect(statusOf(gte, { silent: '10' })).toBe('critical');
    expect(statusOf(gte, { silent: 9 })).toBeUndefined();
    expect(statusOf(gte, { silent: 'n/a' })).toBeUndefined();
    const eq = { key: 'flag', rule: { op: 'eq' as const, value: 'R', status: 'abnormal' as const } };
    expect(statusOf(eq, { flag: 'R' })).toBe('abnormal');
    expect(statusOf(eq, { flag: 'S' })).toBeUndefined();
  });

  it('statusKey wins over a rule', () => {
    const c = { key: 'v', statusKey: 's', rule: { op: 'gte' as const, value: '0', status: 'critical' as const } };
    expect(statusOf(c, { v: 100, s: 'normal' })).toBe('normal');
  });

  it('a rule alone opts a table into the status projection', () => {
    const el: DesignElement = {
      id: 't', kind: 'table', name: 't', rect: { x: 0, y: 0, w: 400, h: 200 },
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'silent', label: 'Silent', rule: { op: 'gte', value: '10', status: 'critical' } }],
    };
    const resolved: ResolvedTable = { columns: [{ key: 'silent', label: 'Silent' }], rows: [{ silent: 5 }, { silent: 21 }] };
    expect(cellStatusesFor(el, resolved)).toEqual([[undefined], ['critical']]);
  });
});
