import { describe, it, expect } from 'vitest';
import { SEED_QUERIES } from '@openldr/reporting';
import { prepareSelect, substituteParams, validateSelectSql, type SqlDialect } from '@openldr/dashboards';

/**
 * Every seeded query, in every dialect, must survive the SELECT-only gate.
 *
 * `validateSelectSql` bans `create`, `call`, `into`, `merge`, `copy`, `grant` and the rest as BARE
 * WORDS anywhere in the query — not only in statement position. A future column alias, CTE name or
 * table alias that IS one of them would pass typecheck, pass every shape regex, seed cleanly, and
 * then fail at RUN TIME on the first click, with nothing in the suite to have caught it. All six
 * transmission-grid variants pass today; this is what keeps them passing.
 *
 * ⚠ The word must be bare. `created` and `call_log` are NOT rejected — `\bcreate\b` does not match
 * inside `created`, and `_` is a word character. Measured below, because the opposite is the
 * natural assumption and it changes how careful a future alias has to be.
 *
 * ⛔ Substituted the way the runner substitutes, not run raw. `prepareSelect` is exactly what
 * `runStoredQuery` calls (packages/dashboards/src/custom-query-run.ts:52) — substitute first, then
 * validate. Validating the raw text would test a string that never reaches a database, and would
 * also miss a banned word arriving through a parameter's quoted literal.
 *
 * ⛔ Lives in `@openldr/bootstrap`, not in `report-seeds.test.ts` where the other seed tests are.
 * `@openldr/dashboards` already depends on `@openldr/reporting`, so importing the gate into
 * reporting's own tests would make the package graph cyclic. Bootstrap depends on both, and is the
 * package that actually seeds these queries into the store.
 */

const DIALECTS: SqlDialect[] = ['postgres', 'mssql', 'mysql'];

/** A syntactically plausible value for each declared parameter type, mirroring what the API sends.
 *  Values only have to be shaped right — nothing here is executed. */
function valuesFor(params: { id: string; type: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    out[p.id] = p.type === 'daterange' ? { from: '2026-01-01', to: '2026-01-31' } : 'X';
  }
  return out;
}

describe('every seeded query passes the SELECT-only gate, in every dialect', () => {
  for (const q of SEED_QUERIES) {
    for (const dialect of DIALECTS) {
      it(`${q.id} — ${dialect}`, () => {
        const params = (q.params ?? []) as { id: string; type: string; required?: boolean }[];
        expect(() => prepareSelect(q.sql[dialect], q.params ?? [], valuesFor(params))).not.toThrow();
      });
    }
  }

  it('the gate is not vacuous — it rejects a banned BARE word used as an alias or CTE name', () => {
    // The mutation this suite exists to catch, made explicit. Proves the loop above would fail
    // rather than pass on anything.
    expect(() => validateSelectSql('select 1 as call')).toThrow(/read-only/i);
    expect(() => validateSelectSql('with merge as (select 1 as a) select a from merge'))
      .toThrow(/read-only/i);
    expect(() => validateSelectSql('select 1 as ok')).not.toThrow();
  });

  it('the ban is on the WHOLE word — an alias that merely contains one is fine', () => {
    // Worth pinning, because it is the natural wrong assumption about this gate and it decides
    // how careful a future alias has to be. `\bcreate\b` does not match inside `created`, and `_`
    // is a word character so it does not match inside `call_log` either. Only the bare word bites.
    expect(() => validateSelectSql('select 1 as created')).not.toThrow();
    expect(() => validateSelectSql('with call_log as (select 1 as a) select a from call_log'))
      .not.toThrow();
  });
});

/**
 * ⛔ An empty HVL/EID panel list is an ERROR, never an empty grid.
 *
 * The seeded SQL used to carry six comment blocks reasoning about what each engine's string-split
 * does with '', and a live test asserted the resulting "empty grid". None of it was reachable:
 * `panels` is declared required, so `substituteParams` throws before any SQL is built. The live
 * test passed only because it re-implemented substitution with a regex replace and never ran the
 * guard. This asserts the guard where it actually is.
 */
describe('the transmission grid refuses a blank panel list rather than drawing an empty grid', () => {
  // ⛔ The two queries that TAKE a panel list, not everything named `q-transmission-*`. The summary
  // band's calendar and figures sit above BOTH grids and describe the whole month, so they declare
  // no `panels` at all and this rule has nothing to say about them. Selecting them by name prefix
  // asserted the opposite and failed the moment they landed.
  const PANEL_QUERIES = ['q-transmission-hvleid', 'q-transmission-other'];
  const gridQueries = SEED_QUERIES.filter((q) => PANEL_QUERIES.includes(q.id));

  it('checks both panel-filtered grid queries, and only those', () => {
    expect(gridQueries.map((q) => q.id).sort()).toEqual([...PANEL_QUERIES].sort());
    // The band's queries exist and are deliberately not in that list.
    const band = SEED_QUERIES.filter((q) => q.id.startsWith('q-transmission-') && !PANEL_QUERIES.includes(q.id));
    expect(band.map((q) => q.id).sort()).toEqual(['q-transmission-calendar', 'q-transmission-summary']);
    for (const q of band) {
      expect((q.params ?? []).map((p) => p.id), `${q.id} takes a panel list it does not use`).toEqual(['month']);
    }
  });

  for (const q of gridQueries) {
    it(`${q.id} declares panels required`, () => {
      const panels = (q.params ?? []).find((p) => p.id === 'panels');
      expect(panels?.required, 'a non-required panels param would make the blank run reachable').toBe(true);
    });

    it(`${q.id} throws on a blank panel list, in every dialect`, () => {
      for (const dialect of DIALECTS) {
        expect(() => substituteParams(q.sql[dialect], q.params ?? [], { month: '2026-03', panels: '', tz: 'UTC' }))
          .toThrow(/required parameter: panels/);
        expect(() => substituteParams(q.sql[dialect], q.params ?? [], { month: '2026-03', tz: 'UTC' }))
          .toThrow(/required parameter: panels/);
      }
    });

    it(`${q.id} accepts a populated panel list`, () => {
      for (const dialect of DIALECTS) {
        expect(() => substituteParams(q.sql[dialect], q.params ?? [], { month: '2026-03', panels: 'X', tz: 'UTC' }))
          .not.toThrow();
      }
    });
  }
});
