import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { loadConfig } from '@openldr/config';
import {
  ALL_TYPE_SETTINGS, catalogChangeAction, catalogColumnMapSchema, catalogImportAudit, catalogUpdateAudit, catalogValueMapSchema, createAppContext,
  parseCatalogListQuery, parseResultParams, readCatalogImportFile, readHoursCell, recordAuditEvent, type CatalogTestInput,
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
        t.testCode, t.display, t.category ?? '-', t.loinc ?? 'No LOINC', t.lab.enabled ? 'on' : 'off', t.active ? '' : 'retired',
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

/** One line per parameter, the way `list` prints one line per test: code, type, required or
 *  optional, band count, then the settings it has, named as a --set file names them. */
export function formatResultParams(params: TestResultParam[]): string {
  if (params.length === 0) return '(no result parameters)';
  return params
    .map((p) => {
      const settings = ALL_TYPE_SETTINGS
        .filter((key) => p[key] !== undefined && p[key] !== null)
        .map((key) => `${key} ${String(p[key])}`)
        .join(', ');
      // Absent means required, so a test saved before the setting reads as before.
      const required = p.required === false ? 'optional' : 'required';
      const bands = `${p.bands.length} ${p.bands.length === 1 ? 'band' : 'bands'}`;
      return [p.code, p.resultType, required, bands, ...(settings ? [settings] : [])].join('\t');
    })
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
 *  refuse the same parameters in the same words. <code> is a Test code or an id. */
export async function runTestCatalogParams(code: string, opts: { set?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const found = await ctx.testCatalog.resolve(code);
    if (!found) {
      process.stderr.write(`test-catalog params failed: no such test: ${code}\n`);
      return 1;
    }
    const id = found.code;
    let test = found;
    if (opts.set) {
      const text = readFileSync(opts.set, 'utf8');
      const params = readResultParamsFile(text);
      // The service gets the file as written, so it refuses what the route refuses (an unknown age
      // unit, say) rather than seeing the parser's copy with that unit already dropped.
      const sent = JSON.parse(text) as TestResultParam[];
      const before = found;
      test = await ctx.testCatalog.update(id, {
        display: before.display, shortName: before.shortName, category: before.category,
        specimenTypes: before.specimenTypes, loinc: before.loinc, active: before.active,
        resultParams: sent,
      });
      await recordAuditEvent(ctx, cliActor(), {
        action: 'test_catalog.result_params_set', entityType: 'test_catalog', entityId: id,
        before: { resultParams: before.resultParams },
        after: { resultParams: params },
      });
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

export interface TestCatalogSetOpts {
  /** A new Test code. Left out keeps the stored one. */
  testCode?: string;
  expectedTat?: string;
  criticalTat?: string;
  requiresVerification?: string;
  json: boolean;
}

/** A --expected-tat or --critical-tat value: hours, or "none" to clear. The service checks it is positive. */
function readTatFlag(flag: string, text: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (text.trim().toLowerCase() === 'none') return { ok: true, value: null };
  const read = readHoursCell(text.trim());
  if (read === 'bad' || read === null) return { ok: false, error: `${flag} must be a number of hours, or none to clear it, not "${text}"` };
  return { ok: true, value: read };
}

/** `openldr test-catalog set <code>`: the CLI door to the sheet's Test code, turnaround and verification
 *  fields. <code> is a Test code or an id. It sends the test as stored with only the given fields
 *  changed, through the same update the route calls, so both doors refuse the same values. A lab whose catalog comes from central is refused. */
export async function runTestCatalogSet(code: string, opts: TestCatalogSetOpts): Promise<number> {
  const fail = (msg: string): number => {
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog set failed: ${msg}\n`);
    return 1;
  };
  const change: Pick<CatalogTestInput, 'testCode' | 'expectedTatHours' | 'criticalTatHours' | 'requiresVerification'> = {};
  if (opts.testCode !== undefined) {
    if (!opts.testCode.trim()) return fail('--test-code needs a code');
    change.testCode = opts.testCode.trim();
  }
  if (opts.expectedTat !== undefined) {
    const read = readTatFlag('--expected-tat', opts.expectedTat);
    if (!read.ok) return fail(read.error);
    change.expectedTatHours = read.value;
  }
  if (opts.criticalTat !== undefined) {
    const read = readTatFlag('--critical-tat', opts.criticalTat);
    if (!read.ok) return fail(read.error);
    change.criticalTatHours = read.value;
  }
  if (opts.requiresVerification !== undefined) {
    const key = opts.requiresVerification.trim().toLowerCase();
    if (key !== 'true' && key !== 'false') return fail(`--requires-verification must be true or false, not "${opts.requiresVerification}"`);
    change.requiresVerification = key === 'true';
  }
  if (Object.keys(change).length === 0) {
    return fail('give at least one of --test-code, --expected-tat, --critical-tat or --requires-verification');
  }

  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.testCatalog.resolve(code);
    if (!before) return fail(`no such test: ${code}`);
    // Result parameters are left out, so the service keeps them. So is the Test code, unless
    // --test-code gives one.
    const after = await ctx.testCatalog.update(before.code, {
      display: before.display, shortName: before.shortName, category: before.category,
      specimenTypes: before.specimenTypes, loinc: before.loinc, active: before.active, ...change,
    });
    await recordAuditEvent(ctx, cliActor(), catalogUpdateAudit(before.code, before, after));
    process.stdout.write(opts.json
      ? JSON.stringify(after, null, 2) + '\n'
      : [
        `Test code\t${after.testCode}`,
        `expected TAT\t${after.expectedTatHours === null ? 'none' : `${after.expectedTatHours} h`}`,
        `critical TAT\t${after.criticalTatHours === null ? 'none' : `${after.criticalTatHours} h`}`,
        `requires verification\t${after.requiresVerification ? 'yes' : 'no'}`,
      ].join('\n') + '\n');
    return 0;
  } catch (err) {
    return fail(redactError(err));
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
 *  actions, PUT /api/test-catalog/:code/enabled and /active. <code> is a Test code or an id. It calls
 *  the same service methods by the test's id and records the same audit action, as the CLI actor.
 *  Retire is reversible, so none takes --force. */
export async function runTestCatalogChange(change: TestCatalogChange, code: string, opts: { json: boolean }): Promise<number> {
  const { field, value, done } = CHANGES[change];
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.testCatalog.resolve(code);
    if (!before) throw new Error(`no such test: ${code}`);
    const id = before.code;
    const after = field === 'enabled'
      ? await ctx.testCatalog.setEnabled(id, value)
      : await ctx.testCatalog.setActive(id, value);
    await recordAuditEvent(ctx, cliActor(), {
      action: catalogChangeAction(field, value), entityType: 'test_catalog', entityId: id,
      before: field === 'enabled' ? { enabled: before.lab.enabled } : { active: before.active },
      after: field === 'enabled' ? { enabled: after.lab.enabled } : { active: after.active },
    });
    process.stdout.write(opts.json ? JSON.stringify(after, null, 2) + '\n' : `${after.testCode} ${done}.\n`);
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
  if (report.notes.length) {
    lines.push('Notes:');
    for (const n of report.notes) lines.push(`  row ${n.line}${n.code ? `, ${n.code}` : ''}: ${n.note}`);
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
