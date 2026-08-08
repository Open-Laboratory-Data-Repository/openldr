import { readFileSync } from 'node:fs';
import type { Kysely } from 'kysely';
import { loadConfig } from '@openldr/config';
import {
  createAppContext, importFacilities, recordAuditEvent, scanObservedFacilities, publishFacilityMap,
  listFacilityMappingConflicts, facilityHealth,
  type AppContext, type ScanResult, type PublishResult, type FacilityMappingConflict, type FacilityHealth,
} from '@openldr/bootstrap';
import { referenceCapture, type ExternalSchema } from '@openldr/db';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

export interface FacilitiesImportOpts {
  nationalSystem: string;
  /** The caller opts IN to writing (see facility-import.ts's `FacilityImportOptions.apply`).
   *  Omitted/false ⇒ dry run: parse and report, write NOTHING — the default, deliberately, so a
   *  14 000-row national register can never be silently rewritten by forgetting a flag. */
  apply?: boolean;
  allowUnknownColumns?: boolean;
  /** Import despite structurally malformed rows (see facility-import.ts's
   *  `FacilityImportOptions.allowMalformedRows`) — the explicit "I have seen the line numbers,
   *  import the rest" override, mirroring `allowUnknownColumns` above. */
  allowMalformedRows?: boolean;
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
      // Fix 1 (mapping-ux report): `admin` lets importFacilities project every written row into
      // FACILITY_REGISTRY_SYSTEM as part of the import — the CLI gets the same immediate-mapping
      // behaviour as the HTTP route, per the repo's CLI-parity rule.
      { db: ctx.internalDb, capture: referenceCapture, admin: ctx.terminology.admin },
      csv,
      {
        nationalSystem: opts.nationalSystem, allowUnknownColumns: opts.allowUnknownColumns,
        allowMalformedRows: opts.allowMalformedRows, apply: opts.apply,
      },
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

