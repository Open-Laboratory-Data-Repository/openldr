import { describe, it, expect } from 'vitest';
import { bindQuery } from './bind';
import type { WidgetQuery } from './types';

// The server binds a saved widget's query with this, as the studio does (roles part 2). The studio's
// own DashboardWidget and conditionTree tests cover the full cases through the same code.
describe('bindQuery', () => {
  it('replaces a bound filter with the dashboard value, and a range with two bounds', () => {
    const q = { mode: 'builder', model: 'requests', filters: [{ dimension: 'site', op: 'eq', value: '' }], variableBindings: { site: 'f-site', at: 'f-at' } } as unknown as WidgetQuery;
    const out = bindQuery(q, { 'f-site': 'HCNAM', 'f-at': { from: '2026-01-01', to: '2026-02-01' } });
    expect(out.mode === 'builder' && out.filters).toEqual([
      { dimension: 'site', op: 'eq', value: 'HCNAM' },
      { dimension: 'at', op: 'gte', value: '2026-01-01' },
      { dimension: 'at', op: 'lte', value: '2026-02-01' },
    ]);
  });

  it('leaves a SQL widget\'s text as stored and passes the values beside it', () => {
    const q = { mode: 'sql', sql: 'select 1 where site = {{site}}', variableBindings: { site: 'f-site' } } as unknown as WidgetQuery;
    const out = bindQuery(q, { 'f-site': 'HCNAM' }) as { sql: string; values: Record<string, unknown> };
    expect(out.sql).toBe('select 1 where site = {{site}}');
    expect(out.values).toEqual({ site: 'HCNAM' });
  });
});
