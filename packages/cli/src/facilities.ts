import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { loadConfig } from '@openldr/config';
import {
  createAppContext, importFacilities, recordAuditEvent, scanObservedFacilities, publishFacilityMap,
  listFacilityMappingConflicts, facilityHealth,
  type AppContext, type ScanResult, type PublishResult, type FacilityMappingConflict, type FacilityHealth,
  type FacilityImportResult,
} from '@openldr/bootstrap';
import {
  referenceCapture, createFacilityImportRunStore, type ExternalSchema,
  type FacilityImportRun, type FacilityImportRunStore,
} from '@openldr/db';
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
  /** Mirrors `FacilityImportOptions.allowInvalidCoordinates` — import a row whose coordinate failed
   *  validation anyway, with both `latitude`/`longitude` written as null. Third member of the same
   *  explicit-override family as the two above. */
  allowInvalidCoordinates?: boolean;
  /** Task 12: mirrors `FacilityImportOptions.format` exactly — which shape `path` is: a national
   *  register CSV or a JSONL release. Default `'csv'`, same as `importFacilities` itself. */
  format?: 'csv' | 'jsonl';
  /** A publisher-supplied release version, recorded on the `facility_import_runs` row an `--apply`
   *  mints (see below) and passed through to `FacilityImportOptions.releaseVersion`, which defaults
   *  it from a JSONL release's own `meta.version` when this is omitted. Pure provenance. */
  releaseVersion?: string;
  /** Mirrors `FacilityImportOptions.completeRelease` — see its doc comment. The ONLY thing that
   *  flips `result.absent` from `null` ("not evaluated") to a real count. */
  completeRelease?: boolean;
  /** Mirrors `FacilityImportOptions.onDeleted`. */
  onDeleted?: 'retire' | 'report';
  /** Mirrors `FacilityImportOptions.onAbsent`. */
  onAbsent?: 'retire' | 'report';
  /** Mirrors `FacilityImportOptions.onConflict`. Currently has no effect on this CLI path because
   *  the single-step apply lacks a preview watermark to detect conflicts against. */
  onConflict?: 'skip' | 'overwrite';
  json: boolean;
}

