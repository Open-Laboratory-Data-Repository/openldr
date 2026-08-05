import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createAppContext, importFacilities, recordAuditEvent } from '@openldr/bootstrap';
import { referenceCapture } from '@openldr/db';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

export interface FacilitiesImportOpts {
  nationalSystem: string;
  /** The caller opts IN to writing (see facility-import.ts's `FacilityImportOptions.apply`).
   *  Omitted/false ⇒ dry run: parse and report, write NOTHING — the default, deliberately, so a
   *  14 000-row national register can never be silently rewritten by forgetting a flag. */
  apply?: boolean;
  allowUnknownColumns?: boolean;
  json: boolean;
}

/**
 * `openldr facilities import <path> --national-system <sys> [--apply] [--allow-unknown-columns] [--json]`
 *
 * Thin CLI wrapper over `@openldr/bootstrap`'s `importFacilities` (Task 2) — the same function
 * Task 4's HTTP route calls, per the repo's CLI-parity rule. This file owns only: reading the file
 * with a redacted error instead of a stack trace, wiring `deps` (internalDb + referenceCapture) off
 * `createAppContext`, the unknown-columns refusal message, the duplicates warning, and auditing an
 * applied import (`facility.import`, matching `facility.create`/`facility.update`/`facility.delete`
 * in apps/server/src/facilities-routes.ts).
 */
export async function runFacilitiesImport(path: string, opts: FacilitiesImportOpts): Promise<number> {
  let csv: string;
  try {
    csv = readFileSync(path, 'utf8');
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities import failed: could not read ${path}: ${msg}\n`);
    return 1;
  }

  const ctx = await createAppContext(loadConfig());
  try {
    const result = await importFacilities(
      { db: ctx.internalDb, capture: referenceCapture },
      csv,
      { nationalSystem: opts.nationalSystem, allowUnknownColumns: opts.allowUnknownColumns, apply: opts.apply },
    );

    // Refuse loudly and name the columns rather than let the caller read a generic all-zero
    // summary and wonder why nothing happened — see facility-csv.ts: unknownColumns non-empty
    // without allowUnknownColumns means the parser already blocked the whole file (parsed: 0).
    if (result.unknownColumns.length > 0 && !opts.allowUnknownColumns) {
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stderr.write(
          `facilities import refused: unrecognised column(s) in ${path}: ${result.unknownColumns.join(', ')}\n` +
            `rerun with --allow-unknown-columns to import anyway (they will be carried into each row's extras)\n`,
        );
      }
      return 1;
    }

    // A dry run writes nothing, so it has nothing to audit — only an applied import is recorded.
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'facility.import',
        entityType: 'facility',
        entityId: opts.nationalSystem,
        metadata: { path, nationalSystem: opts.nationalSystem, allowUnknownColumns: !!opts.allowUnknownColumns, result },
      });
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatHuman(result, opts) + '\n');
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities import failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatHuman(
  result: { parsed: number; skipped: number; unknownColumns: string[]; created: number; updated: number; duplicates: number },
  opts: FacilitiesImportOpts,
): string {
  const lines: string[] = [];
  lines.push(
    opts.apply
      ? `applied: created ${result.created}, updated ${result.updated}`
      : `DRY RUN — nothing written. Rerun with --apply to write.`,
  );
  lines.push(`parsed ${result.parsed} row(s), skipped ${result.skipped}`);
  if (result.unknownColumns.length > 0) {
    lines.push(`unknown columns allowed through --allow-unknown-columns (carried into extras): ${result.unknownColumns.join(', ')}`);
  }
  if (result.duplicates > 0) {
    lines.push(
      `WARNING: ${result.duplicates} row(s) shared a national_code with another row in this file — duplicates were collapsed, last row wins`,
    );
  }
  return lines.join('\n');
}
