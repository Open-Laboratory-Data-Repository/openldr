import { describe, expect, it } from 'vitest';
import { DashboardSchema, type Dashboard } from './types';
import { sqlAuthoringRefusal } from './sql-authoring';

const builderWidget = {
  id: 'w1', type: 'kpi', title: 'Count',
  query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' } },
};
const sqlWidget = {
  id: 'w2', type: 'table', title: 'Rows',
  query: { mode: 'sql', sql: 'SELECT 1 AS n' },
};

const dash = (extra: Record<string, unknown>): Dashboard =>
  DashboardSchema.parse({ id: 'd1', name: 'Test', ...extra });

describe('sqlAuthoringRefusal', () => {
  it('allows a builder-only dashboard with the flag off', () => {
    expect(sqlAuthoringRefusal(dash({ widgets: [builderWidget] }), false, new Set())).toBeNull();
  });

  it('refuses a new sql widget with the flag off', () => {
    expect(sqlAuthoringRefusal(dash({ widgets: [sqlWidget] }), false, new Set()))
      .toBe('raw SQL widgets are disabled');
  });

  it('refuses a filter with new options SQL with the flag off', () => {
    const d = dash({ filters: [{ id: 'f1', label: 'Test', type: 'text', optionsSql: 'SELECT 1' }] });
    expect(sqlAuthoringRefusal(d, false, new Set()))
      .toBe('raw SQL is disabled, so a filter cannot get new options SQL');
  });

  it('allows an empty options SQL with the flag off', () => {
    const d = dash({ filters: [{ id: 'f1', label: 'Test', type: 'text', optionsSql: '  ' }] });
    expect(sqlAuthoringRefusal(d, false, new Set())).toBeNull();
  });

  it('allows SQL that is already stored, compared after trimming', () => {
    const d = dash({
      widgets: [{ ...sqlWidget, query: { mode: 'sql', sql: '  SELECT 1 AS n ' } }],
      filters: [{ id: 'f1', label: 'Test', type: 'text', optionsSql: 'SELECT 1 ' }],
    });
    expect(sqlAuthoringRefusal(d, false, new Set(['SELECT 1 AS n', 'SELECT 1']))).toBeNull();
  });

  it('allows everything with the flag on', () => {
    const d = dash({
      widgets: [sqlWidget],
      filters: [{ id: 'f1', label: 'Test', type: 'text', optionsSql: 'SELECT 1' }],
    });
    expect(sqlAuthoringRefusal(d, true, new Set())).toBeNull();
  });
});