    // Task 5: same "explicit override" idiom as unknown columns above, for structurally malformed
    // rows (see facility-import.ts's `FacilityImportOptions.allowMalformedRows`). Unlike
    // unknownColumns, `parsed` does NOT drop to 0 here — the well-formed rows in the file still
    // parse (facility-csv.ts) — so this is its own check, not covered by the block above. Fires
    // on a dry run too: the line numbers are exactly what a preview exists to surface before the
    // operator ever considers --apply.
    //
    // ⛔ `result.blocked` is READ, not re-derived (see `FacilityImportResult.blocked`): it is the
    // same predicate `importFacilities` itself applies, so this exit code can no longer disagree
    // with whether the file was actually written. `blockedReason` picks which explanation to print
    // — duplicate headers have no override, so telling an operator to pass --allow-malformed-rows
    // would be pointing at a switch that cannot help them.
    if (result.blocked) {
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else if (result.blockedReason === 'duplicate-columns') {
        process.stderr.write(
          `facilities import refused: duplicate column header(s) in ${path}: ${result.duplicateColumns.join(', ')}\n` +
            'which of two identically-named columns wins is arbitrary, so there is no override — ' +
            'remove or rename the duplicate(s) and re-run\n',
        );
      } else {
        for (const row of result.quarantined) {
          process.stderr.write(`line ${row.line}: ${row.reason} — ${row.raw}\n`);
        }
        process.stderr.write(
          `${result.quarantined.length} row(s) quarantined; re-run with --allow-malformed-rows to import the rest\n`,
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
        metadata: {
          path, nationalSystem: opts.nationalSystem, allowUnknownColumns: !!opts.allowUnknownColumns,
          allowMalformedRows: !!opts.allowMalformedRows, result,
        },
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

// ── Task 8: observed-facility reconciliation CLI parity ────────────────────────────────────────
//
// Thin CLI wrappers over `@openldr/bootstrap`'s scan/publish pair (Tasks 3-4/9b) — the same
// functions apps/server/src/facilities-routes.ts's `POST /api/facilities/scan-observed` and
// `POST /api/facilities/publish` call, per the repo's CLI-parity rule. Both follow
// `runFacilitiesImport`'s established shape above: `createAppContext(loadConfig())`,
// `redactError` instead of a stack trace, a `--json` branch, dry-run-by-default with `--apply`
// opting in, and an audit call only after an applied run.
//
// ⚠ Task 9b removed the caller-chosen destination `system` option entirely — both functions now
// derive a coding system PER ROW from `diagnostic_reports.source_system`, so there is nothing left
// for a CLI flag to select. Do not reintroduce `--system`.

/** Assembles the same `ReconcileDeps` shape apps/server/src/facilities-routes.ts's own
 *  `reconcileDeps` builds off an `AppContext` (`ctx.store.db` as the external/warehouse handle,
 *  `ctx.terminology.admin` as the terminology admin store) — kept in lockstep here rather than
 *  reached through a shared export, since the route's helper is a private, unexported function. */
function reconcileDeps(ctx: AppContext) {
  return {
    internalDb: ctx.internalDb,
    externalDb: ctx.store.db as unknown as Kysely<ExternalSchema>,
    admin: ctx.terminology.admin,
  };
}

export interface FacilitiesScanObservedOpts {
  /** The caller opts IN to writing — omitted/false ⇒ dry run: report counts, write nothing. */
  apply?: boolean;
  json: boolean;
}

/**
 * `openldr facilities scan-observed [--apply] [--json]`
 *
 * Discover new/changed observed-facility strings from diagnostic-report feeds and record them as
 * concepts (`@openldr/bootstrap`'s `scanObservedFacilities`, Task 3). Dry-run by default.
 */
export async function runFacilitiesScanObserved(opts: FacilitiesScanObservedOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result: ScanResult = await scanObservedFacilities(reconcileDeps(ctx), { apply: opts.apply });

    // A dry run writes nothing, so it has nothing to audit — only an applied scan is recorded.
    // Matches the HTTP route: `apply: true` always performs a real write (even a discovery of
    // zero new codes still re-registers/re-activates the observed-facility coding systems), so
    // auditing is unconditional on `apply`, not further gated on a count.
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'facility.scan',
        entityType: 'facility',
        // Task 9b: one call now scans every feed's system at once — there is no single system
        // this audit entry is "about" (matches the HTTP route's entityId).
        entityId: 'facility-observed:all-feeds',
        before: null,
        after: null,
        metadata: { result },
      });
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatScanHuman(result, opts) + '\n');
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities scan-observed failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatScanHuman(result: ScanResult, opts: FacilitiesScanObservedOpts): string {
  const counts = `discovered ${result.discovered}, created ${result.created}, updated ${result.updated}, system registered ${result.systemRegistered}`;
  return opts.apply
    ? `applied: ${counts}`
    : `DRY RUN — nothing written. Rerun with --apply to write.\n${counts}`;
}

export interface FacilitiesPublishOpts {
  /** The caller opts IN to writing — omitted/false ⇒ dry run: report counts, write nothing. */
  apply?: boolean;
  json: boolean;
}

/**
 * `openldr facilities publish [--apply] [--json]`
 *
 * Rebuild `facility_map` (the warehouse-side reporting dimension) from the current resolution
 * (`@openldr/bootstrap`'s `publishFacilityMap`, Task 4). Dry-run by default.
 */
export async function runFacilitiesPublish(opts: FacilitiesPublishOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result: PublishResult = await publishFacilityMap(reconcileDeps(ctx), { apply: opts.apply });

    // Same reasoning as scan-observed above: `apply: true` always performs a real write (the
    // delete-then-insert rebuild runs unconditionally), so auditing is unconditional on `apply`.
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'facility.publish',
        entityType: 'facility',
        entityId: 'facility-observed:all-feeds',
        before: null,
        after: null,
        metadata: { result },
      });
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatPublishHuman(result, opts) + '\n');
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities publish failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatPublishHuman(result: PublishResult, opts: FacilitiesPublishOpts): string {
  const counts = `resolved ${result.resolved}, unmapped ${result.unmapped}, targetMissing ${result.targetMissing}, nonFacilityTarget ${result.nonFacilityTarget}, ambiguous ${result.ambiguous}, written ${result.written}`;
  return opts.apply
    ? `applied: ${counts}`
    : `DRY RUN — nothing written. Rerun with --apply to write.\n${counts}`;
}

// ── Task 13: the mapping-conflict review queue ─────────────────────────────────────────────────

export interface FacilitiesConflictsOpts {
  json: boolean;
}

/**
 * `openldr facilities conflicts [--json]`
 *
 * List every unresolved row of `facility_mapping_conflicts` — the violations migration 078 recorded
 * (and, for the 'duplicate' kind, DEACTIVATED) when it closed "one active SAME-AS resolution per
 * observed facility key" at the database. CLI parity for
 * `GET /api/facilities/mapping-conflicts` (apps/server/src/facilities-routes.ts): both call the
 * same `listFacilityMappingConflicts`.
 *
 * ⚠ Read-only, so — unlike import/scan/publish above — there is no `--apply`, and nothing is
 * audited. There is no `--all` either: `listFacilityMappingConflicts` filters to `resolved_at is
 * null` and nothing in CE ever sets that column, so a flag to show settled rows would today be a
 * flag that changes nothing.
 */
