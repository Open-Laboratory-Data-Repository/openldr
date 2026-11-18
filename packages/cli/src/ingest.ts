import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createIngestContext, ingestAndWait, type IngestWait } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { describeInterruption } from './interruptions';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

function loadPluginConfig(path?: string): Record<string, string> | undefined {
  if (!path) return undefined;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}

export async function runIngest(
  file: string,
  opts: JsonOpt & { source: string; converter: string; config?: string },
  wait: IngestWait = { intervalMs: 500, timeoutMs: 60_000 },
): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const data = readFileSync(file);
    const config = loadPluginConfig(opts.config);
    // ingestAndWait also waits when a running API server's worker claims the batch first.
    const out = await ingestAndWait(ctx, { data: new Uint8Array(data), source: opts.source, converter: opts.converter, filename: basename(file), config }, wait);
    emit(
      opts.json,
      out,
      `batch ${out.batchId}: ${out.status} (${out.resourceCount ?? 0} resources)${out.error ? ' — ' + out.error : ''}` +
        (out.finished ? '' : `\nstill ${out.status ?? 'unknown'} after ${Math.round(wait.timeoutMs / 1000)}s; another process may be working on it. Check with: openldr pipeline status`),
    );
    return out.status === 'done' ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runPipelineStatus(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const rows = await ctx.batches.list();
    const cuts = rows.length > 0 ? await ctx.jobInterruptions.listFor('ingest-batch', rows.map((r) => r.batch_id)) : new Map();
    emit(
      opts.json,
      rows.map((r) => ({ ...r, interruptions: cuts.get(r.batch_id) ?? [] })),
      rows.map((r) => [`  ${r.batch_id.slice(0, 8)}  ${r.status.padEnd(10)} ${r.converter.padEnd(22)} ${r.resource_count} res  ${r.last_error ?? ''}`,
        ...(cuts.get(r.batch_id) ?? []).map(describeInterruption)].join('\n')).join('\n') || '  (no batches)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPipelineRetry(batchId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const batch = await ctx.batches.get(batchId);
    if (!batch) {
      emit(opts.json, { ok: false, error: 'batch not found' }, `batch ${batchId} not found`);
      return 1;
    }
    await ctx.batches.reset(batchId);
    await ctx.republish({ batch_id: batch.batch_id, blob_key: batch.blob_key, source: batch.source, converter: batch.converter, config: batch.config });
    await ctx.drain();
    const after = await ctx.batches.get(batchId);
    emit(opts.json, { batchId, status: after?.status }, `retried ${batchId}: ${after?.status}`);
    return after?.status === 'done' ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runPipelineLogs(batchId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const batch = await ctx.batches.get(batchId);
    emit(
      opts.json,
      batch ?? { error: 'not found' },
      batch ? `${batch.batch_id}  status=${batch.status} attempts=${batch.attempts} error=${batch.last_error ?? '-'}` : 'not found',
    );
    return batch ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runQueueStatus(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const stats = await ctx.queueStats();
    emit(opts.json, stats, Object.entries(stats).map(([k, v]) => `  ${k.padEnd(12)} ${v}`).join('\n') || '  (empty)');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runProvenanceAudit(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const gaps = await ctx.batches.provenanceGaps();
    emit(
      opts.json,
      { gaps: gaps.length, records: gaps },
      gaps.length === 0 ? 'provenance audit: 0 gaps' : `provenance audit: ${gaps.length} record(s) missing source/plugin/batch`,
    );
    return gaps.length === 0 ? 0 : 1;
  } finally {
    await ctx.close();
  }
}
