import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { createAppContext, MAP_TEST_MAX_ITEMS, MapConfigError, readTableFile, TableFileError } from '@openldr/bootstrap';
import type { MapTestResult } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

// `workflows map-test`: runs a Map to FHIR node's saved mapping on a file. It calls the same api
// object as the Test route (ctx.workflows.mapToFhir.test, apps/server/src/workflows-routes.ts:224),
// so no mapping logic lives here. It stores nothing and writes no audit row, as the other read-only
// workflows commands do.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 50_000;
const FIRST_ROWS = 5;

class Refusal extends Error {}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The rows of a .json list or a .csv file. Throws a Refusal with a plain message, never a value. */
export function readMapTestRows(path: string): Row[] {
  const ext = extname(path).toLowerCase();
  if (ext !== '.json' && ext !== '.csv') throw new Refusal('The file must be .json or .csv.');
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch { throw new Refusal('The file cannot be read.'); }
  if (bytes.length > MAX_BYTES) throw new Refusal('The file is larger than 20 MB, the limit.');
  let rows: Row[];
  if (ext === '.json') {
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Refusal('The file is not valid JSON.'); }
    if (!Array.isArray(parsed) || !parsed.every(isRow)) throw new Refusal('The JSON file must hold a list of objects.');
    rows = parsed;
  } else {
    try {
      const table = readTableFile(bytes, 'csv', { maxBytes: MAX_BYTES, maxRows: MAX_ROWS });
      // Every cell is text. A blank cell is left out, as Extract from File leaves it out.
      rows = table.rows.map((cells) => {
        const row: Row = {};
        table.headers.forEach((h, i) => { if (h !== '' && cells[i] !== '') row[h] = cells[i]; });
        return row;
      });
    } catch (err) {
      if (err instanceof TableFileError) {
        if (err.reason === 'empty') throw new Refusal('The file holds no rows.');
        if (err.reason === 'unreadable') throw new Refusal('The CSV file could not be read.');
        throw new Refusal(err.message);
      }
      throw err;
    }
  }
  if (rows.length === 0) throw new Refusal('The file holds no rows.');
  if (rows.length > MAX_ROWS) throw new Refusal(`The file has more than ${MAX_ROWS} rows, the limit.`);
  return rows;
}

function summary(results: MapTestResult[]): string {
  const kinds: Record<string, number> = {};
  const held = new Map<string, number[]>();
  for (const [i, r] of results.entries()) {
    if (r.ok) { kinds[r.kind] = (kinds[r.kind] ?? 0) + 1; continue; }
    const key = r.field ? `${r.reason} (${r.field})` : r.reason;
    held.set(key, [...(held.get(key) ?? []), i + 1]);
  }
  const passed = results.filter((r) => r.ok).length;
  const heldCount = results.length - passed;
  const byKind = ['fhir', 'form', 'mapped'].filter((k) => kinds[k]).map((k) => `${k} ${kinds[k]}`).join(', ');
  const lines = [`Rows: ${results.length}`, `Passed: ${passed}${byKind ? ` (${byKind})` : ''}`, `Held: ${heldCount}`];
  for (const [reason, nums] of held) {
    const first = nums.slice(0, FIRST_ROWS).join(', ');
    const more = nums.length > FIRST_ROWS ? ', ...' : '';
    lines.push(`${reason}: ${nums.length} ${nums.length === 1 ? 'row' : 'rows'} (${nums.length === 1 ? 'row' : 'rows'} ${first}${more})`);
  }
  return lines.join('\n') + '\n';
}

export async function runWorkflowMapTest(workflowId: string, nodeId: string, file: string, opts: { json: boolean }): Promise<number> {
  const fail = (message: string): number => {
    if (opts.json) process.stdout.write(JSON.stringify({ error: message }) + '\n');
    else process.stderr.write(message + '\n');
    return 1;
  };
  let rows: Row[];
  try { rows = readMapTestRows(file); }
  catch (err) { if (err instanceof Refusal) return fail(err.message); throw err; }

  const ctx = await createAppContext(loadConfig());
  try {
    const workflow = await ctx.workflows.store.get(workflowId);
    if (!workflow) return fail(`No workflow "${workflowId}".`);
    const node = workflow.definition.nodes.find((n) => n.id === nodeId);
    if (!node) return fail(`No node "${nodeId}" in workflow "${workflowId}".`);
    if ((node.data as { action?: unknown }).action !== 'map-to-fhir') return fail(`Node "${nodeId}" is not a Map to FHIR node.`);
    const saved = ((node.data as { config?: unknown }).config ?? {}) as { targetId?: unknown; formIds?: unknown; mappings?: unknown };
    const config = {
      targetId: typeof saved.targetId === 'string' ? saved.targetId : '',
      formIds: Array.isArray(saved.formIds) ? saved.formIds.map(String) : [],
      mappings: Array.isArray(saved.mappings) ? saved.mappings : [],
    };

    const results: MapTestResult[] = [];
    try {
      for (let i = 0; i < rows.length; i += MAP_TEST_MAX_ITEMS) {
        results.push(...await ctx.workflows.mapToFhir.test({ config, items: rows.slice(i, i + MAP_TEST_MAX_ITEMS) }));
      }
    } catch (err) {
      if (err instanceof MapConfigError) return fail(err.message);
      throw err;
    }

    const passed = results.filter((r) => r.ok).length;
    process.stdout.write(opts.json
      ? JSON.stringify({ rows: results.length, passed, held: results.length - passed, results }, null, 2) + '\n'
      : summary(results));
    return passed === results.length ? 0 : 1;
  } finally {
    await ctx.close();
  }
}
