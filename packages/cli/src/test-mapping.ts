import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createAppContext, parseMapLevel, parseObservedQuery, recordAuditEvent, type MapLevel, type RebuildOutcome } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr test-catalog map ...`: the CLI doors to the test mapping routes (test mapping spec 4.6).
// Each catches its own errors and returns an exit code, like the test-catalog commands.

function staleWarning(rebuild: RebuildOutcome | null): void {
  if (rebuild && !rebuild.ok) {
    process.stderr.write(`the warehouse copy test_map is out of date: ${rebuild.error}. Run openldr test-catalog map rebuild --apply.\n`);
  }
}

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`test-catalog map ${command} failed: ${msg}\n`);
  return 1;
}

/** Read --level. Prints the refusal and returns null when it is not test or result. */
function levelFlag(command: string, raw: string | undefined): MapLevel | null {
  const parsed = parseMapLevel(raw);
  if (parsed.ok) return parsed.level;
  process.stderr.write(`test-catalog map ${command} failed: ${parsed.error}\n`);
  return null;
}

export interface TestMappingListOpts { status?: string; search?: string; limit?: string; offset?: string; json: boolean; level?: string }

export async function runTestMappingList(opts: TestMappingListOpts): Promise<number> {
  const parsed = parseObservedQuery({ status: opts.status, q: opts.search, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`test-catalog map list failed: ${parsed.error}\n`); return 1; }
  const level = levelFlag('list', opts.level);
  if (!level) return 1;
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.testMapping.observed(parsed.query, level);
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const lines = out.rows.map((r) => {
      const target = r.catalog ? `${r.catalog.code} ${r.catalog.name ?? ''}${r.catalog.loinc ? ` (LOINC ${r.catalog.loinc})` : ''}` : '';
      return `${r.system}  ${r.code}  ${r.requests}  ${r.status}${target ? `  ${target}` : ''}${r.centralManaged ? '  [central]' : ''}`;
    });
    process.stdout.write([...lines, `${out.rows.length} of ${out.total} code(s)`].join('\n') + '\n');
    if (out.warehouse.stale) staleWarning({ ok: false, error: out.warehouse.error ?? 'the last rebuild failed' });
    return 0;
  } catch (err) { return fail('list', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingSet(system: string, code: string, targetCode: string, opts: { json: boolean; level?: string }): Promise<number> {
  const level = levelFlag('set', opts.level);
  if (!level) return 1;
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.testMapping.set(system, code, targetCode, level);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${system}|${code}`,
      before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { level, rebuild: change.rebuild.ok },
    });
    const done = level === 'result' ? `${code} now maps to result field ${targetCode}.` : `${code} now maps to ${targetCode}.`;
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${done}\n`);
    staleWarning(change.rebuild);
    return 0;
  } catch (err) { return fail('set', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingClear(system: string, code: string, opts: { force: boolean; json: boolean; level?: string }): Promise<number> {
  if (!opts.force) { process.stderr.write('test-catalog map clear removes a mapping; pass --force to do it.\n'); return 1; }
  const level = levelFlag('clear', opts.level);
  if (!level) return 1;
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.testMapping.clear(system, code, level);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${system}|${code}`,
      before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { level, rebuild: change.rebuild.ok },
    });
    const done = level === 'result' ? `${code} no longer maps to a result field.` : `${code} no longer maps to a catalog test.`;
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${done}\n`);
    staleWarning(change.rebuild);
    return 0;
  } catch (err) { return fail('clear', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingExport(opts: { out?: string; level?: string }): Promise<number> {
  const level = levelFlag('export', opts.level);
  if (!level) return 1;
  const ctx = await createAppContext(loadConfig());
  try {
    const csv = await ctx.testMapping.exportCsv(level);
    if (opts.out) writeFileSync(opts.out, csv, 'utf8'); else process.stdout.write(csv);
    return 0;
  } catch (err) { return fail('export', err, false); } finally { await ctx.close(); }
}

export async function runTestMappingImport(file: string, opts: { apply: boolean; force: boolean; json: boolean; level?: string }): Promise<number> {
  if (opts.apply && !opts.force) { process.stderr.write('test-catalog map import --apply writes mappings; pass --force to do it.\n'); return 1; }
  const level = levelFlag('import', opts.level);
  if (!level) return 1;
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch (err) { process.stderr.write(`could not read ${file}: ${redactError(err)}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const report = opts.apply ? await ctx.testMapping.importApply(bytes, level) : await ctx.testMapping.importPreview(bytes, level);
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'test_mapping.import', entityType: 'test_mapping', entityId: 'import',
        before: null, after: null, metadata: { level, counts: report.counts, refused: report.refused, rebuild: report.rebuild?.ok ?? null },
      });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return 0; }
    const c = report.counts;
    const verb = opts.apply ? 'mapped' : 'would map';
    process.stdout.write([
      `${verb} ${c.new} new, change ${c.changed}, leave ${c.unchanged} unchanged, refuse ${c.refused}`,
      ...report.refused.map((r) => `  line ${r.line} ${r.system} ${r.code}: ${r.reason}`),
    ].join('\n') + '\n');
    staleWarning(report.rebuild);
    return 0;
  } catch (err) { return fail('import', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingRebuild(opts: { apply: boolean; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    let result;
    if (opts.apply) {
      // Same path as the route and the sync: one rebuild at a time, and a failure is reported, not thrown.
      const outcome = await ctx.testMapping.rebuildNow();
      if (!outcome.ok) return fail('rebuild', new Error(outcome.error), opts.json);
      result = outcome.result;
    } else {
      result = await ctx.testMapping.publish({ apply: false });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0; }
    process.stdout.write([
      `${opts.apply ? 'wrote' : 'would write'} ${result.written} row(s); ${result.ambiguous.length} ambiguous, ${result.targetMissing.length} with a missing catalog test`,
      ...result.ambiguous.map((a) => `  ambiguous ${a.system} ${a.code}: ${a.catalogCodes.join(', ')}`),
      ...result.targetMissing.map((m) => `  missing ${m.system} ${m.code}: no catalog test ${m.catalogCode}`),
    ].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('rebuild', err, opts.json); } finally { await ctx.close(); }
}

/** `openldr test-catalog map match <system>`: the CLI door to Map matching codes (result field mapping
 *  spec 4.5). It previews unless --apply --force is given. */
export async function runTestMappingMatch(system: string, opts: { apply: boolean; force: boolean; json: boolean }): Promise<number> {
  if (opts.apply && !opts.force) { process.stderr.write('test-catalog map match --apply writes mappings; pass --force to do it.\n'); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    // applyMatch returns the plan plus the rebuild outcome. Keeping it apart lets the type say so.
    const applied = opts.apply ? await ctx.testMapping.applyMatch(system) : null;
    const out = applied ?? await ctx.testMapping.planMatch(system);
    if (applied) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'test_mapping.match', entityType: 'test_mapping', entityId: `match:${system}`, before: null, after: null,
        metadata: { level: 'result', system, codes: out.matches.map((m) => m.code), count: out.matches.length, rebuild: applied.rebuild.ok },
      });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    process.stdout.write([
      `${opts.apply ? 'mapped' : 'would map'} ${out.matches.length} code(s) in ${system} to the result field with the same code`,
      ...out.matches.map((m) => `  ${m.code}  ${m.display ?? ''}  ${m.results}`),
    ].join('\n') + '\n');
    if (applied) staleWarning(applied.rebuild);
    return 0;
  } catch (err) { return fail('match', err, opts.json); } finally { await ctx.close(); }
}
