import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { loadConfig } from '@openldr/config';
import {
  catalogChangeAction, catalogColumnMapSchema, catalogImportAudit, catalogValueMapSchema, createAppContext,
  parseCatalogListQuery, parseResultParams, readCatalogImportFile, recordAuditEvent,
  type CatalogColumnMap, type CatalogImportFile, type CatalogImportReport, type CatalogValueMap,
  type TestResultParam,
} from '@openldr/bootstrap';
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

/** One line per parameter, the way `list` prints one line per test. */
export function formatResultParams(params: TestResultParam[]): string {
  if (params.length === 0) return '(no result parameters)';
  return params
    .map((p) => `${p.code}\t${p.resultType}\t${p.bands.length} ${p.bands.length === 1 ? 'band' : 'bands'}`)
    .join('\n');
}

/** The --set file: a JSON list of parameters, read through the same parser the service uses. */
export function readResultParamsFile(text: string): TestResultParam[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('expected a list of result parameters');
  return parseResultParams(parsed);
}

/** `openldr test-catalog params <code>`: the CLI door to the sheet's result parameters section. With
 *  --set it replaces them from a JSON file, through the same service the route calls, so both doors
 *  refuse the same parameters in the same words. */
export async function runTestCatalogParams(code: string, opts: { set?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (opts.set) {
      const params = readResultParamsFile(readFileSync(opts.set, 'utf8'));
      const before = await ctx.testCatalog.get(code);
      if (!before) {
        process.stderr.write(`test-catalog params failed: no such test: ${code}\n`);
        return 1;
      }
      await ctx.testCatalog.update(code, {
        display: before.display, shortName: before.shortName, category: before.category,
        specimenTypes: before.specimenTypes, loinc: before.loinc, active: before.active,
        resultParams: params,
      });
      await recordAuditEvent(ctx, cliActor(), {
        action: 'test_catalog.result_params_set', entityType: 'test_catalog', entityId: code,
        before: { resultParams: before.resultParams },
        after: { resultParams: params },
      });
    }
    const test = await ctx.testCatalog.get(code);
    if (!test) {
      process.stderr.write(`test-catalog params failed: no such test: ${code}\n`);
      return 1;
    }
    process.stdout.write(opts.json
      ? JSON.stringify(test.resultParams, null, 2) + '\n'
      : formatResultParams(test.resultParams) + '\n');
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog params failed: ${msg}\n`);
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

export interface TestCatalogImportOpts {
  apply: boolean;
  columnMap?: string;
  valueMap?: string;
  json: boolean;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Read a --column-map or --value-map file and check it against the route's own schema. */
function readMapFile<T>(
  flag: string, path: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } } },
): Checked<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { ok: false, error: err instanceof SyntaxError ? `${flag} ${path} is not valid JSON` : `could not read ${path}: ${redactError(err)}` };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${flag} ${path}: ${issue.path.join('.') || 'the file'} ${issue.message}` };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function describeReport(report: CatalogImportReport, applied: boolean): string {
  const c = report.counts;
  const lines = [
    applied ? 'Applied.' : 'Preview only. Nothing was written. Run again with --apply to write it.',
    `new ${c.new}, changed ${c.changed}, unchanged ${c.unchanged}, refused ${c.refused}`,
  ];
  if (!report.loincChecked) lines.push('LOINC is not loaded here, so LOINC codes were checked for their format only.');
  if (report.categoriesToAdd.length) {
    lines.push(`Categories to add: ${report.categoriesToAdd.map((a) => `${a.code} (${a.display})`).join(', ')}`);
  }
  for (const u of report.unmatched.categories) lines.push(`Category text with no match: "${u.text}" (${plural(u.rows, 'row', 'rows')})`);
  for (const u of report.unmatched.specimens) lines.push(`Specimen text with no match: "${u.text}" (${plural(u.rows, 'row', 'rows')})`);
  if (report.refused.length) {
    lines.push('Refused:');
    for (const r of report.refused) lines.push(`  row ${r.line}${r.code ? `, ${r.code}` : ''}: ${r.reason}`);
  }
  return lines.join('\n') + '\n';
}

/** `openldr test-catalog import <file>`: the CLI door to the page's import. It previews unless --apply
 *  is given, calls the same service methods as the routes, and audits an apply as the CLI actor. */
export async function runTestCatalogImport(path: string, opts: TestCatalogImportOpts): Promise<number> {
  const fail = (msg: string): number => {
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog import failed: ${msg}\n`);
    return 1;
  };
  const ext = extname(path).toLowerCase();
  const format = ext === '.csv' ? 'csv' : ext === '.xlsx' ? 'xlsx' : null;
  if (!format) return fail(`${path} must end in .csv or .xlsx`);

  // Everything about the file is checked before the app context opens.
  let file: CatalogImportFile;
  try {
    file = readCatalogImportFile(readFileSync(path), format);
  } catch (err) {
    return fail(redactError(err));
  }
  let columnMap: CatalogColumnMap = file.suggested;
  if (opts.columnMap) {
    const read = readMapFile('--column-map', opts.columnMap, catalogColumnMapSchema);
    if (!read.ok) return fail(read.error);
    columnMap = read.value;
  }
  let valueMap: CatalogValueMap | undefined;
  if (opts.valueMap) {
    const read = readMapFile('--value-map', opts.valueMap, catalogValueMapSchema);
    if (!read.ok) return fail(read.error);
    valueMap = read.value;
  }
  const input = { table: { headers: file.headers, rows: file.rows }, columnMap, ...(valueMap ? { valueMap } : {}) };

  const ctx = await createAppContext(loadConfig());
  try {
    const report = opts.apply ? await ctx.testCatalog.importApply(input) : await ctx.testCatalog.importPreview(input);
    if (opts.apply) await recordAuditEvent(ctx, cliActor(), catalogImportAudit(report));
    process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : describeReport(report, opts.apply));
    return 0;
  } catch (err) {
    return fail(redactError(err));
  } finally {
    await ctx.close();
  }
}

/** `openldr test-catalog export`: the CLI door to GET /api/test-catalog/export. */
export async function runTestCatalogExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const csv = await ctx.testCatalog.exportCsv();
    if (opts.out) {
      writeFileSync(opts.out, csv, 'utf8');
      process.stdout.write(`Wrote ${opts.out}.\n`);
    } else {
      process.stdout.write(csv);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`test-catalog export failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
