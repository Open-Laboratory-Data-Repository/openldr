import { loadConfig } from '@openldr/config';
import { createAppContext, parseCatalogListQuery } from '@openldr/bootstrap';
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
