import { describe, it, expect } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import { compileBuilderQuery } from './compile';
import { getModel, MODELS } from './models/registry';
import { scopeCondition, NO_SCOPE_LINK, type ResolvedScope } from './scope';

// Layer: the SQL text and bound values only (roles part 3). pg-mem cannot run correlated
// subqueries, so the counts are proven in scope.postgres.test.ts on a disposable PostgreSQL.
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: {} as never }) });
const scope: ResolvedScope = {
  registryIds: ['reg-1'], regions: ['Dodoma'], districts: [{ region: 'Arusha', district: 'Kondoa' }], registryCodes: ['FAC-1'],
};
const count = { key: 'count', agg: 'count' as const };

describe('scopeCondition', () => {
  it('binds every scope value and never inlines one', () => {
    const { sql, parameters } = db.selectFrom('lab_requests').select('id').where(scopeCondition('request', 'lab_requests', scope)).compile();
    for (const v of ['reg-1', 'Dodoma', 'Arusha', 'Kondoa', 'FAC-1']) {
      expect(parameters).toContain(v);
      expect(sql).not.toContain(v);
    }
    expect(sql).toContain('exists');
    expect(sql).not.toMatch(/\bjoin\b/);
  });

  it('matches nothing for a limit with nothing listed', () => {
    const empty: ResolvedScope = { registryIds: [], regions: [], districts: [], registryCodes: [] };
    for (const kind of ['request', 'report', 'result'] as const) {
      const { sql } = db.selectFrom('lab_requests').select('id').where(scopeCondition(kind, 'lab_requests', empty)).compile();
      expect(sql).toMatch(/1 = 0/);
    }
  });
});

describe('compileBuilderQuery with a scope', () => {
  it('ANDs the scope after a filter tree with OR, so the OR cannot widen it', () => {
    const { sql } = compileBuilderQuery(db, getModel('service_requests')!, {
      mode: 'builder', model: 'service_requests', metric: count, filters: [],
      filterTree: { kind: 'group', combinator: 'or', children: [
        { kind: 'rule', dimension: 'status', op: 'eq', value: 'final' },
        { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
      ] },
    } as never, undefined, scope).compile();
    const where = sql.slice(sql.indexOf(' where '));
    // The user's OR group is wrapped, and the scope is a separate AND term after it.
    expect(where).toMatch(/^ where \("status" = \$1 or "priority" = \$2\) and \(+exists/);
  });

  it('adds the scope to each linked model and to no query without one', () => {
    for (const id of ['service_requests', 'observations', 'diagnostic_reports']) {
      const m = getModel(id)!;
      const q = { mode: 'builder', model: id, metric: count, filters: [] } as never;
      expect(compileBuilderQuery(db, m, q, undefined, scope).compile().sql, id).toContain('facility_map');
      expect(compileBuilderQuery(db, m, q).compile().sql, id).not.toContain('facility_map');
    }
  });

  it('refuses a model with no facility link for a limited user', () => {
    const unlinked = MODELS.filter((m) => !m.scopeLink).map((m) => m.id).sort();
    expect(unlinked).toEqual(['facilities', 'patients', 'specimens']);
    for (const id of unlinked) {
      expect(() => compileBuilderQuery(db, getModel(id)!, { mode: 'builder', model: id, metric: count, filters: [] } as never, undefined, scope))
        .toThrow(NO_SCOPE_LINK);
    }
  });

  // Review Q1: a user join can match any column, so the joined rows are not limited. A limited user
  // gets "Not available" for a query with one; the built-in joins follow the base row's own keys.
  it('refuses a user join for a limited user, and keeps it for everyone else', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: count, filters: [],
      dimension: { key: 'joined_lab' },
      userJoins: [{ id: 'u1', table: 'diagnostic_reports', left: 'status', right: 'status' }],
      adhocDimensions: [{ key: 'joined_lab', label: 'Joined lab', join: 'u1', column: 'performer', kind: 'string' }],
    } as never;
    expect(() => compileBuilderQuery(db, getModel('service_requests')!, q, undefined, scope)).toThrow(NO_SCOPE_LINK);
    expect(compileBuilderQuery(db, getModel('service_requests')!, q).compile().sql).toContain('"u1"');
  });
});