/**
 * `openldr facilities import <path> --national-system <sys> [--apply] [--allow-unknown-columns]
 * [--allow-malformed-rows] [--allow-invalid-coordinates] [--format csv|jsonl] [--release-version <v>]
 * [--complete-release] [--on-deleted retire|report] [--on-absent retire|report]
 * [--on-conflict skip|overwrite] [--json]`
 *
 * Thin CLI wrapper over `@openldr/bootstrap`'s `importFacilities` (Task 2) — the same function
 * Task 4's HTTP route calls, per the repo's CLI-parity rule. This file owns only: reading the file
 * with a redacted error instead of a stack trace, wiring `deps` (internalDb + referenceCapture) off
 * `createAppContext`, the unknown-columns/blocked refusal messages, the duplicates warning, minting
 * and finishing this apply's `facility_import_runs` row (Task 12, below), and auditing an applied
 * import (`facility.import`, matching `facility.create`/`facility.update`/`facility.delete` in
 * apps/server/src/facilities-routes.ts).
 *
 * ## Task 12: run recording, and why only `--apply` mints one
 *
 * Task 10's HTTP route mints a `facility_import_runs` row on EVERY standalone preview (not only an
 * apply), because the route drives a two-step interactive flow: preview, let the operator read it,
 * then a LATER apply request carries the previewed `runId` back so `previewedAt` can gate conflict
 * detection. A preview that is never followed by that later apply is the ordinary "the operator
 * changed their mind and closed the sheet" case, and `active_key` (migration 080, one non-terminal
 * row per `nationalSystem`) would otherwise be held by it forever — which is exactly why the route
 * carries its own "supersede an abandoned run on the next preview" retry logic. That gate asks
 * `SUPERSEDABLE_RUN_STATES` (facility-import-run-states.ts), not a `previewed` literal: `queued` and
 * `awaiting_confirmation` are abandoned in the same way and are taken over the same way.
 *
 * This CLI has no equivalent two-step shape: preview and apply are the SAME synchronous call (there
 * is no `--run-id` flag to thread a run across two separate invocations), so there is no gap for an
 * abandoned run to usefully occupy, and reproducing the route's supersede dance here would only
 * exist to undo a lock this command need not take in the first place. So a DRY RUN mints nothing —
 * matching that the audit event below is *also* apply-only — and only `--apply` starts a run, which
 * is finished (`'applied'` or `'failed'`) before this function returns by EVERY exit path below,
 * including a thrown `importFacilities` and the two refusal branches (unknown columns, blocked):
 * `active_key` must never survive this function still pointing at `opts.nationalSystem`, or every
 * later import of that register — CLI or browser — 409s against a run nothing will ever finish.
 *
 * ⛔ `startPreview`/`finishApply` (packages/db/facility-import-run-store.ts), not an `insertRunning`-
 * style pre-claimed row: unlike `terminology_ingest_jobs` (whose `insertRunning` exists so a live
 * SERVER WORKER polling for `'queued'` rows never claims one an inline CLI ingest already owns),
 * nothing ever asynchronously claims a `facility_import_runs` row on THIS path — the `'queued'`/
 * `'applying'` states A2b names (facility-import-run-states.ts) belong to the background upload
 * flow, and no worker exists yet to claim one. `startPreview`'s own pre-check plus the
 * unique `active_key` index already give this call exclusive claim to `opts.nationalSystem` for as
 * long as it runs, which is the entire concurrency guarantee an inline CLI import needs.
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
  const importRuns = createFacilityImportRunStore(ctx.internalDb);
  // Populated only for `--apply` — see the docblock above for why a dry run mints nothing. Every
  // path out of this function below that ran with `run` non-null MUST finish it before returning.
  let run: FacilityImportRun | null = null;
  try {
    if (opts.apply) {
      try {
        run = await importRuns.startPreview({
          nationalSystem: opts.nationalSystem,
          sourceFormat: opts.format ?? 'csv',
          fileHash: createHash('sha256').update(csv, 'utf8').digest('hex'),
          byteSize: Buffer.byteLength(csv, 'utf8'),
          releaseVersion: opts.releaseVersion ?? null,
          options: {
            nationalSystem: opts.nationalSystem, allowUnknownColumns: !!opts.allowUnknownColumns,
            allowMalformedRows: !!opts.allowMalformedRows,
            allowInvalidCoordinates: !!opts.allowInvalidCoordinates, format: opts.format,
            completeRelease: opts.completeRelease, onDeleted: opts.onDeleted, onAbsent: opts.onAbsent,
            onConflict: opts.onConflict,
          },
          requestedBy: cliActor().actorName,
        });
      } catch (err) {
        // `startPreview` throws when `active_key` is already held for this `nationalSystem` — by a
        // concurrent import, or by a browser run left in any non-terminal state (`previewed`, or
        // A2b's `queued`/`awaiting_confirmation`) that nobody ever applied or cancelled. Unlike the
        // HTTP route, this command does NOT supersede that row; it refuses, per the docblock above.
        // No run was minted for THIS call, so there is nothing here for this catch to release.
        const msg = redactError(err);
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
        else process.stderr.write(`facilities import refused: ${msg}\n`);
        return 1;
      }
    }

    // ⛔ Preview FIRST, ALWAYS, and decide the refusals off THAT — never off a call that already
    // wrote. This function used to call `importFacilities` once with `apply: true` and only then
    // check whether it should have refused, so a refused file had already been applied by the time
    // the refusal was printed. That is not merely untidy: a file with an unrecognised column parses
    // to ZERO records, and an apply carrying zero records used to infer that every registry row for
    // this register was absent — so `--complete-release --on-absent retire` mass-retired the whole
    // national register, printed "refused", marked the run failed and skipped the audit. The
    // importer's own absence guard (packages/bootstrap/src/facility-import.ts) closes that hole at
    // the source; this ordering closes it here, and mirrors the HTTP route, which likewise decides
    // its refusals off a preview before ever opening a write.
    //
    // Cost: an `--apply` parses and classifies the file TWICE. That is the same shape the route
    // already pays for its two-step flow, and it is the price of never writing before deciding. A
    // DRY RUN still makes exactly ONE call — `apply` is undefined there, so this preview IS the run
    // being reported.
    // Fix 1 (mapping-ux report): `admin` lets importFacilities project every written row into
    // FACILITY_REGISTRY_SYSTEM as part of the import — the CLI gets the same immediate-mapping
    // behaviour as the HTTP route, per the repo's CLI-parity rule.
    //
    // ⛔ `facilityJobs` is NOT optional in practice on this path, despite the deps type allowing
    // its omission. This command is not the only way a national-scale register is applied — the
    // HTTP route's `POST /api/facilities/import/upload` (A2b) carries no row cap at all, and is
    // the door most national registers actually go through. But this command IS one of the doors a
    // 14 000-row register can be applied through, and it must behave the same as the others once it
    // is. Without the store, `importFacilities` skips its enqueue (`if (deps.facilityJobs)`) and an
    // import through this command would be the one write that leaves `facility_map` stale with
    // nothing queued to rebuild it, sending the operator back to the manual
    // `facilities publish --apply` this slice exists to abolish.
    //
    // ⛔ `audit` likewise, and for the same parity reason (whole-branch Critical 2). Task 7's
    // per-facility `facility.import.row` events are what `GET /api/facilities/:id/history` reads
    // back; omitting the store here made a register applied through the CLI the one write whose
    // changed rows never reach a facility's own history, while `importFacilities` logged that the
    // per-row write was unaudited. It is `ctx.audit` — the same store `recordAuditEvent` below uses
    // for this command's register-scoped `facility.import` entry.
    const deps = { db: ctx.internalDb, capture: referenceCapture, admin: ctx.terminology.admin, facilityJobs: ctx.facilityJobs, audit: ctx.audit, logger: ctx.logger };
    const importOptions = {
      nationalSystem: opts.nationalSystem, allowUnknownColumns: opts.allowUnknownColumns,
      allowMalformedRows: opts.allowMalformedRows,
      allowInvalidCoordinates: opts.allowInvalidCoordinates,
      format: opts.format, completeRelease: opts.completeRelease, releaseVersion: opts.releaseVersion,
      onDeleted: opts.onDeleted, onAbsent: opts.onAbsent, onConflict: opts.onConflict,
      // ⛔ `previewedAt` is deliberately NOT threaded from `run` here — see the docblock above:
      // this run's `previewed_at` (were we to complete it) would be set microseconds before this
      // same call, evaluating a conflict window that cannot contain a real conflict, only ever
      // reporting `conflict: 0` and asserting a check that means nothing. `runId` still links the
      // write to its run row for provenance; `conflict` stays `null` — not evaluated — same as
      // any run-id-less apply through the HTTP route.
      runId: run?.id ?? null,
    };

    // `apply: opts.apply` on this first call, NOT a hardcoded `false`: on a dry run `opts.apply` is
    // falsy, so this IS the single call the command makes and the result it reports; on an
    // `--apply` it is deliberately overridden to a preview below, and the real write only happens
    // once every refusal check has passed.
    const preview: FacilityImportResult = await importFacilities(
      deps, csv, opts.apply ? { ...importOptions, apply: undefined } : importOptions,
    );

    // ⚠ FORMAT-AWARE, and that is the fix for the CLI/JSONL contradiction. `parseFacilityRelease`
    // never blocks on an unrecognised key — each JSONL line is a self-describing object, the key is
    // captured into `extras`, and `allowUnknownColumns` is a documented no-op for that format — yet
    // this refusal fired regardless of format, so a JSONL release that grew a field was rejected
    // HERE while the HTTP route accepted the identical file. Since the route caps an inline apply at
    // MAX_INLINE_APPLY_ROWS and points larger registers at this command, that made a national-scale
    // release with one new key unapplicable by any path at all. For CSV the refusal stands exactly
    // as before: there, `records` really is empty (`parsed: 0`) and an unrecognised header can shift
    // every subsequent column.
    const refusedForUnknownColumns =
      opts.format !== 'jsonl' && preview.unknownColumns.length > 0 && !opts.allowUnknownColumns;

    // Refuse loudly and name the columns rather than let the caller read a generic all-zero
    // summary and wonder why nothing happened. For CSV — the only format this can fire for, see
    // `refusedForUnknownColumns` above — `parseFacilityCsv` returned `records: []`, so `parsed` is 0.
    if (refusedForUnknownColumns) {
      if (run) {
        await finishRun(importRuns, run.id, 'failed', `refused: unrecognised column(s): ${preview.unknownColumns.join(', ')}`);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
      } else {
        process.stderr.write(
          `facilities import refused: unrecognised column(s) in ${path}: ${preview.unknownColumns.join(', ')}\n` +
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
    if (preview.blocked) {
      if (run) {
        const reason = preview.blockedReason === 'duplicate-columns'
          ? `refused: duplicate column header(s): ${preview.duplicateColumns.join(', ')}`
          : `refused: ${preview.quarantined.length} row(s) quarantined`;
        await finishRun(importRuns, run.id, 'failed', reason);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
      } else if (preview.blockedReason === 'duplicate-columns') {
        process.stderr.write(
          `facilities import refused: duplicate column header(s) in ${path}: ${preview.duplicateColumns.join(', ')}\n` +
            'which of two identically-named columns wins is arbitrary, so there is no override — ' +
            'remove or rename the duplicate(s) and re-run\n',
        );
      } else {
        for (const row of preview.quarantined) {
          process.stderr.write(`line ${row.line}: ${row.reason} — ${row.raw}\n`);
        }
        process.stderr.write(
          `${preview.quarantined.length} row(s) quarantined; re-run with --allow-malformed-rows to import the rest\n`,
        );
      }
      return 1;
    }

    // Every refusal has now passed, so — and only so — does the write run. A dry run reuses the
    // preview above verbatim: `apply` was already falsy on that call, so there is nothing left for a
    // second one to do.
    const result: FacilityImportResult = opts.apply
      ? await importFacilities(deps, csv, { ...importOptions, apply: true })
      : preview;

    // A dry run writes nothing, so it has nothing to audit — only an applied import is recorded.
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'facility.import',
        entityType: 'facility',
        entityId: opts.nationalSystem,
        metadata: {
          path, nationalSystem: opts.nationalSystem, allowUnknownColumns: !!opts.allowUnknownColumns,
          allowMalformedRows: !!opts.allowMalformedRows,
          allowInvalidCoordinates: !!opts.allowInvalidCoordinates, result,
        },
      });
      if (run) await finishRun(importRuns, run.id, 'applied', null, result);
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatHuman(result, opts) + '\n');
    }
    return 0;
  } catch (err) {
    if (run) await finishRun(importRuns, run.id, 'failed', redactError(err));
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities import failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

/** Best-effort `finishApply`, matching the HTTP route's own wrapped `finishApply` calls
 *  (facilities-routes.ts): a SECOND failure here (the DB write that clears `active_key` itself
 *  failing) must not mask the original error/result this call is trying to record, and there is no
 *  logger to hand it to from a plain function — a warning goes to stderr, which never corrupts a
 *  `--json` response since that is written to stdout separately. */