export async function runFacilitiesConflicts(opts: FacilitiesConflictsOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const conflicts = await listFacilityMappingConflicts({ internalDb: ctx.internalDb });

    if (opts.json) {
      process.stdout.write(JSON.stringify(conflicts, null, 2) + '\n');
    } else {
      process.stdout.write(formatConflictsHuman(conflicts) + '\n');
    }
    // An empty queue is the healthy state, not a failure — exiting non-zero would break any script
    // running this as a check.
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities conflicts failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatConflictsHuman(conflicts: FacilityMappingConflict[]): string {
  if (conflicts.length === 0) return 'no unresolved facility mapping conflicts';

  // Column widths are computed from the rows actually present rather than hardcoded: `from_system`
  // is a full URI whose length varies per deployment, so a fixed width would either waste most of
  // the line or ragged-wrap every row.
  const rows = conflicts.map((c) => [c.fromSystem, c.fromCode, c.kind, c.mappingIds.join(',')]);
  const header = ['from_system', 'from_code', 'kind', 'mapping_ids'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  // The last column is never padded — trailing whitespace on every line for no visual benefit.
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ');

  return [line(header), ...rows.map(line)].join('\n');
}

// ── Task 10: report-dimension health + job retry CLI parity ───────────────────────────────────
//
// `openldr facilities jobs [--retry <id>]` — CLI parity for `GET /api/facilities/health` and
// `POST /api/facilities/jobs/:id/retry` (apps/server/src/facilities-routes.ts): both surface Task
// 9's `facilityHealth`, and both re-queue through `ctx.facilityJobs.retry` — the OPERATOR's action
// (resets `attempts`, so someone who fixed the underlying cause is not locked out by a previously
// exhausted retry budget), never `retryPreservingAttempts` (the WORKER's own automatic retry).
//
// An operator with shell access but no browser session (a lab technician SSH'd into the appliance,
// say) previously had no way to see whether `facility_map` had caught up with a mapping change, nor
// retry a failed rebuild, without querying `facility_jobs` by hand.

export interface FacilitiesJobsOpts {
  /** Re-queue this job id before reporting the (now-updated) health, mirroring the HTTP route's
   *  `POST /api/facilities/jobs/:id/retry`. Omitted ⇒ read-only: report health, retry nothing. */
  retry?: string;
  json: boolean;
}

/**
 * `openldr facilities jobs [--retry <id>] [--json]`
 *
 * Prints the report-dimension health (Task 9's `facilityHealth`) and, with `--retry <id>`, re-queues
 * a failed facility job first. Unlike `import`/`scan-observed`/`publish` above, there is no
 * `--apply`/dry-run split here: reading health never writes, and `--retry` is itself the single
 * explicit write this command can perform — there is no "preview a retry" to gate behind a flag.
 */
export async function runFacilitiesJobs(opts: FacilitiesJobsOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    // Re-queue FIRST, so the health this call prints already reflects the retry (a re-queued job
    // reads back as 'updating', not the stale 'failed' it was a moment ago). Any failure here
    // (including "no such job" — the HTTP route's own 404 case; this CLI has no HTTP status to
    // return, so it surfaces as the redacted error message below instead) is reported the same way
    // every other run* function in this file reports a thrown error.
    if (opts.retry) {
      await ctx.facilityJobs.retry(opts.retry);
    }

    const health: FacilityHealth = await facilityHealth({ internalDb: ctx.internalDb, jobs: ctx.facilityJobs });

    if (opts.json) {
      process.stdout.write(JSON.stringify(health, null, 2) + '\n');
    } else {
      process.stdout.write(formatJobsHuman(health) + '\n');
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities jobs failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatJobsHuman(health: FacilityHealth): string {
  const { reportDimension: dim, projection } = health;
  const lines = [`report dimension: ${dim.state}`];
  lines.push(`last successful rebuild: ${dim.lastSuccessAt ?? 'never'}${dim.rows != null ? ` (${dim.rows} rows)` : ''}`);
  if (dim.error) lines.push(`last error: ${dim.error}`);
  lines.push(`failed projection retries: ${projection.failedCount}`);
  return lines.join('\n');
}
