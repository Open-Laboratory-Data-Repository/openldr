import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createAppContext, parseResultFieldQuery, recordAuditEvent } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr test-catalog result-fields ...`: the CLI doors to the result fields routes (result field
// mapping spec 4.6). Named result-fields because `test-catalog params <code>` already edits one test's
// result parameters. Each command catches its own errors and returns an exit code.

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`test-catalog result-fields ${command} failed: ${msg}\n`);
  return 1;
}

export interface ResultFieldsListOpts { search?: string; loinc?: string; role?: string; limit?: string; offset?: string; json: boolean }

export async function runResultFieldsList(opts: ResultFieldsListOpts): Promise<number> {
  const parsed = parseResultFieldQuery({ q: opts.search, loinc: opts.loinc, role: opts.role, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`test-catalog result-fields list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.resultFields.list(parsed.query);
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    if (!out.loaded) { process.stdout.write('No result dictionary is loaded. Import one with openldr terminology import parameters <file>.\n'); return 0; }
    const lines = out.rows.map((f) => `${f.code}  ${f.display ?? ''}  ${f.role ?? ''}  ${f.units ?? ''}  ${f.loinc ? `LOINC ${f.loinc}` : 'no LOINC'}`);
    process.stdout.write([...lines, `${out.rows.length} of ${out.total} field(s)${out.ownedHere ? '' : ' (from central, read-only here)'}`].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('list', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsLink(code: string, loinc: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.resultFields.link(code, loinc);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'result_field.link', entityType: 'result_field', entityId: code,
      before: { loinc: change.before }, after: { loinc: change.after },
    });
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${code} is now linked to LOINC ${change.after}.\n`);
    return 0;
  } catch (err) { return fail('link', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsUnlink(code: string, opts: { force: boolean; json: boolean }): Promise<number> {
  if (!opts.force) { process.stderr.write('test-catalog result-fields unlink removes a LOINC link; pass --force to do it.\n'); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.resultFields.unlink(code);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'result_field.unlink', entityType: 'result_field', entityId: code,
      before: { loinc: change.before }, after: { loinc: null },
    });
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${code} no longer has a LOINC link.\n`);
    return 0;
  } catch (err) { return fail('unlink', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const csv = await ctx.resultFields.exportCsv();
    if (opts.out) writeFileSync(opts.out, csv, 'utf8'); else process.stdout.write(csv);
    return 0;
  } catch (err) { return fail('export', err, false); } finally { await ctx.close(); }
}

export async function runResultFieldsImport(file: string, opts: { apply: boolean; force: boolean; json: boolean }): Promise<number> {
  if (opts.apply && !opts.force) { process.stderr.write('test-catalog result-fields import --apply writes links; pass --force to do it.\n'); return 1; }
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch (err) { process.stderr.write(`could not read ${file}: ${redactError(err)}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const report = opts.apply ? await ctx.resultFields.importApply(bytes) : await ctx.resultFields.importPreview(bytes);
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'result_field.import', entityType: 'result_field', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused },
      });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return 0; }
    const c = report.counts;
    process.stdout.write([
      `${opts.apply ? 'linked' : 'would link'} ${c.new} new, change ${c.changed}, leave ${c.unchanged} unchanged, refuse ${c.refused}`,
      ...report.refused.map((r) => `  line ${r.line} ${r.code}: ${r.reason}`),
    ].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('import', err, opts.json); } finally { await ctx.close(); }
}