async function finishRun(
  importRuns: FacilityImportRunStore, id: string, status: 'applied' | 'failed',
  error: string | null, summary?: unknown,
): Promise<void> {
  try {
    await importRuns.finishApply(id, status, { error, ...(summary === undefined ? {} : { summary }) });
  } catch {
    process.stderr.write(`warning: failed to record facility import run ${id} as ${status}\n`);
  }
}

// ⚠ Reads `written.created`/`written.updated`/`written.retired` — what the import actually WROTE — AND
// `create`/`changed`/`unchanged`/`conflict`/`absent` — what the file WOULD do / what was compared
// against the registry, computed on EVERY call per FAC-P1-03. `conflict`/`absent` print as "not
// evaluated" whenever they are `null`, never `0` — that distinction (a measurement never taken vs. a
// measurement of zero) is the entire point of Task 12; collapsing it back to `0` here would silently
// reintroduce into the CLI's own output the exact defect this slice exists to remove.
function formatHuman(result: FacilityImportResult, opts: FacilitiesImportOpts): string {
  const lines: string[] = [];
  lines.push(
    opts.apply
      // ⛔ `retired` is printed alongside created/updated because it is a MUTATION this command
      // performed, and `--on-absent retire`/`--on-deleted retire` previously left an operator with
      // an `absent` count and no confirmation of what was actually done about it.
      ? `applied: created ${result.written.created}, updated ${result.written.updated}, retired ${result.written.retired}`
      : `DRY RUN — nothing written. Rerun with --apply to write.`,
  );
  lines.push(`parsed ${result.parsed} row(s), skipped ${result.skipped}`);
  const conflictText = result.conflict === null ? 'not evaluated' : String(result.conflict);
  const absentText = result.absent === null ? 'not evaluated' : String(result.absent);
  lines.push(
    `classified: create ${result.create}, changed ${result.changed}, unchanged ${result.unchanged}, `
      + `conflict ${conflictText}, absent ${absentText}`,
  );
  if (result.deleted > 0) lines.push(`deleted ${result.deleted}`);
  // 🟠 Important 3: `invalid` reached NO human-facing consumer — a row rejected for a bad coordinate
  // vanished from this output entirely and was visible only under --json. Line numbers are bounded
  // the same way the quarantine listing above is bounded by the file's own row count: this prints
  // at most the first few and says how many there are in total.
  if (result.invalid.length > 0) {
    const lineNumbers = [...new Set(result.invalid.map((e) => e.line))];
    const shown = lineNumbers.slice(0, INVALID_LINES_SHOWN).join(', ');
    const more = lineNumbers.length > INVALID_LINES_SHOWN ? `, … (+${lineNumbers.length - INVALID_LINES_SHOWN} more)` : '';
    lines.push(
      // "error(s)" not "row(s)": facility-csv.ts pushes one RowError PER FIELD, so a row with both
      // coordinates rejected contributes two entries (see `FacilityImportResult.invalid`).
      `${result.invalid.length} coordinate error(s) on line(s) ${shown}${more}`
        + (opts.allowInvalidCoordinates
          ? ' — imported anyway with no coordinate (--allow-invalid-coordinates)'
          : ' — those rows were NOT imported; re-run with --allow-invalid-coordinates to import them without a coordinate'),
    );
  }
  if (result.unknownColumns.length > 0) {
    // Format-aware, matching the refusal above: for JSONL these keys were never a refusal at all —
    // they are captured into `extras` regardless — so naming an override that has no effect on that
    // format would be pointing the operator at a switch that does nothing.
    lines.push(opts.format === 'jsonl'
      ? `unrecognised key(s) carried into extras: ${result.unknownColumns.join(', ')}`
      : `unknown columns allowed through --allow-unknown-columns (carried into extras): ${result.unknownColumns.join(', ')}`);
  }
  for (const m of result.countMismatch) {
    lines.push(`WARNING: the release declares ${m.declared} ${m.field === 'rowCount' ? 'row(s)' : 'deletion(s)'}, ${m.parsed} parsed`);
  }
  // FAC-P1-05: a source value with no mapping is NEVER blocked and NEVER blanked — it is written
  // raw, exactly as before this layer existed. This is the warning that says so.
  for (const field of Object.keys(result.unmapped) as (keyof typeof result.unmapped)[]) {
    const values = result.unmapped[field];
    if (values.length === 0) continue;
    lines.push(
      `${values.length} unmapped ${field} value(s) written as-is: ${values.slice(0, UNMAPPED_VALUES_SHOWN).join(', ')}`
        + (values.length > UNMAPPED_VALUES_SHOWN ? `, … (+${values.length - UNMAPPED_VALUES_SHOWN} more)` : ''),
    );
  }
  if (result.notValidated.length > 0) {
    lines.push(`not validated (no canonical value set on this install): ${result.notValidated.join(', ')}`);
  }
  if (result.duplicates > 0) {
    lines.push(
      `WARNING: ${result.duplicates} row(s) shared a national_code with another row in this file — duplicates were collapsed, last row wins`,
    );
  }
  return lines.join('\n');
}

