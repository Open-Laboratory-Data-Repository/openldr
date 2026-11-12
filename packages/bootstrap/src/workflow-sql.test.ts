import { describe, expect, it } from 'vitest';
import { createWorkflowSql } from './workflow-sql';

interface FakeNode { kind: string; sqlFragments?: readonly string[]; parameters?: readonly FakeNode[]; value?: unknown }

function render(node: FakeNode): string {
  if (node.kind === 'ValueNode') return String(node.value);
  const fragments = node.sqlFragments ?? [];
  const params = node.parameters ?? [];
  let out = fragments[0] ?? '';
  for (let i = 0; i < params.length; i++) out += render(params[i]) + (fragments[i + 1] ?? '');
  return out;
}

/** The fake database the dashboards SQL runner tests use (`sql-runner.test.ts`): a transaction
 *  whose executor renders raw SQL and returns the given rows. */
function fakeDb(rows: Record<string, unknown>[]) {
  const executed: string[] = [];
  const executor = {
    transformQuery: (node: FakeNode) => node,
    compileQuery: (node: FakeNode) => ({ sql: render(node), parameters: [], query: node }),
    executeQuery: async (q: { sql: string }) => { executed.push(q.sql); return { rows }; },
  };
  const trx = { getExecutor: () => executor, executeQuery: executor.executeQuery };
  const db = { transaction: () => ({ execute: (cb: (t: unknown) => unknown) => cb(trx) }) };
  return { db: db as never, executed };
}

const bounds = async () => ({ timeoutMs: 5000, rowCap: 100 });

describe('the workflow SQL Query node', () => {
  // Bug 12: the node went through the dashboard query, which refuses typed SQL unless Dashboard raw
  // SQL is on. A workflow author can already run any SELECT through the Postgres node and the
  // default warehouse connector, so the dashboard switch protected nothing there.
  it('runs a SELECT with no dashboard switch to ask', async () => {
    const { db, executed } = fakeDb([{ n: 3 }]);
    const run = createWorkflowSql({ db, bounds, engine: 'postgres' });
    const result = await run('select count(*) as n from lab_requests');
    expect(result.rows).toEqual([{ n: 3 }]);
    expect(result.columns).toEqual([{ key: 'n', label: 'n' }]);
    expect(executed.some((s) => /count\(\*\)/.test(s))).toBe(true);
  });

  it('still refuses anything but a single SELECT', async () => {
    const { db } = fakeDb([]);
    const run = createWorkflowSql({ db, bounds, engine: 'postgres' });
    await expect(run('delete from lab_requests')).rejects.toThrow();
    await expect(run('select 1; drop table lab_requests')).rejects.toThrow();
  });

  it('applies the same timeout and row cap as dashboard SQL', async () => {
    const { db, executed } = fakeDb([{ a: 1 }]);
    const run = createWorkflowSql({ db, bounds: async () => ({ timeoutMs: 1234, rowCap: 7 }), engine: 'postgres' });
    await run('select 1 as a');
    const all = executed.join('\n');
    expect(all).toMatch(/statement_timeout = 1234/);
    expect(all).toMatch(/limit 7\b/i);
  });
});
