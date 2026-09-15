import { loadConfig } from '@openldr/config';
import { catalogChangeAction, createAppContext, parseCatalogListQuery, recordAuditEvent } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

export interface TestCatalogListOpts {
  search?: string;
  category?: string;
  loinc?: string;
  enabled?: string;
  status?: string;
  limit?: string;
  offset?: string;
  json: boolean;
}

/** `openldr test-catalog list`: the CLI door to GET /api/test-catalog. It uses the route's own parser,
 *  so a bad flag is refused in the same words, and it catches its own errors and returns an exit code. */
export async function runTestCatalogList(opts: TestCatalogListOpts): Promise<number> {
  const parsed = parseCatalogListQuery({
    q: opts.search, category: opts.category, loinc: opts.loinc, enabled: opts.enabled,
    status: opts.status, limit: opts.limit, offset: opts.offset,
  });
  if (!parsed.ok) {
    process.stderr.write(`test-catalog list failed: ${parsed.error}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.testCatalog.list(parsed.query);
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const lines = result.rows.map((t) => [
        t.code, t.display, t.category ?? '-', t.loinc ?? 'No LOINC', t.lab.enabled ? 'on' : 'off', t.active ? '' : 'retired',
      ].join('\t').trimEnd());
      process.stdout.write((lines.length ? lines.join('\n') : '(no tests)') + '\n');
      // The list is paged, so say how much of it this is, as `facilities list` does.
      process.stdout.write(`showing ${result.rows.length} of ${result.total}\n`);
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog list failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export type TestCatalogChange = 'enable' | 'disable' | 'retire' | 'restore';

const CHANGES: Record<TestCatalogChange, { field: 'enabled' | 'active'; value: boolean; done: string }> = {
  enable: { field: 'enabled', value: true, done: 'is now on at this lab' },
  disable: { field: 'enabled', value: false, done: 'is now off at this lab' },
  retire: { field: 'active', value: false, done: 'is retired' },
  restore: { field: 'active', value: true, done: 'is active again' },
};

/** `openldr test-catalog enable | disable | retire | restore <code>`: the CLI door to the page's row
 *  actions, PUT /api/test-catalog/:code/enabled and /active. It calls the same service methods and
 *  records the same audit action, as the CLI actor. Retire is reversible, so none takes --force. */
export async function runTestCatalogChange(change: TestCatalogChange, code: string, opts: { json: boolean }): Promise<number> {
  const { field, value, done } = CHANGES[change];
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.testCatalog.get(code);
    const after = field === 'enabled'
      ? await ctx.testCatalog.setEnabled(code, value)
      : await ctx.testCatalog.setActive(code, value);
    await recordAuditEvent(ctx, cliActor(), {
      action: catalogChangeAction(field, value), entityType: 'test_catalog', entityId: code,
      before: field === 'enabled' ? { enabled: before?.lab.enabled ?? null } : { active: before?.active ?? null },
      after: field === 'enabled' ? { enabled: after.lab.enabled } : { active: after.active },
    });
    process.stdout.write(opts.json ? JSON.stringify(after, null, 2) + '\n' : `${code} ${done}.\n`);
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog ${change} failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
