import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  createFacilityImportRunStore, createFacilityRegisterSourceStore, resolveFacilityRegisterForImport,
  type FacilityImportRun, type FacilityImportRunStore, type InternalSchema, type ReferenceCapture,
} from '@openldr/db';
import { importFacilities, type FacilityImportDeps, type FacilityImportResult } from './facility-import';

export type FacilityRegisterFileDeps = {
  db: Kysely<InternalSchema>;
  capture: ReferenceCapture;
  admin: NonNullable<FacilityImportDeps['admin']>;
  facilityJobs?: FacilityImportDeps['facilityJobs'];
  audit: NonNullable<FacilityImportDeps['audit']>;
  logger: NonNullable<FacilityImportDeps['logger']>;
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
  runs: FacilityImportRunStore, id: string, status: 'applied' | 'failed', error: string | null, summary?: unknown,
): Promise<void> {
  try {
    await runs.finishApply(id, status, { error, ...(summary === undefined ? {} : { summary }) });
  } catch {
    // A second failure must not hide the first result. Nothing more to do here.
  }
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

  // importFacilities never reads the register source table, so a preview works before the source
  // exists. Only an apply creates it.
  if (!existing && input.apply) {
    await sources.create({ url: input.url, name: input.name, code: input.code });
  }
  if (input.apply) {
    const gate = await resolveFacilityRegisterForImport(sources, input.url);
    if (!gate.ok) return { ok: false, error: gate.error };
  }

  // `completeRelease` only switches on the absence count. With `onAbsent: 'report'` nothing is retired.
  // A register source that did not exist yet has no earlier rows, so nothing can be absent from it.
  const importOptions = { nationalSystem: input.url, completeRelease: !!existing, onAbsent: 'report' as const };
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

    if (preview.unknownColumns.length > 0) {
      const error = `unrecognised column(s): ${preview.unknownColumns.join(', ')}`;
      if (run) await finishRun(runs, run.id, 'failed', `refused: ${error}`);
      return { ok: false, error };
    }
    if (preview.blocked) {
      const error = preview.blockedReason === 'duplicate-columns'
        ? `duplicate column header(s): ${preview.duplicateColumns.join(', ')}`
        : preview.blockedReason === 'column-map'
          ? `column map error(s): ${preview.columnMapErrors.map((e) => JSON.stringify(e)).join('; ')}`
          : `${preview.quarantined.length} row(s) quarantined`;
      if (run) await finishRun(runs, run.id, 'failed', `refused: ${error}`);
      return { ok: false, error };
    }

    if (!input.apply) return { ok: true, result: preview };

    const result = await importFacilities(deps, input.csv, { ...importOptions, runId, apply: true });
    await deps.audit.record({
      actorType: 'user', actorId: input.actor.id, actorName: input.actor.name,
      action: 'facility.import', entityType: 'facility', entityId: input.url,
      metadata: { source: 'content-pack', result },
    });
    if (run) await finishRun(runs, run.id, 'applied', null, result);
    return { ok: true, result };
  } catch (err) {
    if (run) await finishRun(runs, run.id, 'failed', message(err));
    return { ok: false, error: message(err) };
  }
}
