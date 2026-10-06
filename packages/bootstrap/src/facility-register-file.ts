import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  createFacilityImportRunStore, createFacilityRegisterSourceStore, resolveFacilityRegisterForImport,
  type FacilityImportRun, type FacilityImportRunStore, type InternalSchema, type ReferenceCapture,
} from '@openldr/db';
import { safeRecord, type AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import { importFacilities, type FacilityImportDeps, type FacilityImportResult } from './facility-import';

export type FacilityRegisterFileDeps = {
  db: Kysely<InternalSchema>;
  capture: ReferenceCapture;
  admin: NonNullable<FacilityImportDeps['admin']>;
  facilityJobs?: FacilityImportDeps['facilityJobs'];
  audit: NonNullable<FacilityImportDeps['audit']>;
  logger: NonNullable<FacilityImportDeps['logger']> & { warn(obj: unknown, msg?: string): void };
};

export interface FacilityRegisterFileInput {
  url: string;
  name: string;
  code: string;
  csv: string;
  apply: boolean;
  actor: { id: string | null; name: string };
}

export type FacilityRegisterFileOutcome =
  | { ok: true; result: FacilityImportResult }
  | { ok: false; error: string };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function finishRun(
  runs: FacilityImportRunStore, logger: FacilityRegisterFileDeps['logger'],
  id: string, status: 'applied' | 'failed', error: string | null, summary?: unknown,
): Promise<void> {
  try {
    await runs.finishApply(id, status, { error, ...(summary === undefined ? {} : { summary }) });
  } catch (err) {
    // A second failure must not hide the first result. Logged, because a run left open keeps its
    // active key and blocks the next import of this register.
    logger.warn({ err, runId: id, status }, 'failed to finish a facility import run for a content pack register');
  }
}

/** The reason a previewed file must not be applied, or null. Same refusals as the CLI. */
function refusalOf(preview: FacilityImportResult): string | null {
  if (preview.unknownColumns.length > 0) return `unrecognised column(s): ${preview.unknownColumns.join(', ')}`;
  if (!preview.blocked) return null;
  if (preview.blockedReason === 'duplicate-columns') return `duplicate column header(s): ${preview.duplicateColumns.join(', ')}`;
  if (preview.blockedReason === 'column-map') {
    return `column map error(s): ${preview.columnMapErrors.map((e) => JSON.stringify(e)).join('; ')}`;
  }
  return `${preview.quarantined.length} row(s) quarantined`;
}

/**
 * Import a facility register CSV for a content pack. Creates the register source when it is absent.
 *
 * This repeats about 40 lines of `runFacilitiesImport` in `packages/cli/src/facilities.ts:246`
 * (the run row, preview first, the two refusals, apply, audit, finish) on purpose. Refactoring the
 * CLI function is out of scope: it also carries column maps, value maps, xlsx and JSONL.
 *
 * Rows that a newer file no longer lists are reported (`onAbsent: 'report'`), never retired.
 * With `apply: false` nothing is written: no source, no run row, no rows.
 */
export async function importFacilityRegisterCsv(
  deps: FacilityRegisterFileDeps, input: FacilityRegisterFileInput,
): Promise<FacilityRegisterFileOutcome> {
  const sources = createFacilityRegisterSourceStore(deps.db);
  const runs = createFacilityImportRunStore(deps.db);
  const existing = await sources.getByUrl(input.url);

  // A register source that did not exist yet has no earlier rows, so nothing can be absent from it.
  // `completeRelease` only switches on the absence count. With `onAbsent: 'report'` nothing is retired.
  const importOptions = { nationalSystem: input.url, completeRelease: !!existing, onAbsent: 'report' as const };

  if (existing) {
    // Same gate as the CLI, and it runs on a preview too: a deactivated register is refused up front.
    const gate = await resolveFacilityRegisterForImport(sources, input.url);
    if (!gate.ok) return { ok: false, error: gate.error };
  } else {
    // importFacilities never reads the register source table, so a preview works before the source
    // exists. Check every refusal first, so a refused file leaves no source row behind.
    try {
      const first = await importFacilities(deps, input.csv, { ...importOptions, runId: null, apply: undefined });
      const refusal = refusalOf(first);
      if (refusal) return { ok: false, error: refusal };
      if (!input.apply) return { ok: true, result: first };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
    await sources.create({ url: input.url, name: input.name, code: input.code });
    const gate = await resolveFacilityRegisterForImport(sources, input.url);
    if (!gate.ok) return { ok: false, error: gate.error };
  }

  let run: FacilityImportRun | null = null;
  try {
    if (input.apply) {
      try {
        run = await runs.startPreview({
          nationalSystem: input.url,
          sourceFormat: 'csv',
          fileHash: createHash('sha256').update(input.csv, 'utf8').digest('hex'),
          byteSize: Buffer.byteLength(input.csv, 'utf8'),
          releaseVersion: null,
          options: { ...importOptions, format: 'csv' },
          requestedBy: input.actor.name,
        });
      } catch (err) {
        return { ok: false, error: message(err) };
      }
    }

    const runId = run?.id ?? null;
    const preview = await importFacilities(deps, input.csv, { ...importOptions, runId, apply: undefined });

    const refusal = refusalOf(preview);
    if (refusal) {
      if (run) await finishRun(runs, deps.logger, run.id, 'failed', `refused: ${refusal}`);
      return { ok: false, error: refusal };
    }
    if (!input.apply) return { ok: true, result: preview };

    const result = await importFacilities(deps, input.csv, { ...importOptions, runId, apply: true });
    // Best effort: the rows are written, so a failed audit write must not fail the step.
    // safeRecord only calls `logger.error`, which this logger has.
    await safeRecord(deps.audit as AuditStore, deps.logger as unknown as Logger, {
      actorType: 'user', actorId: input.actor.id, actorName: input.actor.name,
      action: 'facility.import', entityType: 'facility', entityId: input.url,
      metadata: { source: 'content-pack', result },
    });
    if (run) await finishRun(runs, deps.logger, run.id, 'applied', null, result);
    return { ok: true, result };
  } catch (err) {
    if (run) await finishRun(runs, deps.logger, run.id, 'failed', message(err));
    return { ok: false, error: message(err) };
  }
}