/** How many distinct line numbers / raw values the two listings above print before summarising the
 *  rest as a count. A 14 000-row national register can carry thousands of either, and a terminal is
 *  not where that list belongs — `--json` carries every entry. */
const INVALID_LINES_SHOWN = 10;
const UNMAPPED_VALUES_SHOWN = 10;

// ── Task 12: `openldr facilities import-runs` / `import-run <id>` ─────────────────────────────
//
// CLI parity for Task 10's `GET /api/facilities/import/runs` and `GET
// /api/facilities/import/runs/:id` (apps/server/src/facilities-routes.ts) — both read the same
// `facility_import_runs` table this file's `runFacilitiesImport` now writes to. Read-only: no
// --apply, nothing audited, same shape as `runFacilitiesConflicts` above.

export interface FacilitiesImportRunsOpts {
  /** Scope to one national register. Omitted ⇒ every register this instance has ever imported. */
  nationalSystem?: string;
  /** Maximum rows to return. Omitted ⇒ the store's own default (50, see
   *  facility-import-run-store.ts's `list`). */
  limit?: number;
  json: boolean;
}

/** `openldr facilities import-runs [--national-system <sys>] [--limit <n>] [--json]` */
export async function runFacilitiesImportRuns(opts: FacilitiesImportRunsOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const importRuns = createFacilityImportRunStore(ctx.internalDb);
    const runs = await importRuns.list(opts.nationalSystem, opts.limit);
    if (opts.json) {
      process.stdout.write(JSON.stringify(runs, null, 2) + '\n');
    } else {
      process.stdout.write(formatImportRunsHuman(runs) + '\n');
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities import-runs failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatImportRunsHuman(runs: FacilityImportRun[]): string {
  if (runs.length === 0) return 'no facility import runs recorded';
  // ⛔ A2b Task 9: `phase` is a COLUMN here, not a detail-view-only field. `status` alone cannot show
  // a background run: `validating` and `applying` each cover a whole pass over the file, and the
  // only thing that says where inside that pass the worker is, is the free-text phase it publishes
  // through `updateProgress` (facility-import-run-store.ts). Without it this list answers "is
  // something happening" and never "what". `'—'` for the inline A2a path, which no worker ever
  // claims and which therefore never has one.
  const rows = runs.map((r) => [r.id, r.nationalSystem, r.status, r.phase ?? '—', r.sourceFormat, r.createdAt, r.finishedAt ?? '—']);
  const header = ['id', 'national_system', 'status', 'phase', 'format', 'created_at', 'finished_at'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
  return [line(header), ...rows.map(line)].join('\n');
}

export interface FacilitiesImportRunOpts {
  json: boolean;
}

/** `openldr facilities import-run <id> [--json]`
 *
 * One run's full detail, including its stored `summary` — the same `FacilityImportResult` the
 * preview or apply reported at the time — so an operator can see exactly what a past import did
 * without re-running it. */
export async function runFacilitiesImportRun(id: string, opts: FacilitiesImportRunOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const importRuns = createFacilityImportRunStore(ctx.internalDb);
    const run = await importRuns.get(id);
    if (!run) {
      const msg = `no such facility import run: ${id}`;
      if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
      else process.stderr.write(`facilities import-run failed: ${msg}\n`);
      return 1;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    } else {
      process.stdout.write(formatImportRunHuman(run) + '\n');
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities import-run failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatImportRunHuman(run: FacilityImportRun): string {
  const lines = [
    `id: ${run.id}`,
    `national system: ${run.nationalSystem}`,
    `status: ${run.status}`,
    // A2b Task 9: the worker's own columns (`phase`/`processed`/`total`, written by
    // `updateProgress`). This detail view is where a shell-only operator watches a background run,
    // and until now every one of these was reachable ONLY under `--json`.
    `phase: ${run.phase ?? '(none)'}`,
    // ⚠ `total` is null until the worker KNOWS one, and that is printed as such rather than as a
    // denominator of 0 or a bare percentage — the same "not evaluated is not zero" rule the
    // import summary above follows for `conflict`/`absent`.
    `progress: ${run.processed} row(s) processed${run.total == null ? ' (total not yet known)' : ` of ${run.total}`}`,
    `format: ${run.sourceFormat}`,
    `release version: ${run.releaseVersion ?? '(none)'}`,
    `requested by: ${run.requestedBy ?? '(unknown)'}`,
    `created: ${run.createdAt}`,
    // Distinct from `created`: a queued run is created long before any worker claims it, and the
    // gap between the two is the only way to see a job waiting for a worker that never came.
    `started: ${run.startedAt ?? '(not started)'}`,
    `finished: ${run.finishedAt ?? '(not finished)'}`,
  ];
  // ⛔ Printed only when the flag is actually set, and phrased as a REQUEST rather than a stop. The
  // flag is observed at phase boundaries and cannot interrupt a running transaction, so a run
  // carrying it may still finish `applied` — the same distinction `runFacilitiesImportRunCancel`
  // below exists to keep. A permanently-present "cancel requested: no" line would also bury it.
  if (run.cancelRequested) {
    lines.push('cancel requested: yes — a worker observes this at its next phase boundary; a write already in progress will finish');
  }
  if (run.error) lines.push(`error: ${run.error}`);
  if (run.summary) lines.push(`summary: ${JSON.stringify(run.summary)}`);
  return lines.join('\n');
}

// ── A2b Task 9: `openldr facilities import-run-cancel <id>` ───────────────────────────────────

/** The four answers `requestCancel` can give, DERIVED from the store rather than re-spelled — a
 *  fifth outcome added there becomes a `tsc` error in `CANCEL_OUTCOMES` below instead of a silent
 *  fall-through to whatever branch happens to be last. */
type CancelOutcome = Awaited<ReturnType<FacilityImportRunStore['requestCancel']>>;

/**
 * What this command reports, and with what exit code, for each of the store's four answers.
 *
 * ⛔ NO TWO ENTRIES MAY SHARE A MESSAGE — nor a `--json` payload — and that is the entire reason
 * this command exists rather than a `--cancel` flag that prints "ok". `requestCancel` answers a
 * genuinely DIFFERENT question depending on whether anything is listening (see its doc comment in
 * facility-import-run-store.ts):
 *
 *   `cancelled` — the run was in a state NO worker claims, so the cancel was CARRIED OUT by the
 *     store itself: the run is terminal and its register is free. Saying "cancelled" is a fact.
 *   `requested` — a worker holds the run (`validating`/`applying`). The flag is read at phase
 *     boundaries and CANNOT interrupt the running transaction, so an apply already inside its write
 *     will finish and the run will end `applied`. Reporting this as "cancelled" would tell an
 *     operator a national register had not been rewritten when it had.
 *
 * ⛔ The EXIT CODE does not carry that distinction — the message and the `--json` `outcome` do.
 * These codes mirror the HTTP route's (apps/server/src/facilities-routes.ts) status split exactly,
 * which is what "CLI parity" means here: 200 `cancelled` and 202 `requested` are both 2xx
 * SUCCESSES, so both exit 0; 404 and 409 are both refusals, so both exit 1. A non-zero `requested`
 * broke that parity in the direction that hurts most, because `requested` is the COMMON case — you
 * cancel things that are running — so `openldr facilities import-run-cancel $ID || echo failed`
 * reported failure on the normal accepted path, `set -e` scripts aborted on it, and 2 additionally
 * collides with the widespread GNU/bash "usage error" convention.
 *
 * ⚠ 0/1 is also the ONLY exit vocabulary this CLI speaks, measured across packages/cli/src excluding
 * tests: 193 literal numeric returns, 101 `return 0;` and 92 `return 1;`, with no other numeric
 * literal returned or assigned to `process.exitCode` anywhere. And `1` there is NOT exclusively
 * "an unexpected failure from a catch" — of the 14 `return 1;` sites in THIS file, 9 report an
 * unexpected error out of a catch and 5 report a NAMED business refusal: `runFacilitiesImport`'s
 * unknown-columns and `blocked` branches, its `startPreview` branch (lexically a catch, but it
 * translates one known condition — the register is already claimed — into `facilities import
 * refused: …`), `runFacilitiesImportRun`'s missing-run branch, and `runFacilitiesJobs`'s `--retry`
 * refusal. `not-found` answering 1 below is what makes this command AGREE with
 * `runFacilitiesImportRun`, which returns 1 for the identical `no such facility import run: <id>`
 * string, and with `facilities jobs --retry`'s `no such job`.
 */
const CANCEL_OUTCOMES: Record<CancelOutcome, {
  exitCode: number;
  /** Did the cancel reach a run at all? Drives BOTH the audit and stdout-vs-stderr — the two false
   *  entries are refusals, and a refusal has nothing to record and does not belong on stdout. */
  live: boolean;
  message: (id: string) => string;
}> = {
  cancelled: {
    exitCode: 0,
    live: true,
    message: (id) =>
      `import run ${id} cancelled: no worker was holding it, so the cancellation was carried out — the run is finished and its national register is free.`,
  },
  requested: {
    // ⛔ 0, matching the route's 202 — the request WAS accepted, and that is what an exit code
    // reports. The honesty property does not live here: the run may still finish `applied`, and the
    // message below plus the `--json` `outcome` are what say so. A script that needs to know whether
    // the run actually stopped reads `outcome`, or follows up with `import-run <id>`; it must never
    // infer it from a non-zero exit, which in this CLI means "the command did not do its job".
    exitCode: 0,
    live: true,
    message: (id) =>
      `cancellation requested for import run ${id}: a worker is holding it, so the request is only observed at the next phase boundary — a write already in progress will finish, and the run may still end applied. Check with: openldr facilities import-run ${id}`,
  },
  'not-found': {
    // The route's 404. Same code AND same string as `runFacilitiesImportRun`'s own missing-run
    // branch above — one command group must not answer one condition two different ways.
    exitCode: 1,
    live: false,
    message: (id) => `no such facility import run: ${id}`,
  },
  'already-terminal': {
    // The route's 409. Distinguished from `not-found` by its message and its `--json` error, not by
    // its code — same as the route, where both are 4xx refusals.
    exitCode: 1,
    live: false,
    message: (id) => `import run ${id} has already finished and cannot be cancelled`,
  },
};

export interface FacilitiesImportRunCancelOpts {
  json: boolean;
}

/**
 * `openldr facilities import-run-cancel <id> [--json]`
 *
 * CLI parity for `POST /api/facilities/import/runs/:id/cancel`. See `CANCEL_OUTCOMES` above for the
 * four answers and why none of them may be folded into another.
 *
 * ⛔ SPELLED AS A SIBLING of `import-run <id>`, not as an `import-run cancel <id>` subcommand, and
 * that is a MEASURED constraint rather than a preference: commander parses a parent command's
 * declared options before dispatching to a subcommand, and `import-run` declares `--json`, so under
 * the nested spelling `facilities import-run cancel <id> --json` has its `--json` swallowed by the
 * parent and this function is handed `json: false`. The nested form works only with
 * `.enablePositionalOptions()` applied to the whole program, which would change how every other
 * `openldr` command group parses its options — far outside what a cancel command should cost.
 * `facilities-import-cli-parsing.test.ts` pins the working spelling.
 *
 * ⛔ This does NOT touch `facilities import`, which stays synchronous and direct: it is automation,
 * and routing it through the worker queue would cost it the exit code that is the whole point of
 * running an import from a script.
 */
export async function runFacilitiesImportRunCancel(
  id: string, opts: FacilitiesImportRunCancelOpts,
): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const importRuns = createFacilityImportRunStore(ctx.internalDb);
    const outcome = await importRuns.requestCancel(id);
    const reported = CANCEL_OUTCOMES[outcome];

    // Audited on both LIVE outcomes and recording which one, matching the route: an operator asking
    // a national register's import to stop is a decision worth an actor even when the import goes on
    // to finish anyway. The two refusals changed nothing, so there is nothing to record.
    if (reported.live) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'facility.import.cancelled',
        entityType: 'facility',
        entityId: id,
        before: null,
        after: null,
        metadata: { runId: id, outcome },
      });
    }

    if (opts.json) {
      // The outcome itself is on the wire verbatim, so a script never has to parse the English
      // above to tell "stopped" from "asked to stop".
      process.stdout.write(JSON.stringify(
        reported.live ? { runId: id, outcome } : { error: reported.message(id) },
      ) + '\n');
    } else if (reported.live) {
      process.stdout.write(reported.message(id) + '\n');
    } else {
      process.stderr.write(`facilities import-run-cancel refused: ${reported.message(id)}\n`);
    }
    return reported.exitCode;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities import-run-cancel failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
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
      // ⛔ The outcome is READ, not assumed. `retry` is a no-op for an unknown id and REFUSES a job
      // that is currently running (see facility-job-store.ts) — both of which used to leave this
      // command printing health and exiting 0, telling an operator their retry was accepted when
      // nothing was re-queued. The HTTP route answers 404/409 for these two; this is their exit-code
      // equivalent, since a CLI has no status line to carry them.
      const outcome = await ctx.facilityJobs.retry(opts.retry);
      if (outcome !== 'requeued') {
        const why = outcome === 'running'
          ? `job ${opts.retry} is already running; wait for it to finish before retrying it`
          : `no such job: ${opts.retry}`;
        if (opts.json) process.stdout.write(JSON.stringify({ error: why }) + '\n');
        else process.stderr.write(`facilities jobs --retry refused: ${why}\n`);
        return 1;
      }
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

/** ⛔ Every retryable job id this payload carries is PRINTED, because `--retry <id>` is useless
 *  without one. Both halves used to be unreachable from a plain shell: the dimension's `jobId` was
 *  in the payload but never rendered (an operator had to re-run with `--json` to find it), and the
 *  projection side reported only a count, so the failed projections had no id ANYWHERE — not here,
 *  not in `--json`, not on the Facilities page. */
function formatJobsHuman(health: FacilityHealth): string {
  const { reportDimension: dim, projection } = health;
  const lines = [`report dimension: ${dim.state}`];
  lines.push(`last successful rebuild: ${dim.lastSuccessAt ?? 'never'}${dim.rows != null ? ` (${dim.rows} rows)` : ''}`);
  if (dim.error) lines.push(`last error: ${dim.error}`);
  if (dim.jobId) lines.push(`retry with: openldr facilities jobs --retry ${dim.jobId}`);
  lines.push(`failed projection retries: ${projection.failedCount}`);
  for (const job of projection.failed) {
    lines.push(`  facility ${job.registryId ?? '(unnamed)'}: ${job.lastError ?? 'no error recorded'}`);
    lines.push(`    retry with: openldr facilities jobs --retry ${job.id}`);
  }
  return lines.join('\n');
}
