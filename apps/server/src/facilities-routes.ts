import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { appError } from '@openldr/core';
import type { FacilityColumnMap } from '@openldr/terminology';
// The SAME id derivation the CSV importer uses. Imported rather than re-implemented: two spellings
// of `fac-` + sha256(`system|code`) is exactly how the manual and import doors drifted apart.
import { idFor } from '@openldr/terminology';
// The SAME required-field check `forms-routes.ts` already runs on a form submission — see
// `requiredFieldsError` below for how this route scopes it.
import { validateAnswers } from '@openldr/forms';
import {
  importFacilities, resolveKnownNationalSystem, CONTROLLED_FIELDS, CONTROLLED_VALUE_SETS,
  resolveControlledFields, suggestColumns, suggestValues, saveFacilityValueMappings,
  scanObservedFacilities, resolveObservedFacilities, publishFacilityMap, projectRegistryRows,
  retireRegistryConcepts, reprojectAfterRegistryDelete, listFacilityMappingConflicts, facilityHealth,
  type AppContext, type FacilityImportResult, type ScanResult, type PublishResult, type ControlledField,
  type ValueMappingEntry,
} from '@openldr/bootstrap';
import {
  splitFacilityAnswers, CORE_FACILITY_KEYS, FACILITY_ADMIN_LEVELS, referenceCapture,
  FACILITY_REGISTRY_SYSTEM, DEFAULT_LIST_LIMIT, FACILITY_HEALTH_VALUES, createFacilityImportRunStore,
  createFacilityRegisterSourceStore, resolveFacilityRegisterForImport,
  SUPERSEDABLE_RUN_STATES, RUNNING_RUN_STATES, TERMINAL_RUN_STATES, isApplicable, APPLY_PHASE,
} from '@openldr/db';
import type {
  FacilityAdminLevel, ExternalSchema, FacilityHealth, FacilityImportRun, FacilityImportRunStatus,
  FacilityRecord,
} from '@openldr/db';
import { requireCapability } from './rbac';
import { recordAudit, actorFromRequest } from './audit-helper';

const VIEW = { preHandler: requireCapability('facilities.view') };
const MANAGE = { preHandler: requireCapability('facilities.manage') };

// ── Task 4: CSV import ──────────────────────────────────────────────────────────────────────────
//
// A JSON-encoded CSV body large enough to comfortably cover the stated workload (a 14 000-row
// national register, see facility-import.ts's docblock) — 8MB is roughly 3x a generous
// bytes/row estimate at that row count — while still catching a config mistake or a client that
// ignores this cap outright before Node fully buffers it. The check runs at the JS level (not left
// to Fastify's own bodyLimit) so an oversized upload gets the SAME uniform `{ error }` 400 shape as
// every other validation failure in this file, rather than Fastify's own 413.
const MAX_IMPORT_CSV_BYTES = 8 * 1024 * 1024;
// Fastify's `bodyLimit` route option is a backstop ABOVE the CSV cap, not the primary guard: it
// exists so a request that ignores MAX_IMPORT_CSV_BYTES entirely (or one inflated by JSON
// escaping/other fields) is rejected before Node buffers the whole thing into memory. Deliberately
// higher than MAX_IMPORT_CSV_BYTES so a csv field right at that limit still reaches the JS-level
// check above and gets the clearer 400 — Fastify's own body-too-large error is a 413, which would
// otherwise win the race and pre-empt the check below.
const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_CSV_BYTES + 2 * 1024 * 1024;
// Same gate as MANAGE (facilities.manage) — importing is a write — with the higher bodyLimit layered on.
const IMPORT = { ...MANAGE, bodyLimit: MAX_IMPORT_REQUEST_BYTES };

// This comment used to justify the cap by the per-row SELECT + conditional INSERT into
// reference_change_log that `capture.record()` ran for every already-existing row (measured in
// tens of seconds at full national-register scale). That cost is GONE: facilities-phase-0 Task 1
// suspended facility_registry's reference-sync capture (see SUSPENDED_REFERENCE_ENTITY_TYPES in
// reference-change-log.ts), and facility-import.ts's `importFacilities` no longer calls
// `capture.record()` at all. The facility_registry write itself is now a single batched
// `insertBatchPg` call (packages/db/batch-upsert.ts) chunked to ~2 608 rows/statement, not one
// row-per-transaction fallback — comfortably fast even at 14 000 rows.
//
// What still runs inside this request/response cycle, and still scales with row count: parsing
// the CSV (`parseFacilityCsv`, CPU-bound on file size), the transaction's existing-id lookup and
// the batched write above, and then — AFTER that transaction commits — `projectRegistryRows`
// (facility-reconcile.ts), which `importFacilities` awaits before returning. That projection
// builds one terminology concept per imported row, runs collision-detection queries whose IN-lists
// scale with the row count, and writes the result through `admin.terms.importRows` (itself
// internally batched, 1000 rows/statement). None of this holds facility_registry row locks the way
// the deleted per-row capture path did.
//
// ⚠ MEASURED 2026-08-09 on real Postgres: a cold end-to-end 13 000-row import — parse, batched
// write and 13 375 projected concepts — takes 2 689 ms. This cap is NOT protecting against a real
// request-deadline risk. It survives A2a deliberately: removing it belongs with A2b's upload,
// progress and cancel surface, and dropping it here would ship an unbounded synchronous apply that
// reports nothing while it runs. See the A2 spec's "Measured before designing".
//
// Decision: bound APPLY to a row-count cap and point the operator at the CLI
// (`openldr facilities import --apply`, packages/cli/src/facilities.ts) above it — the CLI calls the
// same `importFacilities` with the same deps (`db`/`capture`/`admin`/`facilityJobs`/`logger`, so an
// applied CLI import projects and enqueues its rebuild exactly as this route's does) and no request
// deadline. ⚠ Keep those two dep objects in step: this cap means the CLI is the ONLY path a
// register above it can be applied through, so anything this route passes and the CLI does not is
// missing precisely where the workload is largest. 2000 stays a generous bound for the common case
// (a district- or council-scoped partial register, the routine incremental update) without ever
// touching the CLI; the worst case — a full national re-import's CSV parse, batched write, and
// registry projection, all synchronous in one request — is now MEASURED comfortably fast rather
// than assumed risky, but A2b's upload/progress/cancel surface is still the right home for removing
// this cap outright, not a quiet loosening here. This is NOT a background-job system — a request
// over the cap is simply refused, nothing is queued. A dry run (no `apply`) is exempt: it never
// opens a transaction (or projects), so a 14 000-row register can always be PREVIEWED inline
// regardless of this cap.
const MAX_INLINE_APPLY_ROWS = 2000;

// ⛔ TWO IMPORT PATHS, ONE CAP — do not "unify" them.
//
//  - `POST /api/facilities/import` (INLINE, above): parses, writes and projects INSIDE the request,
//    and is bounded by `MAX_INLINE_APPLY_ROWS`. That bound stays. It carries the CLI and every
//    existing integrator, and its wire shape is pinned by this file's tests.
//  - `POST /api/facilities/import/upload` (A2b, below): streams the file to blob storage, mints a
//    `queued` run, and returns. A worker (A2b Task 4) parses and applies it later. `MAX_INLINE_APPLY
//    _ROWS` deliberately does NOT apply here — lifting it for a full national register is the entire
//    reason this path exists.
//
// ⚠ MEASURED 2026-08-09 on real Postgres (see the block above): a cold end-to-end 13 000-row import
// takes 2 689 ms, so the inline cap was never guarding a per-row COST. What it guards is a
// SYNCHRONOUS HTTP REQUEST — an operator watching a request that reports nothing while it runs, and
// a client/proxy deadline that can cut it off mid-apply. This path removes the request, not the
// work, which is why the same workload is safe here and capped there.
//
// A byte ceiling for the upload, carried in the same `{ ...MANAGE, bodyLimit }` shape as `IMPORT`
// above and as the terminology distribution upload's `UPLOAD` (`terminology-admin-routes.ts`).
//
// ⚠ MEASURED against fastify@5.8.5, because the obvious assumption is wrong and the sibling route
// shares it: `bodyLimit` does NOT bound a STREAMING content-type parser. `content-type-parser.js`'s
// `ContentTypeParser.prototype.run` only calls `rawBody` — the one place `content-length` is
// compared to the limit, and the one place a running total is compared to it — when the parser is
// `asString` or `asBuffer`. A passthrough parser (what this route registers, so `req.body` IS the
// stream) takes the other branch and is handed the payload directly, limit unconsulted. So this
// number is real only if a future change makes this route buffer its body; today the transfer is
// bounded by the `facilities.manage` gate in front of it and by the blob store behind it, not by
// this. Kept, not deleted, because it is correct-by-construction for that future change and costs
// nothing — but do NOT cite it as the reason a huge upload is safe.
//
// ⛔ THE REAL ENFORCEMENT IS THE RUNNING BYTE COUNT in the upload route's hashing transform, against
// `ctx.cfg.FACILITY_IMPORT_MAX_UPLOAD_BYTES` (413 + SY0413, blob discarded). Do not delete either of
// these believing the other one covers it: this constant binds nothing today, and the counter is not
// visible from the route's options object. This constant is the config key's DEFAULT value repeated
// (`packages/config/src/schema.ts`), so on a default install the inert backstop and the live ceiling
// are the same number; an install that overrides the env var moves only the ceiling, which is
// harmless precisely because this one binds nothing. If a future change makes this route buffer its
// body, make `bodyLimit` read the config key too rather than leaving it a stale literal.
const MAX_UPLOAD_BYTES = 1_073_741_824;
// Same capability gate as every other write in this file (`facilities.manage`).
const UPLOAD = { ...MANAGE, bodyLimit: MAX_UPLOAD_BYTES };

/** The request body arrived as a stream (an octet-stream/text-csv passthrough parser handed the raw
 *  `payload` through) rather than as a parsed JSON object, a string or a Buffer.
 *
 *  Deliberately a second copy of `terminology-admin-routes.ts`'s identical duck-type guard rather
 *  than an import: these are two independent route modules, and cross-importing one route file from
 *  another to reach a two-line predicate would couple them for no gain. `instanceof Readable` is not
 *  used for the reason that file's version does not either — what matters is that the object can be
 *  piped, and Fastify hands over whatever the content-type parser returned. */
function isReadableBody(body: unknown): body is NodeJS.ReadableStream {
  return !!body && typeof body === 'object' && typeof (body as { pipe?: unknown }).pipe === 'function';
}

/** A human-legible path segment for a `nationalSystem` such as `urn:tz:hfr`.
 *
 *  ⚠ For LEGIBILITY ONLY — it is lossy (`urn:tz:hfr` and `urn/tz/hfr` both slug to `urn-tz-hfr`),
 *  so nothing may key off it. Two registers whose slugs collide still get distinct objects because
 *  the object NAME is a fresh uuid, and the authoritative link in both directions is
 *  `facility_import_runs.blob_key`. */
function nationalSystemSlug(nationalSystem: string): string {
  const slug = nationalSystem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'register';
}

// Task 8b (facility-import-mapping wire gap): the wire shape of `FacilityColumnMap`
// (@openldr/terminology), validated for SHAPE ONLY. A semantically bad map (duplicate targets, an
// unknown target, a missing required field) is NOT re-checked here — `parseFacilityCsv`'s own
// `validateColumnMap` (reached inside `importFacilities`) already does that and reports it as
// `blockedReason: 'column-map'`; checking twice would risk the two disagreeing about what "bad"
// means. A shape failure (the wrong types) can never reach that check at all, so it has to be a 400
// here rather than a crash inside the parser.
const ColumnMapSchema = z.object({
  columns: z.record(z.string()),
  constants: z.record(z.string()).optional(),
  extras: z.array(z.string()).optional(),
});

const ImportSchema = z.object({
  // ⚠ Minor fix: blank/whitespace-only content is refused here, not left to reach
  // `parseFacilityCsv` and come back as an all-zero `{ parsed: 0, ... }` 200 — a UI that only
  // checks `res.ok` would otherwise report success for an upload that changed nothing. A single
  // `.refine` (rather than `.min(1)` alone) catches BOTH the empty string and a
  // whitespace/newline-only body (routine when a client trims a template file down to just blank
  // lines), since `''.trim()` and `'   \n  \n'.trim()` both collapse to length 0.
  csv: z.string().refine((v) => v.trim().length > 0, { message: 'csv must not be empty' }),
  // ⛔ Required, never defaulted — HFR/MFL/etc differ per country/deployment (see
  // facility-import.ts's `FacilityImportOptions.nationalSystem` doc comment). A hardcoded fallback
  // here would eventually mislabel an import as belonging to the wrong national register.
  nationalSystem: z.string().min(1),
  allowUnknownColumns: z.boolean().optional(),
  // Task 5: the explicit "I have seen the line numbers, import the rest" override for structurally
  // malformed rows (see facility-import.ts's `FacilityImportOptions.allowMalformedRows`) — the same
  // opt-in shape as `allowUnknownColumns` above. Without this key in the schema, zod's default
  // "strip unknown keys" behaviour would silently discard anything the client sent under this name.
  allowMalformedRows: z.boolean().optional(),
  // CT-3 (whole-branch review): the third member of the `allowUnknownColumns`/`allowMalformedRows`
  // override family — see `FacilityImportOptions.allowInvalidCoordinates` (facility-import.ts) for
  // why a row failing coordinate validation is otherwise dropped from `records` entirely rather than
  // imported with both coordinates null.
  allowInvalidCoordinates: z.boolean().optional(),
  // The caller opts IN to writing (mirrors the CLI's `--apply`). Omitted/false ⇒ dry run: parse
  // and report, write NOTHING — the default, so a 14 000-row register can never be silently
  // rewritten by a client that forgot to set this.
  apply: z.boolean().optional(),
  // Task 10: links this call to a run a PRIOR standalone preview created (see the handler's own
  // comment on why only an explicit round-trip earns conflict detection). Absent on the preview
  // call itself — the route mints the run then, never the caller.
  runId: z.string().min(1).optional(),
  // Which parser reads `csv` (still the field name — a JSONL release is text too). Mirrors
  // `FacilityImportOptions.format`.
  format: z.enum(['csv', 'jsonl']).optional(),
  // The file is a COMPLETE release of this register — see `FacilityImportOptions.completeRelease`.
  completeRelease: z.boolean().optional(),
  onDeleted: z.enum(['retire', 'report']).optional(),
  onAbsent: z.enum(['retire', 'report']).optional(),
  // What to do with a row `importFacilities` classifies `conflict` — see
  // `FacilityImportOptions.onConflict`'s doc comment (facility-import.ts). Default `'skip'`, the
  // design's stated default; `'overwrite'` writes the conflicting row anyway while `conflict` still
  // reports the count.
  onConflict: z.enum(['skip', 'overwrite']).optional(),
  // Recorded on the run for FAC-P1-03's "who imported which release and when"; never read by
  // `importFacilities` itself (which has no `releaseVersion` option).
  releaseVersion: z.string().optional(),
  // Task 8b: how this file's own headers map onto the 16-field contract (`FacilityColumnMap`,
  // @openldr/terminology) — see `ColumnMapSchema` above for what is (and isn't) checked here. Fed
  // into the SAME `importOpts` object the handler builds below, which both the preview and the apply
  // call read from — so the two can never see a different map, the exact bug class this sheet has
  // hit before (see `ImportFacilitiesSheet.tsx:124`'s own comment on `allowMalformedRows`).
  columnMap: ColumnMapSchema.optional(),
});

/** A2b Task 5: the operator's choices at the confirm step — the decisions the UPLOAD deliberately
 *  did not record (see the `options:` comment on the upload route's `startUpload` call: putting a
 *  made-up set there would have been a decision no operator made).
 *
 *  ⛔ Every key here is drawn from `FacilityImportOptions` and spelled the same way, because these
 *  land verbatim in `facility_import_runs.options` and the worker spreads that straight into
 *  `importFacilities`. A key renamed on one side is silently DROPPED — zod strips what it does not
 *  know — so the operator's choice would simply not take effect.
 *
 *  ⛔ `nationalSystem`, `format` and `apply` are deliberately ABSENT and must stay absent. The first
 *  two are the run's identity (a client-supplied `nationalSystem` here would import under a register
 *  this run does not hold), and `apply` is the phase, which the worker decides. The worker re-imposes
 *  all three off the run row regardless — this is the first of the two defences, not the only one.
 *
 *  ⚠ No `completeRelease`, and it must stay out: it is a claim about the FILE ("this is the whole
 *  register"), which nothing at confirm time can newly establish — `absent` is classified during the
 *  VALIDATE phase, long before this route is called, so a `completeRelease` arriving here would
 *  change nothing about the summary the operator just reviewed while silently rewriting the run's
 *  stored declaration. The UPLOAD route takes it instead (see its `completeRelease` query
 *  parameter), which is the request that actually precedes the classification. What the operator
 *  decides HERE is `onAbsent` — whether a measured absence is acted on — and that split is the
 *  two-tier retirement design, not an omission.
 *
 *  ⛔ Task 8b: no `columnMap` either, and for the same PARSE-CHANGING reason `allowUnknownColumns`/
 *  `allowInvalidCoordinates` stay off the two lines above. The map decides which rows the VALIDATE
 *  turns into records at all — a confirm carrying one, honoured here, would authorise an apply over a
 *  record set the operator never reviewed. The upload route takes it instead (its own `columnMap`
 *  query parameter), stored on `run.options` before validate ever runs, which `chosen` below can then
 *  never overwrite. */
/** B1 Task 9: `POST /api/facilities/import/sources`' body — a fresh `coding_systems` row marked as
 *  a facility register (`registerSources.create`, `@openldr/db`). `url` is the canonical identity
 *  the import routes will accept from this point on; every other field is display/provenance only.
 *  `version`/`jurisdiction`/`contact`/`publisherId` mirror `FacilityRegisterSourceStore.create`'s
 *  own optional fields exactly — both the KEY (so a rename on one side would be silently stripped
 *  by zod rather than reaching the store) and the TYPE: the store's signature accepts `string |
 *  null` for each of these, so `.nullable()` is required alongside `.optional()` here too — without
 *  it, a caller sending an explicit `null` (a legitimate way to say "no value" in JSON, distinct
 *  from omitting the key) would 400 here even though the store downstream is happy to accept it. */
const SourceCreateSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1),
  code: z.string().min(1),
  version: z.string().optional().nullable(),
  jurisdiction: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  publisherId: z.string().optional().nullable(),
});

// Task 6 (facility-import-mapping): the wizard's value panel body — one raw string -> canonical
// code decision per entry, forwarded verbatim to Task 5's `saveFacilityValueMappings`. `field` is
// restricted to CONTROLLED_FIELDS (not a free string) so a typo lands as a 400 here rather than as
// a silently-ignored `entry.field` inside that function.
const ValueMappingEntrySchema = z.object({
  field: z.enum(CONTROLLED_FIELDS),
  rawValue: z.string().min(1),
  toCode: z.string().min(1),
});

const ValueMappingsSchema = z.object({
  // ⛔ Same identity as ImportSchema's `nationalSystem` above: must resolve through
  // `resolveFacilityRegisterForImport` to a REGISTERED facility register, never a typed label —
  // see this route's own comment for why.
  nationalSystem: z.string().min(1),
  mappings: z.array(ValueMappingEntrySchema),
});

const ConfirmSchema = z.object({
  onDeleted: z.enum(['retire', 'report']).optional(),
  onAbsent: z.enum(['retire', 'report']).optional(),
  onConflict: z.enum(['skip', 'overwrite']).optional(),
  allowUnknownColumns: z.boolean().optional(),
  allowMalformedRows: z.boolean().optional(),
  allowInvalidCoordinates: z.boolean().optional(),
});

// The client submits ANSWERS, never a pre-split record: deciding which answers become indexed
// columns is the server's call, and duplicating the core-key list client-side would let the two
// drift. `id` is deliberately absent — see the POST handler.
const SubmitSchema = z.object({
  answers: z.record(z.unknown()),
  formSchemaId: z.string().nullish(),
  formVersion: z.number().nullish(),
});

type FieldRef = { id: string; apiProperty?: string | null };

/** Everything the POST/PUT guards need from the submitted `formSchemaId`: the field list (for
 *  `hasCoreField`/`splitFacilityAnswers`) and the form's `targetPages` (for `targetsFacilitiesPage`
 *  below). `targetPages` is typed `unknown` here — not `FormDefinition['targetPages']` — because
 *  `targetsFacilitiesPage` is a boundary function that normalizes it (see that function's doc
 *  comment for why: it accepts both the parsed array the real store returns and, defensively, a raw
 *  JSON string), not because `ctx.forms` itself is loosely typed. */
/*  `schema` is the WHOLE stored form, carried alongside the destructured `fields` because
 *  `validateAnswers` (@openldr/forms) takes a full `FormSchema`, not a field list — see
 *  `requiredFieldsError` below. Typed `unknown` for the same reason `targetPages` is: this is a
 *  boundary, and the one consumer casts at the call site exactly as `forms-routes.ts:321` does. */
type ResolvedForm = { fields: FieldRef[]; targetPages: unknown; schema: unknown };

/** Resolve the submitted form so `apiProperty` and `targetPages` can be read. Returns
 *  `{ fields: [], targetPages: null }` both when no form id was submitted AND when the id does not
 *  resolve — callers MUST treat an empty field list as "the form could not be resolved" and refuse
 *  to write, never as "no core fields, everything is extras" (see the empty-field-list guards in
 *  POST/PUT below). */
async function resolveForm(ctx: AppContext, formSchemaId: string | null | undefined): Promise<ResolvedForm> {
  if (!formSchemaId) return { fields: [], targetPages: null, schema: null };
  const def = await ctx.forms.get(formSchemaId);
  if (!def) return { fields: [], targetPages: null, schema: null };
  const schema = def.schema as { fields?: FieldRef[] } | undefined;
  return { fields: schema?.fields ?? [], targetPages: def.targetPages ?? null, schema: schema ?? null };
}

/**
 * Core columns the submitted answers explicitly BLANKED.
 *
 * `splitFacilityAnswers` OMITS a blanked core answer from `record` rather than nulling it — correct
 * for its own contract (see facility-answers.ts), but it means `{ ...before, ...record }` lets a
 * stale value survive untouched, and there would be no way for an operator to ever clear a field.
 *
 * A key counts as "cleared" when: a submitted field maps to that core column, the operator's
 * submission included an answer for that field's id (so this is a deliberate blank, not a field the
 * form never asked about), and the key did not survive into `record`. `latitude`/`longitude` never
 * appear here — `splitFacilityAnswers` already assigns them `null` explicitly, so they are always
 * present `in record` and this function correctly leaves them alone.
 */
function clearedCoreKeys(
  fields: FieldRef[],
  answers: Record<string, unknown>,
  record: Record<string, unknown>,
): Set<string> {
  const cleared = new Set<string>();
  for (const field of fields) {
    const key = field.apiProperty ?? '';
    if (!CORE_FACILITY_KEYS.has(key)) continue;
    if (!Object.hasOwn(answers, field.id)) continue;
    if (key in record) continue;
    cleared.add(key);
  }
  return cleared;
}

/**
 * `extras` keys the submitted form's field LIST claims ownership of — independent of whether this
 * particular submission actually supplied a value for that field. Mirrors how `clearedCoreKeys`
 * treats a core column: the FIELD determines ownership, the ANSWER only determines the value. A
 * non-core field owns `apiProperty || field.id` in `extras` — exactly the key
 * `splitFacilityAnswers` writes it under (see that function's `extras[key || field.id] = text`
 * line) — so this set and that function agree on what "form-mapped" means without re-deriving it.
 */
function mappedExtrasKeys(fields: FieldRef[]): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    const key = field.apiProperty ?? '';
    if (CORE_FACILITY_KEYS.has(key)) continue;
    keys.add(key || field.id);
  }
  return keys;
}

/**
 * Map a Postgres constraint violation an ordinary operator input can trigger onto a 4xx with an
 * operator-legible message, instead of letting a raw SQL message reach the generic 500 handler.
 * `local_code` is UNIQUE (23505 → 409, a conflict); `facility_registry_has_a_code` is a CHECK
 * requiring at least one of local/national code (23514 → 400, invalid input). Both are ALSO guarded
 * before the write in the route handlers below — this is the belt-and-suspenders fallback for
 * whatever gap the pre-write guard doesn't cover (e.g. a concurrent write). Anything else is
 * rethrown so the app's central error handler classifies it as usual.
 */
function mapFacilityDbError(err: unknown, reply: FastifyReply): { error: string } {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (code === '23505') {
    reply.code(409);
    return { error: 'a facility with that local code (or national code) already exists' };
  }
  if (code === '23514') {
    reply.code(400);
    return { error: 'a facility must have a local code or a national code' };
  }
  throw err;
}

// ⛔ Blocking fix: `parseFacilityCsv` (packages/terminology/src/facility-csv.ts, called inside
// `@openldr/bootstrap`'s `importFacilities`) hands off to `csv-parse/sync`, which THROWS
// synchronously on malformed input (an unterminated quote, a stray `"` inside a facility name, a
// `.json` file uploaded by mistake) instead of returning a result — that throw was reaching the
// central error handler unclassified and coming back as a bare 500 "Internal Server Error", with
// the actually-useful csv-parse message (which includes the line/column) discarded before it ever
// reached the operator. See `IMPORT`'s handler below for where this is used.
//
// A closed enumeration of `csv-parse@5.6.0`'s own error codes (copied from that package's
// `CsvError.js`/`api/index.js`/`api/normalize_options.js` call sites), not a shape heuristic —
// apps/server deliberately does NOT depend on `csv-parse` directly (it is
// `@openldr/terminology`'s implementation detail, reached only indirectly through
// `importFacilities`), so `instanceof CsvError` is not available here, and a bare `.code` string
// alone is not a safe enough signal: a Postgres constraint violation (`mapFacilityDbError`'s
// 23505/23514) ALSO carries a `.code` — always a 5-character SQLSTATE, never one of the
// ALL_CAPS/underscore identifiers below, but "always distinct today" is exactly the kind of thing
// worth pinning to an explicit list rather than a `.length` heuristic. Anything NOT in this set —
// a future csv-parse version's new code, or an unrelated error that happens to carry a `.code` —
// falls through unrecognised and is rethrown, reaching the central error handler as the 500 it
// actually is. That is the deliberate boundary: only a recognised parse failure becomes a 400; a
// DB failure (or anything else) must keep surfacing as a 500 / going through
// `mapFacilityDbError`, never be silently reclassified.
const CSV_PARSE_ERROR_CODES = new Set([
  'CSV_IGNORE_LAST_DELIMITERS_REQUIRES_COLUMNS', 'CSV_INVALID_ARGUMENT', 'CSV_INVALID_CLOSING_QUOTE',
  'CSV_INVALID_COLUMN_DEFINITION', 'CSV_INVALID_COLUMN_MAPPING', 'CSV_INVALID_OPTION_BOM',
  'CSV_INVALID_OPTION_CAST', 'CSV_INVALID_OPTION_CAST_DATE', 'CSV_INVALID_OPTION_COLUMNS',
  'CSV_INVALID_OPTION_COMMENT', 'CSV_INVALID_OPTION_DELIMITER', 'CSV_INVALID_OPTION_ENCODING',
  'CSV_INVALID_OPTION_GROUP_COLUMNS_BY_NAME', 'CSV_INVALID_OPTION_IGNORE_LAST_DELIMITERS',
  'CSV_INVALID_OPTION_ON_RECORD', 'CSV_INVALID_OPTION_RECORD_DELIMITER', 'CSV_MAX_RECORD_SIZE',
  'CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE', 'CSV_OPTION_COLUMNS_MISSING_NAME',
  'CSV_QUOTE_NOT_CLOSED', 'CSV_RECORD_INCONSISTENT_COLUMNS', 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH',
  'INVALID_BUFFER_STATE', 'INVALID_OPENING_QUOTE',
]);

function isCsvParseError(err: unknown): err is Error & { code: string } {
  const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && CSV_PARSE_ERROR_CODES.has(code);
}

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * `firstString(q[key])` alone reads an INHERITED property too — `q` is a plain object cast from
 * `req.query`, so a `key` that was never actually present as the query string's own property still
 * resolves via the prototype chain (`Object.prototype.toString`, or anything a polluted
 * `Object.prototype` carries) exactly as if the client had sent it. There is no live vector for
 * that today (measured) — nothing upstream of this handler writes to `Object.prototype` — but
 * reading query params should not depend on that staying true forever. `Object.hasOwn` restricts
 * the lookup to the query string's own keys, the same guarantee `Object.hasOwn(answers, field.id)`
 * already relies on elsewhere in this file (`clearedCoreKeys`, `splitFacilityAnswers`).
 *
 * ⛔ A regression test for this CANNOT be written with `app.inject()`. Measured: `fast-querystring`
 * returns a null-prototype object, so pollution is structurally unreachable whenever a query string
 * is present, and the only exposed case is a request with NO query string at all — where this
 * function correctly rejects the inherited read. `light-my-request` (what `inject` uses) copies
 * prototype properties into the query object as OWN keys, so under `inject` the fixed and unfixed
 * code produce identical output and the test proves nothing. Two such tests were written and
 * discarded for exactly that reason. Use a real socket (`app.listen` + `fetch`) or don't bother.
 * The culprit is the test harness, NOT Fastify's request pipeline — do not go looking in Fastify.
 */
function ownFirstString(q: Record<string, unknown>, key: string): string | undefined {
  return Object.hasOwn(q, key) ? firstString(q[key]) : undefined;
}

/** A boolean query parameter, read THREE-VALUED on purpose.
 *
 *  - `undefined` — the caller did not send the key at all. That is NOT the same as sending `false`,
 *    and callers must keep the two apart: an unsent key is never recorded on a run, so a decision
 *    nobody made is never stored as though they had.
 *  - `true`/`false` — the caller sent exactly `'true'` or `'false'`.
 *  - `'invalid'` — anything else, which the caller answers 400 for rather than guessing.
 *
 *  ⛔ NEVER `!!ownFirstString(q, key)`. A query string carries text only, so `completeRelease=false`
 *  would be the non-empty string `'false'` and therefore truthy — a caller explicitly declining a
 *  declaration would be recorded as making it. Built on `ownFirstString` so it inherits that
 *  function's own-property guarantee. */
function ownBoolean(q: Record<string, unknown>, key: string): boolean | undefined | 'invalid' {
  const raw = ownFirstString(q, key);
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return 'invalid';
}

/** Whether a sanitised (already-array-stripped) string is one of the four admin-area columns.
 *  This closed whitelist — not a free string — IS the column-injection guard: `level` selects a
 *  raw column name inside `ctx.facilityRegistry.distinctAdminValues`'s query, and this is the one
 *  and only place a request value is allowed to become that column name. Anything not in
 *  FACILITY_ADMIN_LEVELS (imported from `@openldr/db`, the store's own whitelist — not re-typed
 *  here, so the two cannot drift) is rejected with 400 before any query runs. */
function isFacilityAdminLevel(v: string | undefined): v is FacilityAdminLevel {
  return v !== undefined && (FACILITY_ADMIN_LEVELS as readonly string[]).includes(v);
}

/** Whether the submitted form's field list maps ANY field onto a facility column. On its own this
 *  is only a PROXY for "this is the facilities form" — a form that happens to declare a generic
 *  core key such as `name` (e.g. Users' first/last name fields do not collide, but nothing stops a
 *  future form from reusing `name`) would pass even though it has nothing to do with facilities.
 *  Kept as a second, independent check alongside `targetsFacilitiesPage` below (not dropped): a
 *  form can correctly declare `targetPages: ['facilities']` and still, through a builder bug or an
 *  unfinished draft, carry fields with no `apiProperty` wired up at all — `targetsFacilitiesPage`
 *  alone would let that through and hand `splitFacilityAnswers` a field list with nothing to
 *  split, silently building a facility (POST) or wiping `extras` (PUT) out of a form that
 *  currently persists nothing. Both checks must hold; see the doc comments at each call site for
 *  which failure mode each one alone misses. */
function hasCoreField(fields: FieldRef[]): boolean {
  return fields.some((f) => CORE_FACILITY_KEYS.has(f.apiProperty ?? ''));
}

/**
 * Whether the resolved form actually TARGETS the `facilities` page (`packages/forms/src/page-
 * targets.ts`'s `PAGE_TARGETS`), the strong signal Task 5 / migration 071 introduced: the seeded
 * Facility form now carries `targetPages: ['facilities']` on both the `target_pages` column and
 * the embedded `schema.targetPages` (kept in sync by `FormBuilderPage.tsx`'s save path — see
 * 071's file-level comment), and the `facilities` PAGE_TARGET is `available: true`. This is the
 * guard `hasCoreField` alone could not provide: `hasCoreField` only asks "does some field map onto
 * a core column", which a Patient/Users form sharing a key like `name` can satisfy by accident;
 * `targetPages` is a deliberate, page-scoped declaration an operator makes in the builder's target
 * picker, not a coincidence of field naming.
 *
 * `ctx.forms.get()` (`packages/forms/src/store.ts`'s `toDefinition`) always hands back an
 * already-parsed array (or `null`) on the top-level `targetPages` property — never the raw JSON
 * string sitting in the `target_pages` column — so the real store never takes the string branch
 * below. The branch exists as defensive normalization at this boundary: `resolveForm` passes this
 * function's `targetPages` parameter through as `unknown` (see `ResolvedForm`'s doc comment), so a
 * test double or a future store revision that instead forwards the raw column value degrades to a
 * normal array check rather than crashing or silently accepting a string that happens to contain
 * the substring "facilities".
 */
function targetsFacilitiesPage(targetPages: unknown): boolean {
  const arr = typeof targetPages === 'string' ? parseJsonArray(targetPages) : targetPages;
  return Array.isArray(arr) && arr.includes('facilities');
}

function parseJsonArray(raw: string): unknown[] | undefined {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `record.name` comes from arbitrary client JSON `answers`, so a field mapped onto `name` can
 * carry a number, object, array, etc — not just a string. `undefined` ("no value was submitted for
 * this field at all") is NOT a type error: POST treats that as "missing" and PUT keeps the
 * existing name. Anything else non-string IS a type error distinct from "missing" — the operator
 * DID supply something, so "name is required" would be misleading — and must be rejected here
 * rather than reaching the `text NOT NULL` column un-coerced. POST and PUT both call this so they
 * agree on the same input instead of drifting (POST used to report "required" for a
 * submitted-but-wrong-type name; PUT used to silently coerce it straight into the DB).
 */
function nameTypeError(name: unknown): { error: string } | undefined {
  if (name !== undefined && typeof name !== 'string') return { error: 'name must be text' };
  return undefined;
}

/**
 * Core columns whose submitted value DIFFERS from what is already stored.
 *
 * ⛔ Every PUT-side guard below keys off THIS, never off mere presence. The Edit sheet seeds every
 * field off the facility (`seedAnswers`, apps/studio/src/facilities/FacilityDialog.tsx) and posts
 * them all back on Save, so "the caller submitted it" is true of every field on every edit. That is
 * what disarmed the submitted-only scoping `controlledFieldsError` was originally written with: a
 * value the operator never touched was indistinguishable from one they had just typed.
 *
 * `undefined` means the submission carried no answer for that field at all and is never a change —
 * a deliberate BLANK arrives through `clearedCoreKeys`, not here. Empty string and null normalise
 * together so a blanked-then-restored field does not read as changed.
 *
 * ⚠ `latitude`/`longitude` are numbers here and may arrive as strings off the driver, so they can
 * read as changed when they are not. Harmless today: no caller of this function guards a numeric
 * column.
 */
/**
 * Required-field refusal, shared by POST and PUT.
 *
 * The form's `required` markers used to be enforced by the studio alone (`validate`,
 * apps/studio/src/forms-runtime/runtime.ts, which blocks submit). Nothing checked them here, so a
 * direct `PUT` carrying an empty required field returned 200 and wrote NULL.
 *
 * `changedFieldIds` is `null` on POST — a create must be complete, so every required field is
 * checked. On PUT it is the set of FIELD ids whose core column this submission changed or cleared:
 * an imported facility with a pre-existing gap stays editable, but the operator cannot blank a
 * required field. Checking the whole form on every edit would block an unrelated change on a value
 * the import never supplied — the same defect, one layer up, that `changedCoreKeys` exists for.
 *
 * ⚠ `validateAnswers` has NO visibility check, unlike the studio's own `validate`
 * (runtime.ts:33, which skips hidden fields). On a form carrying a visibility rule this route
 * therefore enforces required on a field the client never did. The shipped Facility form has no
 * visibility rules, so this is inert today and live the moment an operator adds one.
 */
function requiredFieldsError(
  formSchema: unknown, answers: Record<string, unknown>, changedFieldIds: Set<string> | null,
): { error: string } | undefined {
  // `as never` matches apps/server/src/forms-routes.ts:321, the only other caller in the codebase —
  // that route hands `validateAnswers` a stored schema the same way, without re-parsing it. One
  // convention, not two.
  const errors = validateAnswers(formSchema as never, answers as never)
    .filter((e) => e.reason === 'required')
    .filter((e) => changedFieldIds === null || changedFieldIds.has(e.fieldId));
  if (errors.length === 0) return undefined;
  return { error: `${errors.map((e) => e.label).join(', ')} ${errors.length === 1 ? 'is' : 'are'} required` };
}

function changedCoreKeys(record: Partial<FacilityRecord>, before: FacilityRecord): Set<string> {
  const norm = (v: unknown) => (v === null || v === undefined || v === '' ? null : v);
  const stored = before as unknown as Record<string, unknown>;
  const submitted = record as Record<string, unknown>;
  const changed = new Set<string>();
  for (const key of Object.keys(submitted)) {
    if (!CORE_FACILITY_KEYS.has(key)) continue;
    if (submitted[key] === undefined) continue;
    if (norm(submitted[key]) !== norm(stored[key])) changed.add(key);
  }
  return changed;
}

// ── Task 6 (B1, facility-canonical-identity): server-enforced controlled vocabulary ────────────
//
// `resolveControlledFields`/`applyControlledFields` (packages/bootstrap/src/facility-controlled-
// fields.ts) already run over every CSV-imported row via `importFacilities`, rewriting a raw source
// string to its canonical code and WARNING on anything that doesn't resolve — warning only, import
// never refuses a row over this. Manual create/edit (this route) ran no such check at all: a
// hand-typed `status` could be 'Operating' while an imported row is always a canonical FHIR
// location-status code. That disagreement between the two doors is what this closes — POST/PUT
// below reuse the SAME resolver, not a second one, but REFUSE (400) rather than warn: there is no
// "raw source string" here to preserve under `extras.__source`, only an operator's own typed input.
//
// ⛔ A controlled field passes ONLY if its submitted value is ALREADY a canonical code (present in
// the value set's own expansion) — or that field's value set is not seeded on this install at all,
// `resolveControlledFields`'s `notValidated` case, which is NOT enforced here either: refusing would
// leave an unseeded install unable to create a facility at all. A value that resolves through an
// ACTIVE `term_mappings` entry (`resolveControlledFields`'s `mapped` case) is treated the SAME as
// `unmapped` — refused, not silently rewritten. That mapping vocabulary exists to canonicalise
// strings a REGISTER supplied under its own `nationalSystem` during reconciliation; rewriting a
// hand-typed value behind the operator's back on this route would trade one surprise for another.
// An operator who wants a particular canonical value picks it directly.
//
// ⛔ Scoped to what this request CHANGED, not to what it submitted. Scoping on "submitted" was the
// original intent — an edit that touches an unrelated field must not be blocked by a value written
// before this check existed — but it never held from the studio client, which seeds every field off
// the facility and posts them all back (see `changedCoreKeys`). The effect was that an imported
// facility carrying a raw, unmapped level could not be edited AT ALL until that value was mapped,
// and mapping is optional by design: `applyControlledFields` writes an unmapped value through
// untouched (packages/bootstrap/src/facility-controlled-fields.ts). Two subsystems each behaving
// correctly, disagreeing at the seam.
//
// POST passes no `before` — there is nothing to have changed FROM, so every submitted value is
// checked, exactly as before.
async function controlledFieldsError(
  ctx: AppContext, record: Partial<FacilityRecord>, before?: FacilityRecord,
): Promise<{ error: string } | undefined> {
  const changed = before ? changedCoreKeys(record, before) : null;
  const submitted = CONTROLLED_FIELDS.filter(
    (field) => typeof record[field] === 'string' && (record[field] as string).length > 0
      && (changed === null || changed.has(field)),
  );
  if (submitted.length === 0) return undefined;

  // `nationalSystem` only decides which `term_mappings` namespace a non-canonical value is looked
  // up under (`observedFieldSystem`) — it never decides pass/fail here, since `mapped` and
  // `unmapped` are refused identically below. An absent one (the common manual-entry case) is a
  // valid, deterministic namespace of its own, not an error.
  const nationalSystem = typeof record.nationalSystem === 'string' ? record.nationalSystem : '';
  const res = await resolveControlledFields(ctx.terminology.admin, nationalSystem, [record as FacilityRecord]);

  const badField = submitted.find((field) => res.mapped[field].size > 0 || res.unmapped[field].length > 0);
  if (!badField) return undefined;

  return { error: `${badField} '${String(record[badField])}' is not a recognised canonical ${badField} value` };
}

// ── Task 6: observed-facility reconciliation ────────────────────────────────────────────────────
//
// A thin HTTP wrapper over `@openldr/bootstrap`'s scan/resolve/publish trio (Tasks 3-4), following
// the same dry-run-by-default / explicit-`apply` / audit-only-on-a-real-write shape as the CSV
// import route above.

// Task 9b: `system` (a caller-chosen DESTINATION coding system) is gone from both bodies below.
// `scanObservedFacilities`/`publishFacilityMap` now derive a coding system PER ROW from
// `diagnostic_reports.source_system` (`observedSystemForFeed`, `packages/db/src/facility-observed.ts`)
// — one call correctly covers every feed, so there is no longer a single destination to pass.
const ScanObservedSchema = z.object({
  apply: z.boolean().optional(),
});

const PublishSchema = z.object({
  apply: z.boolean().optional(),
});

/** `ReconcileDeps` for the three routes below. `ctx.store.db` is the target/warehouse handle —
 *  same cast `createAppContext` itself uses (`packages/bootstrap/src/index.ts`'s
 *  `store.db as unknown as Kysely<ExternalSchema>`) — and `ctx.terminology.admin` is the SAME
 *  `TerminologyAdminStore` the rest of this file's terminology-facing code would reach through
 *  `AppContext`, not a second store constructed here. */
function reconcileDeps(ctx: AppContext) {
  return {
    internalDb: ctx.internalDb,
    externalDb: ctx.store.db as unknown as Kysely<ExternalSchema>,
    admin: ctx.terminology.admin,
  };
}

// The national register runs 10-15k rows; an unbounded `limit` lets one request scan far past that
// for no operator benefit. Comfortably above the whole register, well below "accidentally OOM".
const MAX_LIST_LIMIT = 20000;

/** A `NaN`, non-positive, or repeated (array-valued, from `?limit=1&limit=2`) limit must never
 *  reach the store's `?? DEFAULT` — that only rescues a genuinely absent value, not a bad one — so
 *  anything that isn't a plain positive finite number is treated as "not specified" here. */
function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

/** Like `parseLimit`, but 0 is a legitimate value (the first page) — so this rejects only negative,
 *  non-finite, and non-string inputs. A repeated param arrives as an array and is not a string, so
 *  it is treated as absent, exactly as `parseLimit` treats it. Not clamped to MAX_LIST_LIMIT: an
 *  offset past the end is a legitimate empty page, not an error. */
function parseOffset(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** Same pattern as `isFacilityAdminLevel` above: the `as readonly string[]` widening cast is safe
 *  (narrowing a wider type back down via a type predicate, not asserting an unrelated one) and lets
 *  `.includes` accept an arbitrary string to test — TS does not narrow `Array<T>.includes` on its
 *  own, so the predicate function is what avoids an `as FacilityHealth` cast at the call site.
 *
 *  M3 (whole-branch review): this used to whitelist against a LOCAL `HEALTH_VALUES` array literal
 *  hand-typed alongside `FacilityHealth` — a comment there claimed the two "cannot drift apart",
 *  which was one-directional at best: the array elements were checked against the type, but nothing
 *  stopped the type growing a new member (e.g. `'retired'`) the array never learned about, and
 *  `parseHealth('retired')` would then silently return `undefined` — the route would ignore the
 *  filter and return unfiltered rows behind a 200 rather than reject the request. `FACILITY_HEALTH_
 *  VALUES` (`@openldr/db`, `facility-registry-store.ts`) is derived from a `Record<FacilityHealth,
 *  true>` completeness check instead — the same bidirectional pattern `FACILITY_ADMIN_LEVELS`
 *  already uses — so a union member added there without a matching key fails to compile, instead of
 *  silently degrading into an ignored filter here. */
function isFacilityHealth(v: string): v is FacilityHealth {
  return (FACILITY_HEALTH_VALUES as readonly string[]).includes(v);
}

function parseHealth(raw: unknown): FacilityHealth | undefined {
  return typeof raw === 'string' && isFacilityHealth(raw) ? raw : undefined;
}

export function registerFacilitiesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // Task 10: the durable record a preview persists so a later, independent apply request can be
  // linked back to the registry state that preview actually read (the conflict watermark — see the
  // import route below). Constructed once per registration, not per request: it is a thin closure
  // over `ctx.internalDb`, the same db this file already reads directly in several routes.
  const importRuns = createFacilityImportRunStore(ctx.internalDb);

  // B1 Task 3: the registers an import may name. Constructed once per registration for the same
  // reason `importRuns` above is — a thin closure over `ctx.internalDb`.
  //
  // ⛔ `ctx.__registerSources` is a TEST SEAM, never a production path. `fakeCtx()` in
  // facilities-routes.test.ts has no real database for this store to close over — its `internalDb`
  // is a narrow, allow-listed Kysely Proxy that throws on any call outside the measured set — so a
  // test exercising POST's register gate has no other way to answer `getByUrl`. Production always
  // takes the real store, since nothing outside that fixture ever sets this property.
  const registerSources = (ctx as unknown as {
    __registerSources?: ReturnType<typeof createFacilityRegisterSourceStore>;
  }).__registerSources ?? createFacilityRegisterSourceStore(ctx.internalDb);

  // ⛔ THE REFUSAL THIS SLICE EXISTS FOR — both its decision and both its messages now live in
  // `resolveFacilityRegisterForImport` (@openldr/db, facility-register-sources.ts), which carries the
  // full reasoning: the two-identities-one-namespace defect, why the lookup stays an EXACT match, and
  // why a deactivated register gets its own message. B1 Task 11 moved it there because `openldr
  // facilities import` is a THIRD door onto the same write and had no gate at all; two hand-copied
  // gates are how one door quietly loses a rule the others keep.

  // A2b Task 3: a file upload is a stream, not a JSON body, and Fastify has no built-in parser for
  // either of these content types — without them it answers 415 before the handler ever runs.
  // Passthrough (`done(null, payload)`), so `req.body` IS the raw request stream. Guarded exactly
  // like `workflows-routes.ts`'s identical registration: another route file registered on the SAME
  // Fastify instance (terminology-admin-routes.ts) already adds the octet-stream one, and a second
  // `addContentTypeParser` for a type already present throws.
  //
  // `text/csv` is registered alongside `application/octet-stream` so a client is free to label a CSV
  // upload either way. That is the whole of what a content type decides here: which parser Fastify
  // reaches for. The FORMAT is read from the QUERY STRING and validated there, so a file labelled
  // `text/csv` but declared `format=jsonl` is stored and queued as jsonl — the header is never
  // allowed to contradict the declaration.
  for (const contentType of ['application/octet-stream', 'text/csv']) {
    if (!app.hasContentTypeParser(contentType)) {
      app.addContentTypeParser(contentType, (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
    }
  }

  /** What a request that wants to MINT a run must know about whatever run currently holds this
   *  register: was the register freed for it, or must the request be refused (and why)?
   *
   *  ⛔ Shared by both minting paths — the inline preview's `startPreview` retry and the upload
   *  route's pre-transfer gate — because both must make the SAME decision, and A2a's version of this
   *  decision lived only in the preview route. A second, hand-copied gate is exactly how one path
   *  keeps a rule the other quietly loses (`status !== 'previewed'` was that bug once already; see
   *  `facility-import-run-states.ts`).
   *
   *  ⛔ The holder is found by `active_key`, NOT by "the newest run for this system". The key IS the
   *  lock (unique index, migration 080) and a terminal write releases it, so the newest run can
   *  perfectly well be a finished one over a register nothing holds — which the upload route, unlike
   *  the preview route, asks about BEFORE anything has thrown. Read straight off `ctx.internalDb`
   *  because `active_key` is not on `FacilityImportRun`; this file already reads `facility_jobs` and
   *  `term_mappings` directly for the same reason. */
  type RegisterGate = { freed: true } | { freed: false; error: string };

  const registerHeldError = (nationalSystem: string, id: string, status: FacilityImportRunStatus): string => (
    RUNNING_RUN_STATES.has(status)
      ? `an import is already in progress for "${nationalSystem}": run ${id} is ${status}`
      // Not reachable through any code path today — every writer of a terminal status nulls
      // `active_key` in the same update — but it is the honest message if one ever is, and it is a
      // different remedy from the one above (clear the stuck row, not "wait for the worker").
      : `import run ${id} is already ${status} but still holds "${nationalSystem}"`
  );

  async function takeOverRegister(nationalSystem: string, reason: string): Promise<RegisterGate> {
    const holder = await ctx.internalDb.selectFrom('facility_import_runs')
      .select(['id', 'status']).where('active_key', '=', nationalSystem).executeTakeFirst();
    if (!holder) return { freed: true };

    const status = holder.status as FacilityImportRunStatus;
    // ⛔ Only a SUPERSEDABLE run is taken over — the states where the operator walked away and
    // nothing is mid-flight. Everything else is refused: a RUNNING run has a live worker (taking it
    // over would race it), a TERMINAL one is already decided.
    if (!SUPERSEDABLE_RUN_STATES.has(status)) {
      return { freed: false, error: registerHeldError(nationalSystem, holder.id, status) };
    }

    // ⛔ COMPARE-AND-SWAP on the status just read, never an unconditional write: `queued` is both
    // supersedable and CLAIMABLE, so a worker's `claimNext` can move this run to `validating`
    // between the two statements. `false` means exactly that happened.
    if (await importRuns.supersede(holder.id, status, reason)) return { freed: true };

    // The CAS lost — so answer what actually happened rather than assuming. A run that moved to a
    // TERMINAL state released `active_key` on its way, which means the register really is free and
    // the caller may proceed; only a run that is still live is a refusal. Saying "an import is
    // already in progress" for the terminal case (as this branch used to, unconditionally) would
    // refuse a request over a register nobody holds. One re-read, no loop.
    const moved = await importRuns.get(holder.id);
    if (!moved || TERMINAL_RUN_STATES.has(moved.status)) return { freed: true };
    return { freed: false, error: registerHeldError(nationalSystem, moved.id, moved.status) };
  }

  app.get('/api/facilities', VIEW, async (req) => {
    const q = req.query as Record<string, unknown>;
    const limit = parseLimit(q.limit);
    const offset = parseOffset(q.offset) ?? 0;
    // A repeated query param (`?region=A&region=B`) arrives as an array; only a plain string is a
    // valid filter value, so anything else is treated as "not specified" rather than reaching
    // Kysely as `where(col, '=', [...])`. `ownFirstString` (not `firstString(q.region)` directly)
    // additionally keeps this reading only `q`'s OWN properties — see its doc comment.
    const { rows, total } = await ctx.facilityRegistry.list({
      q: ownFirstString(q, 'q'),
      country: ownFirstString(q, 'country'),
      zone: ownFirstString(q, 'zone'),
      region: ownFirstString(q, 'region'),
      district: ownFirstString(q, 'district'),
      council: ownFirstString(q, 'council'),
      status: ownFirstString(q, 'status'),
      level: ownFirstString(q, 'level'),
      ownership: ownFirstString(q, 'ownership'),
      nationalSystem: ownFirstString(q, 'nationalSystem'),
      source: ownFirstString(q, 'source'),
      managedOrigin: ownFirstString(q, 'managedOrigin'),
      // Task 10 (B1, facility-canonical-identity): registry MEMBERSHIP (`in_register`/`dropped`/
      // `not_registered`, migration 081) — surfaces the studio's new register-state filter.
      registerState: ownFirstString(q, 'registerState'),
      health: parseHealth(ownFirstString(q, 'health')),
      limit,
      offset,
    });
    // `limit` echoed as `DEFAULT_LIST_LIMIT` (the store's own default, @openldr/db) when the client
    // sent none — NOT `rows.length`, which is wrong on a short last page (a 12-row result with no
    // limit would echo `limit: 12`, indistinguishable from "the page size is 12"). Echoing the
    // store's actual default means a client never has to re-derive it, and it stays correct even
    // when a page happens to come back shorter than the limit that produced it.
    return { rows, total, limit: limit ?? DEFAULT_LIST_LIMIT, offset };
  });

  // Distinct, already-seen values for one of the four admin-area columns (zone/region/district/
  // council), ranked by frequency with counts — backs the `suggest` field type (Task 1) so a form
  // proposes real values (`Dodoma (142)`) instead of an unbounded free-text box or a hardcoded
  // vocabulary that doesn't exist for a country's admin geography.
  //
  // ⚠ Naming collision, deliberately not renamed to match the URL the brief specifies: the
  // `?level=` query param here means "which ADMIN COLUMN" (zone/region/district/council). It is
  // unrelated to `facility_registry.level`, the FACILITY level/type column (Hospital/Dispensary/
  // Clinic) used elsewhere in this file and in `list()`.
  //
  // ⛔ SECURITY: `level` ultimately selects a raw column name inside the store's query. It is
  // validated against FACILITY_ADMIN_LEVELS — a closed whitelist — and rejected with 400 BEFORE
  // any query runs; a value like `password` or `id` never reaches `distinctAdminValues`. The
  // store's own method signature is additionally typed to the same four-member union (see
  // facility-registry-store.ts), so even a future caller that skipped this check could not pass
  // an arbitrary string through — this is defense in depth, not the only guard.
  app.get('/api/facilities/admin-values', VIEW, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    // `firstString` matters here exactly as it does in list() below: `?level=a&level=b` arrives
    // as an array, and an array must never reach the whitelist check as if it were a scalar.
    const level = firstString(q.level);
    if (!isFacilityAdminLevel(level)) {
      reply.code(400);
      return { error: `level must be one of ${FACILITY_ADMIN_LEVELS.join(', ')}` };
    }
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    for (const col of FACILITY_ADMIN_LEVELS) {
      if (col === level) continue; // scoping a column by itself is meaningless
      // `ownFirstString`, not `firstString(q[col])` directly — see that helper's doc comment: a
      // polluted `Object.prototype.region` (say) would otherwise be read here as if the client had
      // actually sent `?region=...`, with no live vector for that today but no reason to depend on
      // it staying that way.
      const v = ownFirstString(q, col);
      if (v) scope[col] = v;
      // An absent, non-string (repeated-param array), or blank value is left OUT of `scope`
      // entirely — the store treats a missing key as "unfiltered for that level", never as
      // "match the empty string".
    }
    return ctx.facilityRegistry.distinctAdminValues(level, scope);
  });

  // Task 6: every observed facility string, resolved through its mapping, with a report-volume
  // count per row — ranked by that count, which is the entire reason this surface exists over the
  // generic `/terminology` page (an operator triages the highest-volume unmapped strings first).
  //
  // ⚠ Route ordering is NOT load-bearing, contrary to what this comment used to assert. Fastify's
  // router (find-my-way) always prefers a STATIC segment over a parametric one regardless of
  // registration order, so this route would still win over `/api/facilities/:id` below if it were
  // registered after it — measured with a standalone Fastify probe; see the same ⚠ note on
  // `/api/facilities/mapping-conflicts`. It sits above `:id` for legibility, with this file's other
  // static `/api/facilities/*` routes.
  //
  // Task 11 (whole-branch review round 2, Fix 1): `reportCount` now comes straight off
  // `ResolvedFacility` — `resolveObservedFacilities` sums it while folding raw
  // `(performer, performer_display, performer_system, source_system)` groups down to one row per
  // (resolved system, code) (see that function's doc comment). This route USED to compute its own
  // second `diagnostic_reports` aggregate, keyed on `(performer, source_system)` (2 columns), and
  // join it back onto the resolved rows by `${sourceSystem}|${sourceCode}` — a key that omitted
  // `performer_system`, the column that actually decides the fold. Two feeds sharing the SAME
  // wire-supplied `performer_system` but differing `source_system` fold into ONE `ResolvedFacility`
  // upstream, carrying only the winning representative's `sourceSystem` — so the route's own count
  // query (still split by the raw `source_system`) could never fully match it, silently dropping one
  // feed's contribution. Reading `reportCount` off the already-folded row removes that two-sided key
  // by construction: there is only one place the fold happens, and only one place the count is summed.
  app.get('/api/facilities/observed', VIEW, async () => {
    const deps = reconcileDeps(ctx);
    const resolved = await resolveObservedFacilities(deps);
    return [...resolved].sort((a, b) => b.reportCount - a.reportCount);
  });

  // Task 6: discover new/changed observed-facility strings and record them as concepts (Task 3's
  // `scanObservedFacilities`). `apply` is opt-in — omitted/false previews the counts and writes
  // nothing, mirroring the import route's dry-run-by-default contract.
  app.post('/api/facilities/scan-observed', MANAGE, async (req, reply) => {
    const p = ScanObservedSchema.safeParse(req.body ?? {});
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const result: ScanResult = await scanObservedFacilities(reconcileDeps(ctx), {
      apply: !!p.data.apply,
    });

    // A dry run writes nothing (scanObservedFacilities returns before touching the db when `apply`
    // is falsy) and must not audit. `apply: true` always performs a real write here — even a
    // discovery of zero new codes still (re)registers/re-activates every observed-facility
    // `coding_systems` row it finds — so auditing is unconditional on `apply`, not further gated on
    // a count.
    //
    // ⛔ `metadata: { result }` is what makes a Scan's REGISTRY REPROJECTION accountable, not just
    // its observed-facility discovery. A scan republishes the registry projection, which can move a
    // facility's concept code and rewrite every `term_mappings` row pointing at the old one —
    // `ScanResult.registryCodeChanges` counts exactly that, and this entry is the only durable place
    // an operator can later find it. Spreading named fields here instead of the whole result would
    // silently drop it (and the next field like it).
    if (p.data.apply) {
      await recordAudit(ctx, req, {
        action: 'facility.scan',
        entityType: 'facility',
        // Task 9b: one call now scans every feed's system at once — there is no longer a single
        // system this audit entry is "about", so the entityId names the OPERATION, not a system.
        entityId: 'facility-observed:all-feeds',
        before: null,
        after: null,
        metadata: { result },
      });
    }
    return result;
  });

  // Task 6: rebuild `facility_map` (the warehouse-side reporting dimension) from the current
  // resolution (Task 4's `publishFacilityMap`). Same dry-run-by-default contract as the scan above.
  app.post('/api/facilities/publish', MANAGE, async (req, reply) => {
    const p = PublishSchema.safeParse(req.body ?? {});
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const result: PublishResult = await publishFacilityMap(reconcileDeps(ctx), {
      apply: !!p.data.apply,
    });

    // Same reasoning as the scan route above: `apply: true` always performs a real write (the
    // delete-then-insert rebuild runs unconditionally), so auditing is unconditional on `apply`.
    if (p.data.apply) {
      await recordAudit(ctx, req, {
        action: 'facility.publish',
        entityType: 'facility',
        entityId: 'facility-observed:all-feeds',
        before: null,
        after: null,
        metadata: { result },
      });
    }
    return result;
  });

  // Task 13: the review queue for the conflicts migration 078 recorded when it closed "one active
  // SAME-AS resolution per observed facility key" at the database. Clearing the violations standing
  // in that index's way meant DEACTIVATING an operator's competing mappings (the 'duplicate' kind;
  // 'unsupported_map_type' rows were recorded but left alone). `facility_mapping_conflicts` was the
  // only record of having done so, and until this route it had no reader — the mappings simply
  // stopped driving reports with nothing anywhere to explain it.
  //
  // Gated on MANAGE, not VIEW: the queue names an operator's own mappings and exists only to drive
  // a write (settle the conflict by removing one of them). Read-only itself, so nothing to audit.
  //
  // ⚠ MEASURED, because the obvious assumption is wrong: this route shares a segment count with
  // `/api/facilities/:id` below, but registration order does NOT decide the match. Fastify's router
  // (find-my-way) always prefers a STATIC segment over a parametric one, so moving this
  // registration below `:id` leaves every one of this route's tests green (verified by doing
  // exactly that). It sits here for legibility, above `:id` with this file's other static
  // `/api/facilities/*` routes, not because the position is load-bearing. What IS real: a facility
  // whose id were literally
  // "mapping-conflicts" would be unreachable via `:id` — harmless, since `facility_registry.id` is
  // always a generated UUID or a sha256-derived digest.
  app.get('/api/facilities/mapping-conflicts', MANAGE, async () => {
    return listFacilityMappingConflicts({ internalDb: ctx.internalDb });
  });

  // Task 10 (facility durable-updates): what the Facilities chip shows — whether the report-facing
  // `facility_map` dimension has caught up with the current registry/mapping state (Task 9's
  // `facilityHealth`). Until this route existed, a failed or stuck rebuild sat in `facility_jobs`
  // with nothing under `apps/` able to read it: an operator could publish/edit a mapping and have no
  // way to tell whether reports had actually picked it up.
  //
  // Gated VIEW, not MANAGE — it is read-only, and an operator who can merely READ reports still
  // needs to know whether the dimension backing them is current.
  //
  // Static segment, same non-issue as `mapping-conflicts` above: find-my-way prefers a static
  // segment over `/api/facilities/:id` regardless of registration order (measured there), so this
  // route's position here is for legibility, not correctness.
  app.get('/api/facilities/health', VIEW, async () => {
    return facilityHealth({ internalDb: ctx.internalDb, jobs: ctx.facilityJobs });
  });

  // Task 10: the operator's manual retry for a failed facility job — `facility-map-rebuild` (the
  // whole dimension) or `registry-projection` (one facility's mapping-picker entry). RE-QUEUES only:
  // it enqueues the retry through `ctx.facilityJobs.retry`, which the polling worker
  // (`createFacilityJobWorker`, packages/bootstrap/src/facility-job-worker.ts) then drains — it does
  // NOT run the rebuild inline in this request, for the same reason POST/PUT/DELETE above never do:
  // a rebuild talks to the EXTERNAL warehouse, and an HTTP request must not be held open for it (or
  // fail because it hiccups).
  //
  // `ctx.facilityJobs.retry` — deliberately not `retryPreservingAttempts` — is the OPERATOR's action:
  // it resets `attempts` to 0 so someone who has fixed the underlying cause is not locked out by a
  // previously exhausted retry budget (see facility-job-store.ts's doc comment on the two methods).
  //
  // This handler still looks the row up itself before calling `ctx.facilityJobs.retry` — not to tell
  // "retried" from "there was nothing to retry" (the store's own return value does that now: `retry`
  // resolves `not-found`/`running`/`requeued`, see facility-job-store.ts), but because the audit entry
  // below needs the row's PRE-retry state as its `before` image, and only a read taken before the
  // write can supply that. Read straight off `ctx.internalDb` — `facility_jobs` is not exposed through
  // any store method beyond `retry`/`latest`/`listUnresolved`, and this file already reads other
  // tables (`term_mappings`, in the `impact` route above) directly off `ctx.internalDb` for the same
  // reason. `selectAll()`, not just `id` — the before image needs the row's actual pre-retry state
  // (status/attempts/lastError), not just its existence.
  //
  // Audited like every other real write in this file (create/update/delete/scan/publish/import): a
  // retry is an actor-attributable state change — it resets the attempt budget and re-queues work
  // against the external warehouse. `entityType: 'facility_job'` (not `'facility'`) because what
  // changed is the job row, not a facility_registry row; `before`/`after` are the job's own
  // before/after state, mirroring `workflow.reset`'s before/after shape in workflows-routes.ts, rather
  // than `null`/`null` the way `facility.scan`/`facility.publish` use it for a whole-dimension rebuild
  // with no single before/after row to name. Placed AFTER the write and BEFORE the response, same as
  // every sibling mutation — `recordAudit` is itself deliberately contained (record-audit.ts's
  // `safeRecord`) so this can never turn an already-applied retry into a failed response.
  app.post('/api/facilities/jobs/:id/retry', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await ctx.internalDb
      .selectFrom('facility_jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) { reply.code(404); return { error: 'not found' }; }

    // ⛔ 409, not a 200 that did nothing. `retry` REFUSES a job that is currently `running` (see
    // facility-job-store.ts): re-queueing one re-arms its `active_key` under a live run, and that
    // run's own `finish()` then writes a terminal status — silently discarding the operator's retry
    // and, before `finish` learned to release the key, leaving the identity held by a dead row so
    // every later enqueue coalesced onto it forever. The outcome is read from the store rather than
    // re-derived from `existing` above so the answer cannot be wrong by a race: the worker can claim
    // the job between that read and this call, and only the store's own guarded read sees it.
    // Nothing is audited on this path — nothing changed.
    const outcome = await ctx.facilityJobs.retry(id);
    if (outcome === 'running') {
      reply.code(409);
      return { error: 'this job is already running; wait for it to finish before retrying it' };
    }

    const after = await ctx.internalDb
      .selectFrom('facility_jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    await recordAudit(ctx, req, {
      action: 'facility.job.retry', entityType: 'facility_job', entityId: id, before: existing, after: after ?? null,
    });
    return { ok: true };
  });

  app.get('/api/facilities/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await ctx.facilityRegistry.get(id);
    if (!rec) { reply.code(404); return { error: 'not found' }; }
    return rec;
  });

  // Task 7: the delete guard's impact preview. A facility can be TARGETED by a mapping two ways —
  // see `resolveObservedFacilities`'s fixed precedence (packages/bootstrap/src/facility-reconcile.ts):
  // a registry-route mapping (`to_system = FACILITY_REGISTRY_SYSTEM AND to_code = <this id>`), or a
  // national-route mapping (`to_system = <this facility's national_system> AND to_code = <its
  // national_code>`). Both are counted here — deleting the facility does not retire either route, a
  // mapping keeps resolving right up until the row disappears, and after that Task 4's
  // `ResolvedFacility.targetMissing` is what surfaces the orphan.
  //
  // ⛔ A facility with no national code has no national-route mappings, by construction — the
  // national-route query only runs when BOTH `nationalSystem` and `nationalCode` are present. It
  // deliberately does NOT fall through to `.where('to_code', '=', facility.nationalCode)` with a null
  // value: `to_code` is NOT NULL on `term_mappings`, so that comparison can never match a real row
  // today, but a future caller "simplifying" this into `facility.nationalCode ?? ''` (or any other
  // sentinel) would start matching a pathological empty-string mapping that belongs to nobody. Skip
  // the query outright rather than leave that door open.
  //
  // `reportCount` sums the LIVE `diagnostic_reports` aggregate (same table/approach as
  // `GET /api/facilities/observed` above) for the observed codes these mappings come from — NOT the
  // scan's stored snapshot, for the same freshness reason documented on that route. Unlike that
  // route's per-`(sourceSystem, sourceCode)` key, a `term_mappings` row carries no `source_system` of
  // its own (`from_code` alone identifies the observed string), so counts here are summed across
  // every source system reporting that code rather than kept split by feed.
  app.get('/api/facilities/:id/impact', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const facility = await ctx.facilityRegistry.get(id);
    if (!facility) { reply.code(404); return { error: 'not found' }; }

    const deps = reconcileDeps(ctx);

    const registryMappings = await deps.internalDb
      .selectFrom('term_mappings')
      .select(['from_code'])
      .where('to_system', '=', FACILITY_REGISTRY_SYSTEM)
      .where('to_code', '=', id)
      .where('is_active', '=', true)
      .execute();

    const nationalMappings = (facility.nationalSystem != null && facility.nationalCode != null)
      ? await deps.internalDb
          .selectFrom('term_mappings')
          .select(['from_code'])
          .where('to_system', '=', facility.nationalSystem)
          .where('to_code', '=', facility.nationalCode)
          .where('is_active', '=', true)
          .execute()
      : [];

    const mappingCount = registryMappings.length + nationalMappings.length;

    const observedCodes = [...new Set([...registryMappings, ...nationalMappings].map((m) => m.from_code))];
    let reportCount = 0;
    if (observedCodes.length > 0) {
      const counts = await deps.externalDb
        .selectFrom('diagnostic_reports')
        .select(({ fn }) => ['performer', fn.countAll<number>().as('n')])
        .where('performer', 'in', observedCodes)
        .groupBy('performer')
        .execute();
      reportCount = counts.reduce((sum, c) => sum + Number(c.n), 0);
    }

    return { mappingCount, reportCount };
  });

  // Task 8 (B1, facility-canonical-identity): a facility's change history, read straight off
  // `audit_events` — no new table, no second capture path. POST/PUT below already write real
  // before/after here (`action: 'facility.create'`/`'facility.update'`, `entityType: 'facility'`,
  // `entityId` the facility's own id), and Task 7's per-row import audit
  // (`facility.import.row`, packages/bootstrap/src/facility-import.ts) writes the same shape for an
  // imported change. This route only reads that back; it captures nothing itself.
  //
  // ⛔ No 404 for an unknown id — deliberately, unlike `GET /api/facilities/:id` above. A deleted
  // facility's history is still meaningful (it is how an operator learns a facility once existed
  // and what happened to it), so an id `facilityRegistry` no longer resolves — or never did — comes
  // back `{ rows: [] }`, the same shape a real facility with no audit rows yet would get.
  //
  // ⛔ `.orderBy('occurred_at', 'desc').orderBy('id', 'desc')` — NOT `occurred_at` alone.
  // `occurred_at` is `now()` at insert time (migration 005), and two rows for the same facility
  // written within the same millisecond are routine (e.g. a create immediately followed by a
  // projection retry, or two of Task 7's per-row import events in one batch) — pg-mem's real
  // millisecond wall-clock `now()` collides on roughly half of consecutive calls, so an
  // `occurred_at`-only order is not reliably "newest first". `id` (a `randomUUID()` — generated
  // inside `AuditStore.record()`, packages/audit/src/store.ts, not by either of its callers here
  // — audit-helper.ts's `recordAudit` and facility-import.ts's per-row audit both just call it)
  // carries no ordering of its own, but it IS unique, so ordering
  // by it as a second key makes ties resolve the same way every time instead of however the scan
  // happened to visit them.
  app.get('/api/facilities/:id/history', VIEW, async (req) => {
    const { id } = req.params as { id: string };
    const rows = await ctx.internalDb
      .selectFrom('audit_events')
      .select(['occurred_at', 'actor_name', 'action', 'before', 'after'])
      .where('entity_type', '=', 'facility')
      .where('entity_id', '=', id)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return {
      rows: rows.map((r) => ({
        occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
        actorName: r.actor_name,
        action: r.action,
        before: r.before ?? null,
        after: r.after ?? null,
      })),
    };
  });

  app.post('/api/facilities', MANAGE, async (req, reply) => {
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const { fields, targetPages, schema: formSchema } = await resolveForm(ctx, p.data.formSchemaId);
    // An empty field list means the submitted form could not be resolved — NOT "every field is
    // extras". Refuse the write rather than silently persisting nothing but a bare id.
    if (fields.length === 0) { reply.code(400); return { error: 'the submitted form could not be resolved' }; }
    // The resolved form must actually declare itself the facilities form (see
    // targetsFacilitiesPage's doc comment) — refuse a resolvable-but-unrelated form before it ever
    // reaches splitFacilityAnswers.
    if (!targetsFacilitiesPage(targetPages)) {
      reply.code(400);
      return { error: 'the submitted form does not target the facility registry (targetPages must include "facilities")' };
    }
    // A form that targets facilities but maps NONE of its fields onto a facility column is not
    // usable either (see hasCoreField's doc comment) — refuse it rather than building a "facility"
    // out of a field list with nothing wired to a core column.
    if (!hasCoreField(fields)) { reply.code(400); return { error: 'the submitted form has no facility fields' }; }

    const { record, extras } = splitFacilityAnswers(fields, p.data.answers);

    const nameErr = nameTypeError(record.name);
    if (nameErr) { reply.code(400); return nameErr; }
    const name = typeof record.name === 'string' ? record.name : '';
    if (!name) { reply.code(400); return { error: 'name is required' }; }

    if (record.localCode == null && record.nationalCode == null) {
      reply.code(400);
      return { error: 'a facility must have a local code or a national code' };
    }

    // A create must be COMPLETE — every required field, not just the ones this submission moved.
    // There is no `before` to inherit a value from.
    const requiredErr = requiredFieldsError(formSchema, p.data.answers, null);
    if (requiredErr) { reply.code(400); return requiredErr; }

    // Task 6 (B1): reject a non-canonical level/status/country BEFORE the write — see
    // `controlledFieldsError`'s doc comment for why this refuses rather than warns, unlike import.
    const controlledErr = await controlledFieldsError(ctx, record);
    if (controlledErr) { reply.code(400); return controlledErr; }

    // ⛔ The id is SERVER-derived, never client-chosen — that part is unchanged, and is why a
    // client-supplied `id` is still ignored here.
    //
    // When this facility names a register AND a code within it, the id comes from the SAME function
    // the CSV importer uses (`idFor`, packages/terminology/src/facility-csv.ts). Otherwise the same
    // facility exists twice — once hand-entered under a random id, once imported under the derived
    // one — and no later import can ever reconcile them. Migration 082's `planMoves` already
    // re-keyed the manual rows that predate this and states the rule in full; this is that rule
    // applied at the door, instead of once, by a migration that will never run again.
    //
    // No national code means nothing to hash, so the random id stands — the same case 082 leaves
    // alone rather than inventing an identity for.
    // `facilitySystem`/`facilityCode` are authoritative (migration 086); the deprecated pair is the
    // fallback while the seeded form still carries it. A later stage drops the fallback with the
    // columns.
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const nationalSystem = str(record.facilitySystem) || str(record.nationalSystem);
    const nationalCode = str(record.facilityCode) || str(record.nationalCode);
    // Annotated `string`, not inferred: `randomUUID()` returns the narrow
    // `${string}-${string}-...` template-literal type, which `idFor`'s plain string cannot be
    // assigned to.
    let id: string = randomUUID();
    if (nationalSystem && nationalCode) {
      // The same gate every import door already applies, for the same reason: `idFor` hashes this
      // string into a PERMANENT identity without normalising it, so a typed label ('HFR' vs 'hfr')
      // mints two identities for one register. See `resolveFacilityRegisterForImport` (@openldr/db)
      // for the full defect. Doors that disagree about what a register is put the fork straight back.
      const register = await resolveFacilityRegisterForImport(registerSources, nationalSystem);
      if (!register.ok) { reply.code(400); return { error: register.error }; }
      id = idFor(nationalSystem, nationalCode);
      // ⛔ `facilityRegistry.upsert` is `onConflict('id').doUpdateSet(...)`
      // (packages/db/src/facility-registry-store.ts). That was harmless while every created id was
      // random. With a DERIVED id it is not: a create landing on an existing row would silently
      // OVERWRITE it — most likely an imported facility — with no error and no record of what was
      // lost. A create must never do that, so the collision is refused before the write.
      //
      // This is a check-then-write, so it is not a substitute for the database's own guarantee: the
      // partial unique index on (national_system, national_code) (migration 070) is what actually
      // closes the race, and `mapFacilityDbError` turns its 23505 into the same 409 below.
      if (await ctx.facilityRegistry.get(id)) {
        reply.code(409);
        return { error: 'a facility with that national code already exists in this register' };
      }
    }

    // Only the write itself is guarded — an error from `recordAudit` below must never be mapped
    // as if it came from `upsert` (e.g. a 23505 from the audit table mis-reported to the client as
    // "a facility with that local code already exists" after the facility row already committed).
    let created;
    try {
      created = await ctx.facilityRegistry.upsert({
        ...record,
        id,
        name,
        extras,
        // Lab-authored: managedOrigin stays NULL. Only the sync applier stamps 'central'.
        source: 'manual',
      } as never);
    } catch (err) {
      return mapFacilityDbError(err, reply);
    }

    // Fix 1 (mapping-ux report): the facility must be a usable mapping target the MOMENT it is
    // created — no separate operator publish step. `projectRegistryRows` never throws (see its doc
    // comment), so this cannot turn a successful create into a failed response.
    //
    // Task 7: it never throws, so a failure cannot be caught here — it is REPORTED instead, as the
    // boolean this call returns (`true` = the projection completed, `false` = its internal catch
    // fired). That boolean answers "did THIS call's projection land", which is the only question the
    // response field below is entitled to answer. See the matching comment in PUT for why the
    // durable `facility_concept_projection` link cannot answer it.
    const projected = await projectRegistryRows(
      { internalDb: ctx.internalDb, admin: ctx.terminology.admin }, [{ id: created.id, name: created.name }],
    );

    // A failed projection leaves the facility in the registry but silently missing from the mapping
    // picker, with nothing recording why. Make it durable and say so in the response.
    let projection: 'ok' | 'queued-for-retry' = 'ok';
    if (!projected) {
      projection = 'queued-for-retry';
      // Same containment as the facility-map-rebuild enqueue below: a lost enqueue must not turn an
      // already-committed create into a 500, but is worth a log line — it is the only remaining
      // record that this facility needs a manual repair. Coalesces per facility (facility-job-
      // store.ts's `activeKeyFor`), so a facility that keeps failing to project does not pile up
      // duplicate retry jobs.
      try {
        await ctx.facilityJobs.enqueue({
          kind: 'registry-projection', registryId: created.id, requestedBy: actorFromRequest(req).actorId,
        });
      } catch (err) {
        ctx.logger.error(
          { err, facilityId: created.id },
          'failed to enqueue a registry-projection retry after a failed facility projection',
        );
      }
    }

    // Task 5: the report-facing dimension is now stale. Enqueue rather than rebuild inline: a
    // rebuild talks to the EXTERNAL warehouse, and an operator's facility save must not fail because
    // that warehouse hiccuped. Coalescing (facility-job-store.ts's `activeKeyFor`) means a bulk
    // import enqueues one job, not one per row — this route never needs to de-duplicate on its own.
    //
    // Wrapped, and this sits before `recordAudit` — `recordAudit` is itself deliberately contained
    // (see record-audit.ts's `safeRecord`) so auditing can never fail a mutation, and leaving this
    // call unwrapped would defeat that: an enqueue throw would both 500 an already-committed create
    // and skip the audit write below it. Logged rather than swallowed silently, since a lost enqueue
    // means a permanently stale dimension until something else notices.
    try {
      await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
    } catch (err) {
      ctx.logger.error({ err, facilityId: created.id }, 'failed to enqueue a facility-map-rebuild job after creating a facility');
    }

    await recordAudit(ctx, req, { action: 'facility.create', entityType: 'facility', entityId: created.id, before: null, after: created });
    reply.code(201);
    return { ...created, projection };
  });

  app.put('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }

    const { fields, targetPages, schema: formSchema } = await resolveForm(ctx, p.data.formSchemaId);
    if (fields.length === 0) { reply.code(400); return { error: 'the submitted form could not be resolved' }; }
    // Same wrong-form guard as POST (see targetsFacilitiesPage's doc comment) — without it a
    // resolvable but unrelated form (a Patient form's formSchemaId, say) sails past the check
    // above and silently replaces `extras` with that other form's answers behind a 200.
    if (!targetsFacilitiesPage(targetPages)) {
      reply.code(400);
      return { error: 'the submitted form does not target the facility registry (targetPages must include "facilities")' };
    }
    if (!hasCoreField(fields)) { reply.code(400); return { error: 'the submitted form has no facility fields' }; }

    const { record, extras } = splitFacilityAnswers(fields, p.data.answers);
    const cleared = clearedCoreKeys(fields, p.data.answers, record as Record<string, unknown>);

    // Preserve `extras` keys the submitted form's field list does NOT map (e.g. columns the CSV
    // importer wrote under raw header names that no form field maps) — `extras` above is only
    // authoritative for the keys the form DOES map (see mappedExtrasKeys' doc comment). Wholesale
    // `{ ...before.extras, ...extras }` is deliberately NOT used: that would make it impossible for
    // an operator to ever clear a form-mapped extra, since the stale `before` value would always
    // survive a blank. Instead, form-mapped keys are dropped from `before.extras` unconditionally
    // (including when this submission left the field unanswered, e.g. `answers: {}`) and replaced
    // by whatever `extras` says — which correctly omits a key the operator just blanked.
    const mappedExtras = mappedExtrasKeys(fields);
    const mergedExtras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(before.extras ?? {})) {
      if (!mappedExtras.has(key)) mergedExtras[key] = value;
    }
    Object.assign(mergedExtras, extras);

    // `name` is NOT NULL — a blanked name can never become a null write, only a 400.
    if (cleared.has('name')) { reply.code(400); return { error: 'name is required' }; }
    const nameErr = nameTypeError(record.name);
    if (nameErr) { reply.code(400); return nameErr; }

    const nulls: Record<string, null> = {};
    for (const key of cleared) nulls[key] = null;

    // `facility_registry_has_a_code`: at least one of local/national code must survive the clear.
    const effectiveLocalCode = cleared.has('localCode') ? null : (record.localCode ?? before.localCode);
    const effectiveNationalCode = cleared.has('nationalCode') ? null : (record.nationalCode ?? before.nationalCode);
    if (effectiveLocalCode == null && effectiveNationalCode == null) {
      reply.code(400);
      return { error: 'a facility must have a local code or a national code' };
    }

    // The refusal that used to live here — "a facility's national code cannot be changed" — is GONE,
    // and its removal is the point of this stage rather than a relaxation.
    //
    // It existed because the importer matched rows by id alone, so moving a code left the row filed
    // under an id its own code no longer produced and the next import could not find it. The importer
    // now resolves by `(facility_system, facility_code)` first (`resolveIdsByPair`,
    // packages/bootstrap/src/facility-import.ts), so a changed code reconciles on the next import
    // without anything being re-keyed. The operator can correct a facility that was registered under
    // the wrong code, and adopt one into a register it turns out to belong to — which is what they
    // tried to do the first time they used the form.
    //
    // `changedCoreKeys` is still computed: the required-field check below is scoped by it.
    const identityChanged = changedCoreKeys(record, before);

    // The register gate, scoped to a CHANGE. Dropping the immutability refusal above must not also
    // drop this: `idFor` hashes a system string without normalising it, so a typed label ('HFR' vs
    // 'hfr') mints a second permanent identity for one register — the defect migration 082 had to
    // clean up. Every other door already applies this gate; PUT is now a door.
    //
    // Scoped to a change, not to presence, for the reason the whole arc turns on: the Edit sheet
    // resubmits every field it seeded, so gating on presence would refuse an unrelated edit to any
    // facility whose system predates the register registry.
    for (const key of ['facilitySystem', 'nationalSystem'] as const) {
      const submittedSystem = record[key];
      if (!identityChanged.has(key) || typeof submittedSystem !== 'string' || submittedSystem === '') continue;
      const register = await resolveFacilityRegisterForImport(registerSources, submittedSystem);
      if (!register.ok) { reply.code(400); return { error: register.error }; }
    }

    // Required is enforced only for what this submission MOVED. `identityChanged`/`cleared` are
    // keyed on COLUMN names while `validateAnswers` reports FIELD ids, so map through the submitted
    // form's own field list rather than assuming the two are spelled the same.
    //
    // The effect: an imported facility whose register never supplied, say, a district stays
    // editable — the operator can still fix its name — but blanking a required field is refused.
    // Enforcing the whole form here instead would make every row with a pre-existing gap
    // permanently uneditable, which is the trap this whole slice exists to avoid.
    const changedFieldIds = new Set(
      fields
        .filter((f) => {
          const key = f.apiProperty ?? '';
          return identityChanged.has(key) || cleared.has(key);
        })
        .map((f) => f.id),
    );
    const requiredErr = requiredFieldsError(formSchema, p.data.answers, changedFieldIds);
    if (requiredErr) { reply.code(400); return requiredErr; }

    // Task 6 (B1), rescoped: only a level/status/country this submission actually CHANGED is
    // checked. The sheet resubmits every field it seeded, so scoping on "submitted" checked every
    // value on every edit — which made an imported facility carrying an unmapped raw value
    // uneditable until that value was mapped. See `controlledFieldsError`'s doc comment.
    const controlledErr = await controlledFieldsError(ctx, record, before);
    if (controlledErr) { reply.code(400); return controlledErr; }

    // Only the write itself is guarded — see the matching comment in POST.
    let after;
    try {
      after = await ctx.facilityRegistry.upsert({
        ...before, ...record, ...nulls, id, name: record.name ?? before.name, extras: mergedExtras,
        // An edit never changes who manages the row.
        managedOrigin: before.managedOrigin, source: before.source,
      } as never);
    } catch (err) {
      return mapFacilityDbError(err, reply);
    }

    // Same immediate-mapping requirement as POST above — a renamed facility's projected concept
    // must track the new name, not just a create-time snapshot.
    //
    // Task 7: the returned boolean, and NOT a lookup of `facility_concept_projection`, is what the
    // response field below is derived from. The link table records whether this facility has EVER
    // projected, not whether this call did — so on the commonest PUT there is (renaming a facility
    // that already projected at create time) a failed rename still finds the create's link and would
    // be reported as 'ok', with the concept left on its old display name and no retry job to repair
    // it. `concept_code` does not discriminate either: a rename never moves the derived code. Both
    // measured. The boolean is the only signal scoped to this call.
    const projected = await projectRegistryRows(
      { internalDb: ctx.internalDb, admin: ctx.terminology.admin }, [{ id: after.id, name: after.name }],
    );

    let projection: 'ok' | 'queued-for-retry' = 'ok';
    if (!projected) {
      projection = 'queued-for-retry';
      try {
        await ctx.facilityJobs.enqueue({
          kind: 'registry-projection', registryId: after.id, requestedBy: actorFromRequest(req).actorId,
        });
      } catch (err) {
        ctx.logger.error(
          { err, facilityId: after.id },
          'failed to enqueue a registry-projection retry after a failed facility projection',
        );
      }
    }

    // Task 5: same reasoning as POST above — enqueue, never rebuild inline. Wrapped for the same
    // reason as POST's call too: it sits before `recordAudit` (deliberately contained, see
    // record-audit.ts), so an unwrapped throw here would both 500 an already-committed update and
    // skip the audit write. Logged, not swallowed — a lost enqueue leaves the dimension stale.
    try {
      await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
    } catch (err) {
      ctx.logger.error({ err, facilityId: id }, 'failed to enqueue a facility-map-rebuild job after updating a facility');
    }

    await recordAudit(ctx, req, { action: 'facility.update', entityType: 'facility', entityId: id, before, after });
    return { ...after, projection };
  });

  app.delete('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }

    // ⛔ ORDER IS LOAD-BEARING, and the two halves pull in OPPOSITE directions around the removal —
    // which is why they are two calls straddling it rather than one wrapper on either side.
    //
    //  1. RETIRE FIRST. `retireRegistryConcepts` locates this facility's concept through
    //     `facility_concept_projection`, the only durable record of what the row actually projected
    //     as (its collision fallback is not recomputable once its partner is gone). That table is
    //     `ON DELETE CASCADE`, so the link — and with it any chance of finding the concept — vanishes
    //     the instant the facility does.
    //  2. REPROJECT LAST. `reprojectAfterRegistryDelete` reacts to the row being ABSENT: it looks for
    //     surviving facilities that can now claim the code this deletion freed. Run before the
    //     removal it would still find the doomed row contesting its own code and conclude nothing was
    //     freed.
    //
    // Both are best-effort catch-up around a deletion the operator asked for, exactly as the
    // projection on POST/PUT is (see the comment there): neither may turn a successful delete into a
    // failed response. `reprojectAfterRegistryDelete` contains its own errors;
    // `retireRegistryConcepts` deliberately does not (its containment belongs to the caller, like
    // `reprojectRegistryRows`), so it is wrapped here — and an uncontained throw would be worse than
    // a 500, because it fires BEFORE the removal and would leave the facility undeleted.
    const deps = { internalDb: ctx.internalDb, admin: ctx.terminology.admin };
    try {
      await retireRegistryConcepts(deps, [id]);
    } catch (err) {
      // NOT optional-chained. `AppContext.logger` is a required `Logger`, and this is the only
      // record that a retirement failed — the delete still succeeds and returns 200, so a swallowed
      // log leaves a live ACTIVE concept for a facility that no longer exists with nothing anywhere
      // to say so. A test fixture that omits `logger` is a fixture bug, not a case to tolerate here.
      ctx.logger.error({ err, facilityId: id }, 'failed to retire the deleted facility\'s registry concept');
    }

    await ctx.facilityRegistry.remove(id);

    const { failedRegistryIds } = await reprojectAfterRegistryDelete(deps, {
      id,
      localCode: before.localCode ?? null,
      nationalCode: before.nationalCode ?? null,
    });

    // Task 7's contract — "a failed projection is never only a console.error" — applied to this
    // fourth call site. Deleting one side of a code collision frees the other to move back up to the
    // human code; if that reprojection fails, the SURVIVING facility is left on a stale concept
    // while the operator's `term_mappings` row still names its old code, and the deletion returns a
    // cheerful 200. One job per survivor: they carry distinct registry ids, so the store coalesces
    // them per facility (facility-job-store.ts's `activeKeyFor`) rather than letting the first
    // absorb the rest. Wrapped and placed before `recordAudit` for the same reason as every sibling
    // enqueue in this file.
    for (const registryId of failedRegistryIds) {
      try {
        await ctx.facilityJobs.enqueue({
          kind: 'registry-projection', registryId, requestedBy: actorFromRequest(req).actorId,
        });
      } catch (err) {
        ctx.logger.error(
          { err, facilityId: id, survivorId: registryId },
          'failed to enqueue a registry-projection retry for a facility left stale by a delete',
        );
      }
    }

    // Task 5: removing a facility changes what the dimension should contain, same reasoning as
    // POST/PUT above — enqueue, never rebuild inline. Wrapped for the same reason as those two:
    // it sits before `recordAudit` (deliberately contained, see record-audit.ts), so an unwrapped
    // throw here would both 500 an already-committed delete and skip the audit write. Logged, not
    // swallowed — a lost enqueue leaves the dimension stale.
    try {
      await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
    } catch (err) {
      ctx.logger.error({ err, facilityId: id }, 'failed to enqueue a facility-map-rebuild job after deleting a facility');
    }

    await recordAudit(ctx, req, { action: 'facility.delete', entityType: 'facility', entityId: id, before, after: null });
    return { ok: true };
  });

  // B1 Task 9: the registers an operator may NAME — GET backs the import sheet's `Select` (the free-
  // text `nationalSystem` box this task removes), POST is the only way a fresh install ever gets one
  // to offer. Both sit on `registerSources` (constructed above), never a second query against
  // `coding_systems`.
  app.get('/api/facilities/import/sources', VIEW, async () => {
    // Active-only, on purpose: `list()`'s own default is what keeps a DEACTIVATED register off this
    // picklist (see `FacilityRegisterSourceStore.list`'s own doc comment) — a `Select` offering a
    // spelling the import routes would then refuse (`resolveFacilityRegisterForImport`) is worse than
    // one that offers fewer choices.
    const rows = await registerSources.list();
    return { rows };
  });

  app.post('/api/facilities/import/sources', MANAGE, async (req, reply) => {
    const p = SourceCreateSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    try {
      const created = await registerSources.create(p.data);
      reply.code(201);
      return created;
    } catch (err) {
      // `registerSources.create` throws a plain Error, never a raw Postgres exception, for BOTH ways
      // one url can already be spoken for — a case-insensitive collision with another register (its
      // own pre-check) and a collision with a NON-register coding system, which only ever surfaces
      // as `coding_systems_url_uq`'s 23505 (that index is on `url` ALONE, not scoped by `kind` — see
      // the store's own comment on its insert's catch block). Recognised by message here rather than
      // by a `.code` the store has already stripped off, and reported as a 409 conflict — same
      // reasoning as `mapFacilityDbError` above, just against a different table and a store that has
      // already done its own classification. Anything else rethrows, reaching the central error
      // handler as the 500 it actually is.
      if (err instanceof Error && /already exists/i.test(err.message)) {
        reply.code(409);
        return { error: err.message };
      }
      throw err;
    }
  });

  // Task 4 (facility-import-mapping): header row + ranked suggestions, for BOTH import doors. The
  // inline path already holds the file text client-side; the streamed path (A2b upload) does not,
  // since the file is a blob only the server can read. One endpoint rather than two mechanisms
  // that would drift.
  app.post('/api/facilities/import/suggest-map', IMPORT, async (req, reply) => {
    const reqBody = (req.body ?? {}) as { csv?: string };
    // Only the first line is needed. Parsing the whole file to read its header would make a 64 MiB
    // upload pay for a suggestion.
    //
    // ⛔ DELIBERATELY NAIVE — split on `,`, not a real CSV parse. A quoted header containing a
    // comma would split wrongly. That is acceptable here: this suggestion is advisory and the
    // operator sees and confirms every header before anything is imported. The AUTHORITATIVE
    // header parse remains `parseFacilityCsv`'s. Do not "fix" this into a second CSV parser.
    const firstLine = (reqBody.csv ?? '').split(/\r?\n/, 1)[0] ?? '';
    const headers = firstLine.split(',').map((h) => h.trim()).filter((h) => h !== '');
    if (headers.length === 0) {
      reply.code(400);
      return { error: 'no header row found in the supplied file' };
    }
    return { headers, columns: suggestColumns(headers) };
  });

  app.post('/api/facilities/import/suggest-values', IMPORT, async (req, reply) => {
    const reqBody = (req.body ?? {}) as { field?: string; values?: unknown };
    const field = reqBody.field as ControlledField | undefined;
    if (!field || !CONTROLLED_FIELDS.includes(field)) {
      reply.code(400);
      return { error: `field must be one of ${CONTROLLED_FIELDS.join(', ')}` };
    }
    // Whole-branch review, M1: the OLD cast (`as { values?: string[] }`) only ever checked
    // `Array.isArray` below, never each element's TYPE. `suggestValues` -> `rank` ->
    // `normaliseLabel` calls `.replace` on every raw value with no guard of its own — a non-string
    // element (e.g. `values: [42]`) reached that `.replace` and threw an unhandled 500, where a
    // malformed request body is already the documented 400 case just above.
    if (reqBody.values !== undefined
      && !(Array.isArray(reqBody.values) && reqBody.values.every((v) => typeof v === 'string'))) {
      reply.code(400);
      return { error: 'values must be an array of strings' };
    }
    const values = Array.isArray(reqBody.values) ? (reqBody.values as string[]) : [];

    const vs = await ctx.terminology.admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[field]);
    if (!vs) {
      // The field's value set is not seeded on this install — the same condition
      // `resolveControlledFields` reports as `notValidated`. No candidates exist to rank against.
      return { values: values.map((value) => ({ value, candidates: [] })), notValidated: true };
    }
    const { codes } = await ctx.terminology.admin.valueSets.expand(vs.id);
    const candidates = codes.map((c) => ({ code: c.code, display: c.display ?? null }));
    return { values: suggestValues(values, candidates), notValidated: false };
  });

  // Task 6 (facility-import-mapping): the wizard's value panel writes its raw-string -> canonical-
  // code decisions here (Task 5's `saveFacilityValueMappings`, @openldr/bootstrap). It validates
  // every entry against the field's value set BEFORE writing any of them, so a half-applied set is
  // impossible by construction — this route only needs to turn that thrown refusal into a 400.
  //
  // ⛔ Same register gate as both import doors above (`resolveFacilityRegisterForImport`):
  // `nationalSystem` must name a REGISTERED facility register, never a label somebody typed.
  // `observedFieldSystem` (facility-controlled-fields.ts:60) slugifies whatever it is given, so a
  // typed string would write mappings under a namespace nothing will ever resolve against, with no
  // error anywhere else in the system to catch it.
  app.post('/api/facilities/import/value-mappings', MANAGE, async (req, reply) => {
    const p = ValueMappingsSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const register = await resolveFacilityRegisterForImport(registerSources, p.data.nationalSystem);
    if (!register.ok) { reply.code(400); return { error: register.error }; }

    const entries: ValueMappingEntry[] = p.data.mappings;
    let result;
    try {
      result = await saveFacilityValueMappings(ctx.terminology.admin, register.source.url, entries);
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }

    await recordAudit(ctx, req, {
      action: 'facility.value-mapping',
      entityType: 'facility',
      entityId: register.source.url,
      before: null,
      after: null,
      metadata: {
        nationalSystem: register.source.url, written: result.written, superseded: result.superseded.length,
      },
    });
    return result;
  });

  // Task 4: CSV import — a thin HTTP wrapper over `@openldr/bootstrap`'s `importFacilities`, the
  // SAME function `openldr facilities import` (packages/cli/src/facilities.ts) calls, per the
  // repo's CLI-parity rule. See the MAX_IMPORT_CSV_BYTES / MAX_INLINE_APPLY_ROWS comments above for
  // the size-cap and inline-vs-bounded-apply decisions.
  app.post('/api/facilities/import', IMPORT, async (req, reply) => {
    const p = ImportSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    // Enforced here at the JS level, not left to Fastify's own (higher) bodyLimit — see
    // MAX_IMPORT_CSV_BYTES's doc comment for why the ordering matters.
    const csvBytes = Buffer.byteLength(p.data.csv, 'utf8');
    if (csvBytes > MAX_IMPORT_CSV_BYTES) {
      reply.code(400);
      return {
        error: `csv exceeds the ${Math.floor(MAX_IMPORT_CSV_BYTES / (1024 * 1024))}MB limit for this endpoint; `
          + `use \`openldr facilities import\` (the CLI) for a larger register`,
      };
    }

    // ⛔ B1 Task 3: the register gate — see `resolveFacilityRegisterForImport` (@openldr/db) for the
    // two-identities-one-namespace defect it closes, and for why a deactivated register is refused
    // separately from an unregistered one. It runs BEFORE `importFacilities` is called at all, so a
    // refused import parses nothing, mints no run (which would hold this register's `active_key`) and
    // certainly writes nothing. ⛔ EVERY import door carries it — this route, the upload route below
    // and `openldr facilities import` — all calling the same function, because doors that disagree
    // about what a register is would put the fork straight back.
    const register = await resolveFacilityRegisterForImport(registerSources, p.data.nationalSystem);
    if (!register.ok) { reply.code(400); return { error: register.error }; }

    // Fix 1 (mapping-ux report): `admin` lets `importFacilities` project every written row into
    // FACILITY_REGISTRY_SYSTEM — the Facilities-page upload gets the same immediate-mapping
    // behaviour as a single facility create/update (POST/PUT above) and the CLI.
    // Task 5: `facilityJobs` lets an applied import enqueue the same `facility-map-rebuild` job a
    // single create/update/delete does (see importFacilities' own matching comment for why that is
    // a single call per import already, not per row).
    // ⛔ `audit` (whole-branch Critical 2). Task 7 writes one `facility.import.row` event per CHANGED
    // facility, and it is what makes `GET /api/facilities/:id/history` (above) show an import at all
    // and the Studio's provenance panel say anything other than "Never imported". Without it,
    // `importFacilities` takes its `if (!deps.audit)` branch and logs that the per-row write is
    // unaudited — so this literal omitting it made the whole feature dead on the browser door.
    // The SAME store `recordAudit` (audit-helper.ts) uses for this route's own register-scoped
    // `facility.import` entry, deliberately: two audit sinks for one import could disagree about
    // whether it happened. Safe on the PREVIEW call this same object is passed to — the per-row audit
    // block sits after the write transaction, which a preview never reaches.
    const deps = { db: ctx.internalDb, capture: referenceCapture, admin: ctx.terminology.admin, facilityJobs: ctx.facilityJobs, audit: ctx.audit, logger: ctx.logger };
    const importOpts = {
      nationalSystem: p.data.nationalSystem,
      allowUnknownColumns: p.data.allowUnknownColumns,
      allowMalformedRows: p.data.allowMalformedRows,
      allowInvalidCoordinates: p.data.allowInvalidCoordinates,
      format: p.data.format,
      completeRelease: p.data.completeRelease,
      onDeleted: p.data.onDeleted,
      onAbsent: p.data.onAbsent,
      onConflict: p.data.onConflict,
      // Task 8b: threaded through unchanged from the request. `undefined` when the operator sent
      // none — `parseFacilityCsv` treats an absent map exactly as it did before this option existed
      // (headers must already BE the contract), so an import with no mapping decision behind it is
      // unaffected.
      columnMap: p.data.columnMap,
    };

    // Always preview first (importFacilities reads the registry — a chunked `WHERE id IN (...)`
    // against `deps.db` via `loadExisting` — but never opens a transaction when `apply` is falsy, see
    // its own early-return). This gives an AUTHORITATIVE `parsed` count —
    // not a cheap line-count approximation — to check the inline-apply cap against, before ever
    // considering the write transaction below. Unknown columns (parser-blocked, per
    // facility-csv.ts) and an empty/all-skipped file both surface here as `parsed: 0` and are
    // reported back verbatim rather than swallowed — never treated as "safe to write".
    //
    // ⛔ Wrapped: `parseFacilityCsv` (reached inside `importFacilities`, before any DB access on
    // this preview path) can throw rather than return a result — see `isCsvParseError`'s doc
    // comment. It throws only on STRUCTURALLY UNPARSEABLE input, i.e. text csv-parse cannot
    // tokenise at all, such as an unterminated quote. A merely RAGGED row (field count disagreeing
    // with the header's) does NOT throw: `relax_column_count` is on, and Task 3 made those rows
    // QUARANTINED and reported with line numbers, which is a normal 200 result carrying
    // `quarantined`/`blocked`, not an error. Only a RECOGNISED parse failure becomes a 400; anything
    // else is rethrown unchanged and reaches the central error handler as the 500 it is.
    //
    // ⛔ No `facility_import_runs` row is created before this call — a run is only ever worth
    // persisting once the input has been shown to actually parse. Creating one first and rolling it
    // back on a parse failure would need a cancel path this store does not have (A2b's job), and
    // would otherwise leave `active_key` held by a file that was never even valid.
    let preview: FacilityImportResult;
    try {
      preview = await importFacilities(deps, p.data.csv, { ...importOpts, apply: false });
    } catch (err) {
      if (!isCsvParseError(err)) throw err;
      reply.code(400);
      return { error: err.message };
    }

    // Task 10 / the FAC-P1-04 boundary. ⚠ Its ORIGINAL reason is gone: this used to guard free-text
    // `nationalSystem`, where `HFR` and `hfr` were two registers that would never merge, and deferred
    // "modelling sources properly" to a later sub-project. THIS IS THAT SUB-PROJECT (B1), and the
    // modelling landed ~60 lines above — `registerSources.getByUrl` refuses anything that is not a
    // registered register's canonical URI, exactly and case-sensitively, so a second identity for one
    // register can no longer be typed into existence here at all.
    //
    // What the flag still answers is narrower and still worth reporting: has this install ever held a
    // facility filed under this register before (`resolveKnownNationalSystem` — a single existence
    // probe over `facility_registry.national_system`)? `false` means this apply is the register's
    // FIRST import here, which is the moment an operator most wants to be told they may have picked
    // the wrong register from the picklist. Reported, never blocked — a genuinely new register is a
    // normal thing to import, and this cannot tell the two cases apart. Computed
    // unconditionally (both the standalone-preview and the apply-flow read this same `preview`), so
    // an operator applying straight through (no separate preview round-trip) still gets the warning
    // on the final response — see where `result.knownNationalSystem` is set below.
    //
    // ⛔ The SHARED resolver, not a query spelled here. The background import worker has to answer
    // the same question about the same register (it persists this field as the run's durable
    // summary), and two hand-written lookups are free to disagree about what "already known" means.
    preview.knownNationalSystem = await resolveKnownNationalSystem(ctx.internalDb, p.data.nationalSystem);

    if (!p.data.apply) {
      // A standalone preview (no `apply`) is the ONLY call that mints a run — see the module-level
      // comment on `importRuns` and the apply branch below for why an apply carrying no `runId` must
      // stay unlinked rather than have this route invent one on its behalf.
      const startPreviewInput = {
        nationalSystem: p.data.nationalSystem,
        sourceFormat: p.data.format ?? 'csv',
        fileHash: createHash('sha256').update(p.data.csv, 'utf8').digest('hex'),
        byteSize: csvBytes,
        releaseVersion: p.data.releaseVersion ?? null,
        // Important 5 (whole-branch review): migration 080 provisioned these three columns and
        // nothing ever wrote them — `preview.meta` (populated by `importFacilities` for a JSONL
        // release, always `null` for CSV — see that function's docblock) is the ONLY source for
        // them, and it is already computed by the time this object is built. Read straight off
        // `preview.meta`, never off `p.data`: the client cannot supply a trustworthy row/deletion
        // count itself, only the release header the file actually declared can.
        releasePublishedAt: preview.meta?.publishedAt ?? null,
        declaredRowCount: preview.meta?.rowCount ?? null,
        declaredDeletionCount: preview.meta?.deletionCount ?? null,
        options: importOpts,
        requestedBy: actorFromRequest(req).actorId,
      };
      let run: FacilityImportRun;
      try {
        run = await importRuns.startPreview(startPreviewInput);
      } catch {
        // Fix wave 1 (Important 4): `active_key` is set here and released only by a write that takes
        // the run out of play — every terminal write (`finishApply`/`finish`), `supersede`,
        // `failStaleRunning`, and `requestCancel`'s direct cancel, each of which nulls it in the same
        // update (see `facility-import-run-store.ts`). NOTHING EXPIRES a run that stays `previewed`
        // forever — A2b Task 6 added a cancel route an operator can drive by hand, but no timer, no
        // sweep and no boot path retires an idle `previewed` run — so an operator who previews and
        // then simply never applies (closes the sheet, navigates away — the ordinary "changed my
        // mind" path, not a failure of any kind) would otherwise lock this `nationalSystem` out of
        // every future preview or runId-less apply permanently, short of a database reset or that
        // manual cancel.
        //
        // ⛔ The DECISION lives in `takeOverRegister` (top of this function), SHARED with the upload
        // route's gate rather than copied — see its doc comment for why the holder is found by
        // `active_key`, why only a SUPERSEDABLE run is taken over, and why the take-over is a
        // compare-and-swap. The thrown error is deliberately not bound: it says only "already in
        // progress" for this `nationalSystem`, which is several distinguishable situations rolled
        // into one sentence, and the gate below names the one that actually holds. A throw for any
        // OTHER reason (a db failure, say) finds no holder, falls through to the retry, and surfaces
        // its own message from there.
        //
        // Exactly ONE retry: a second failure is surfaced as-is, never looped.
        const gate = await takeOverRegister(p.data.nationalSystem, 'superseded by a newer preview');
        if (!gate.freed) {
          reply.code(409);
          return { error: gate.error };
        }
        try {
          run = await importRuns.startPreview(startPreviewInput);
        } catch (retryErr) {
          // The register was freed above and something took it again before this statement — a
          // genuine race between two operators, not a stuck run.
          reply.code(409);
          return { error: retryErr instanceof Error ? retryErr.message : String(retryErr) };
        }
      }
      await importRuns.completePreview(run.id, preview);
      preview.runId = run.id;
      return preview;
    }

    if (preview.parsed === 0) return preview;

    // Task 5: mirrors the `preview.parsed === 0` short-circuit above, but needs its own check —
    // unlike unknown columns (which zero out `parsed` for the whole file), a quarantined row does
    // NOT drop `parsed` to 0 (see facility-csv.ts: only the malformed rows themselves are excluded,
    // the rest of the file still parses). Without this, the route would open a real write
    // transaction whose OWN internal `blocked` check (facility-import.ts) makes it a no-op, then
    // still audit an "import" that wrote nothing.
    //
    // ⛔ READ off the preview, never re-derived. This guard fronts a WRITE transaction, and the
    // predicate it needs is `importFacilities`' own — which also blocks on duplicate headers. The
    // quarantine-only version this line used to spell out agreed with it purely because
    // `parseFacilityCsv` zeroes `records` on duplicate headers, so the `parsed === 0` check above
    // happened to cover the difference. That is the parser's shape, not a contract.
    if (preview.blocked) return preview;

    if (preview.parsed > MAX_INLINE_APPLY_ROWS) {
      reply.code(400);
      return {
        error: `this register has ${preview.parsed} row(s), which exceeds the ${MAX_INLINE_APPLY_ROWS}-row inline apply `
          + `limit; use \`openldr facilities import --apply\` (the CLI) instead — it is not bound by an HTTP request deadline`,
      };
    }

    // Task 10: resolve the run a PRIOR standalone preview minted, if the caller supplied one.
    // ⛔ An apply arriving WITHOUT a `runId` is NOT silently linked to whatever run this route may
    // have created on an earlier, unrelated call — `run` stays `null`, `previewedAt` stays `null`,
    // and `importFacilities` reports `conflict: null` (NOT EVALUATED), never `0` (evaluated as
    // clean). Reporting `0` here would be exactly the lie FAC-P1-03 removed one layer up.
    //
    // A `runId` the caller DID supply is validated on two axes before it is trusted, not merely
    // checked for existence — an ordinary HTTP retry or a stale client tab is enough to violate
    // either one:
    //  - OWNERSHIP (400, "you sent the wrong run for this register"): a run minted for one
    //    `nationalSystem` must never be allowed to lend its `previewedAt` watermark to an apply
    //    naming a DIFFERENT one — that is not a conflict-detection question at all, it is the wrong
    //    answer to a question this run was never asked. 400 because the request itself is
    //    self-contradictory (this exact `nationalSystem` paired with a `runId` that names another),
    //    the same category of client-input error `ImportSchema.safeParse` above already 400s.
    //  - FRESHNESS (409, "this run is no longer applicable"): a run that is not `isApplicable` is
    //    excluded for one of three reasons — it has already been DECIDED (`applied`, `failed`,
    //    `cancelled`); it has no completed preview behind it to supply a watermark (`queued`,
    //    `validating`); or it is IN FLIGHT (`applying`), which has a completed preview and is not
    //    decided, but is already being applied by someone else and must not be applied twice.
    //    Resubmitting a decided one (a retry replaying the
    //    same `runId`) must not perform a SECOND real write reusing the first apply's watermark, nor
    //    overwrite that first apply's terminal `summary`/`error` with a second one. 409 because the
    //    run itself is the reason the request cannot proceed as asked, independent of whether the
    //    request is otherwise well-formed — the same "this thing exists but is not in a state that
    //    accepts this action" shape as the `startPreview` 409 above.
    let run: FacilityImportRun | null = null;
    if (p.data.runId) {
      run = await importRuns.get(p.data.runId);
      if (!run) { reply.code(404); return { error: `import run not found: ${p.data.runId}` }; }
      if (run.nationalSystem !== p.data.nationalSystem) {
        reply.code(400);
        return {
          error: `import run ${p.data.runId} belongs to national system "${run.nationalSystem}", `
            + `not "${p.data.nationalSystem}"`,
        };
      }
      // ⛔ `isApplicable`, not `!== 'previewed'`: an apply may start from any state with a COMPLETED
      // preview behind it, because that is what makes the run's `previewed_at` a trustworthy
      // conflict baseline for the write below. A2a had exactly one such state; A2b's
      // `awaiting_confirmation` is the same situation reached by the background path, and hard-coding
      // the literal here would 409 it forever. See `facility-import-run-states.ts`.
      if (!isApplicable(run.status)) {
        reply.code(409);
        return { error: `import run ${p.data.runId} is no longer applicable: status is "${run.status}"` };
      }
    }

    // ⛔ Wrapped for the same reason as the preview call above. In practice the preview call
    // above already parsed this exact `p.data.csv` successfully (a malformed file would have been
    // caught and returned as a 400 before this line is ever reached), so `parseFacilityCsv`
    // itself will not throw a second time here — this guard exists so the apply path does not
    // silently regress to a raw 500 if that assumption ever stops holding (e.g. a future change
    // that lets the two calls see different input), not because it is expected to fire today. A
    // non-parse error (a DB failure from the write transaction this call opens) is rethrown
    // unchanged, exactly as before this fix — it must still surface as a 500, never a 400.
    //
    // ⛔ Either way out of this try — a recognised parse error or an unrelated rethrown failure — a
    // `run` this apply was given must be finished as `'failed'` before the response leaves. Skipping
    // that would leave the run (and the whole national_system, via `active_key`) active forever: a
    // permanent lock with no cancel path in this slice. `finishApply` itself is wrapped and merely
    // logged on failure, mirroring every other best-effort side-write in this file (the enqueue
    // calls) — a lost status update must not turn an already-decided error response into a second,
    // different one, and must not swallow the ORIGINAL error either.
    let result: FacilityImportResult;
    try {
      result = await importFacilities(deps, p.data.csv, {
        ...importOpts, apply: true, runId: run?.id ?? null,
        previewedAt: run?.previewedAt ? new Date(run.previewedAt) : null,
      });
    } catch (err) {
      if (run) {
        try {
          await importRuns.finishApply(run.id, 'failed', { error: err instanceof Error ? err.message : String(err) });
        } catch (finishErr) {
          ctx.logger.error({ err: finishErr, runId: run.id }, 'failed to mark a facility import run failed after a thrown apply');
        }
      }
      if (!isCsvParseError(err)) throw err;
      reply.code(400);
      return { error: err.message };
    }
    // Echo the SAME answer the preceding preview computed — an operator applying straight through in
    // one request deserves the new-register warning on the response that actually wrote, not only on
    // an intermediate object this route never returned.
    //
    // ⛔ ORDER IS LOAD-BEARING: this MUST run before `finishApply` below persists `result` as the
    // run's durable `summary`. `finishApply`'s store `JSON.stringify`s `summary` SYNCHRONOUSLY on the
    // way in — it does not hold a live reference that later mutations of `result` would still reach.
    // Setting this field after that call (as it once was) left the HTTP response carrying
    // `knownNationalSystem` while the same field was silently absent from `GET
    // /api/facilities/import/runs/:id`'s persisted record of the very same apply.
    result.knownNationalSystem = preview.knownNationalSystem;

    if (run) {
      try {
        await importRuns.finishApply(run.id, 'applied', { summary: result });
      } catch (finishErr) {
        ctx.logger.error({ err: finishErr, runId: run.id }, 'failed to mark a facility import run applied after a successful apply');
      }
    }

    // A dry run (handled above) writes nothing and must not audit. This point is only reached
    // once a real write happened (preview.parsed > 0 and under the inline cap).
    await recordAudit(ctx, req, {
      action: 'facility.import',
      entityType: 'facility',
      entityId: p.data.nationalSystem,
      before: null,
      after: null,
      metadata: {
        nationalSystem: p.data.nationalSystem, allowUnknownColumns: !!p.data.allowUnknownColumns,
        allowMalformedRows: !!p.data.allowMalformedRows, result,
      },
    });
    return result;
  });

  // ── A2b Task 3: the upload end of the background import ───────────────────────────────────────
  //
  // Streams the register file straight into blob storage and mints a `queued` run for it. Nothing is
  // parsed, validated or written here: A2b Task 4's worker claims the run, reads the file back out
  // of the blob store, and reports what it found through the run row. So a 202 means "the file is
  // stored and the work is queued" — never "the register was imported", which is why this is not a
  // 200 or a 201.
  //
  // ⛔ NO ROW CAP ON THIS PATH. See the "TWO IMPORT PATHS, ONE CAP" block under
  // `MAX_INLINE_APPLY_ROWS` for why that cap stays on the inline route and must not follow the file
  // here.
  //
  // Parameters ride the QUERY STRING because the body is the file itself — the same shape the
  // terminology distribution upload uses (`terminology-admin-routes.ts`), which this route otherwise
  // follows closely (bodyLimit config object, `isReadableBody` guard, `putStream`, audit, id back).
  app.post('/api/facilities/import/upload', UPLOAD, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    // `ownFirstString`, not `firstString(q.x)` — see that helper's doc comment.
    const nationalSystem = ownFirstString(q, 'nationalSystem');
    // ⛔ Required, never defaulted, for the reason `ImportSchema.nationalSystem` documents: a
    // hardcoded fallback would eventually file a register under the wrong national identity.
    if (!nationalSystem) { reply.code(400); return { error: 'nationalSystem is required' }; }

    const format = ownFirstString(q, 'format') ?? 'csv';
    if (format !== 'csv' && format !== 'jsonl') {
      reply.code(400);
      return { error: `format must be "csv" or "jsonl", not "${format}"` };
    }
    const releaseVersion = ownFirstString(q, 'releaseVersion') ?? null;

    // The file DECLARES ITSELF the whole of this register — the one claim that lets a row's absence
    // from it mean anything at all (`FacilityImportResult.absent`). It rides the query string like
    // every other upload parameter and is stored on the run below, where the worker's
    // `validateOptions` spreads it into `importFacilities` (and `applyOptions` does the same for the
    // write). Without it a background validate could only ever report `absent: null` (NOT
    // EVALUATED), so a national complete release — the file this whole path exists for, far above
    // the inline route's 2 000-row apply cap — could get absence-retirement through the CLI alone.
    //
    // ⛔ DECLARING A COMPLETE RELEASE RETIRES NOTHING BY ITSELF, and the two-tier asymmetry is
    // unchanged: `onAbsent` defaults to `'report'` and only the operator's CONFIRM can raise it to
    // `'retire'`, while a publisher's declared `deletion` still defaults to `'retire'` (see the
    // defaults in `importFacilities`). This flag only decides whether the count is MEASURED.
    // ⛔ It also cannot make a refusable file retire anything: `importFacilities` reports
    // `absent: null` for a file that parsed to ZERO records no matter what is declared here — an
    // empty parse is evidence the file did not parse, not that every facility is absent. That guard
    // is `records.length === 0` in facility-import.ts and nothing on this route may route around it.
    const completeRelease = ownBoolean(q, 'completeRelease');
    if (completeRelease === 'invalid') {
      reply.code(400);
      return { error: 'completeRelease must be "true" or "false"' };
    }

    // ⛔ THE TWO OVERRIDES THAT CHANGE HOW THE FILE PARSES, and they belong to the UPLOAD for exactly
    // the reason `completeRelease` above does: both are fed to `parseFacilityCsv`/`parseFacilityRelease`
    // (see `parseOpts` in facility-import.ts), so they decide which rows become records — and the
    // VALIDATE is what turns records into the summary an operator reads. Arriving at confirm time
    // instead, they would make the apply classify a DIFFERENT record set than the one that was
    // approved, which the confirm route now refuses outright. `allowMalformedRows` is deliberately
    // NOT here: it changes only the `blocked` verdict, never the parse, so it stays the confirm's.
    const parseOverrides: Record<string, boolean> = {};
    for (const key of ['allowUnknownColumns', 'allowInvalidCoordinates'] as const) {
      const value = ownBoolean(q, key);
      if (value === 'invalid') {
        reply.code(400);
        return { error: `${key} must be "true" or "false"` };
      }
      if (value !== undefined) parseOverrides[key] = value;
    }

    // Task 8b: how this file's own headers map onto the contract — the SAME parse-changing family as
    // `allowUnknownColumns`/`allowInvalidCoordinates` just above, and belongs to the UPLOAD for the
    // identical reason: the worker's VALIDATE phase is what turns this file into the summary an
    // operator reviews, so a map arriving only at confirm time would let an operator confirm a
    // summary the apply then contradicts — the exact bug class this route's sibling gate exists to
    // close (see the confirm route's own "parse-override gate" comment). There is no multipart body
    // on this route (the request body IS the file — see `isReadableBody` below), so the map rides the
    // query string JSON-encoded, exactly like every other upload parameter.
    const columnMapRaw = ownFirstString(q, 'columnMap');
    let columnMap: FacilityColumnMap | undefined;
    if (columnMapRaw !== undefined) {
      let columnMapJson: unknown;
      try {
        columnMapJson = JSON.parse(columnMapRaw);
      } catch {
        reply.code(400);
        return { error: 'columnMap must be valid JSON' };
      }
      const mapResult = ColumnMapSchema.safeParse(columnMapJson);
      if (!mapResult.success) {
        reply.code(400);
        return { error: `columnMap is malformed: ${mapResult.error.message}` };
      }
      columnMap = mapResult.data;
    }

    // A JSON body (the INLINE route's shape, sent here by mistake) arrives as a parsed object and
    // must be refused before anything else happens — piping it would throw somewhere far less
    // legible.
    if (!isReadableBody(req.body)) {
      reply.code(400);
      return { error: 'expected the register file as a request-body stream (content-type: application/octet-stream or text/csv)' };
    }

    // ⛔ B1 Task 3: the SAME register gate the inline route applies — literally the same function
    // (`resolveFacilityRegisterForImport`, @openldr/db), against this route's own query-string
    // parsing. Every import door must agree about what a register is; an ungated upload would re-open
    // the two-identities fork at exactly the scale this path exists for (a full national register).
    // Like the in-progress gate below it, it runs BEFORE the transfer: a refused upload must not
    // first cost a national register's worth of bandwidth.
    const register = await resolveFacilityRegisterForImport(registerSources, nationalSystem);
    if (!register.ok) { reply.code(400); return { error: register.error }; }

    // ⛔ The register gate runs BEFORE the transfer, not after it. A refused upload must not first
    // cost a national register's worth of bandwidth and leave an orphan object behind. Shared with
    // the inline preview route — see `takeOverRegister`.
    const gate = await takeOverRegister(nationalSystem, 'superseded by a newer upload');
    if (!gate.freed) { reply.code(409); return { error: gate.error }; }

    // ⚠ The object is named by a fresh uuid, NOT by the run id, which is the one place this differs
    // from the shape A2b's plan sketched. The run row cannot exist yet: `startUpload` writes
    // `file_hash` and `byte_size`, and neither is known until the last byte has gone past — while
    // `putStream` needs its key before the first one does. Minting the run first would mean either
    // storing a hash of nothing or an UPDATE the store deliberately does not have. The durable link
    // is `facility_import_runs.blob_key`, written below — it resolves run→object directly and
    // object→run through that column; the slug is there so a human browsing the bucket can tell the
    // registers apart.
    const key = `facility-import/${nationalSystemSlug(nationalSystem)}/${randomUUID()}.${format}`;

    // ⛔ Hash and size are computed AS THE BYTES TRAVEL, in a transform between the request and the
    // blob store — the file is never buffered, at any size. Reading the object back to hash it (or
    // collecting it into a Buffer first) would put a national register in memory twice and defeat
    // the whole point of streaming it.
    // ⛔ THE UPLOAD'S ONLY REAL BYTE CEILING. `bodyLimit` is inert for this route's passthrough
    // parser (measured — see `MAX_UPLOAD_BYTES`), so without this counter an authenticated client
    // could stream without end. Enforced HERE, in the transform that already counts the bytes,
    // rather than after the transfer: crossing the limit errors the transform, which tears the
    // pipeline (and the blob write behind it) down mid-flight instead of paying for the whole file
    // first. `SY0413` → 413 through the central error handler, the same contract as
    // `workflows-routes.ts`'s upload. Read off `ctx.cfg` per request (not captured at registration)
    // for the same reason that route does: it is the value a test can lower and an operator can tune.
    const maxUploadBytes = ctx.cfg.FACILITY_IMPORT_MAX_UPLOAD_BYTES;
    const digest = createHash('sha256');
    let byteSize = 0;
    // Set the moment the ceiling is crossed, and PREFERRED over whatever rejection wins the race
    // below. Both sides of the transfer fail when the transform errors — `pipeline` with this error
    // and the blob store with whatever it wraps that error in — so without this the answer would be
    // 413 or 500 depending on which promise settled first.
    let overCap: Error | null = null;
    const hashing = new Transform({
      transform(chunk: Buffer, _enc, done) {
        byteSize += chunk.length;
        if (byteSize > maxUploadBytes) {
          overCap = appError('SY0413', { message: `the register file exceeds the ${maxUploadBytes}-byte upload limit` });
          done(overCap);
          return;
        }
        digest.update(chunk);
        done(null, chunk);
      },
    });

    try {
      const stored = ctx.blob.putStream(key, hashing, format === 'csv' ? 'text/csv' : 'application/x-ndjson');
      // ⛔ Wire the SINK's failure back into the transform, or the transfer never tears down. A blob
      // store that rejects WITHOUT draining `hashing` — the realistic S3 case, `Upload.done()`
      // rejecting on a bad bucket or credentials while its chunk generator stops consuming — leaves
      // `pipeline` parked on backpressure forever, because nothing is reading the bytes it is trying
      // to push. MEASURED standalone (a 5 MB `Readable` source, a sink rejecting after 50 ms without
      // reading a byte): without this line the pipeline never settles; with it, it settles in ~60 ms.
      // Fastify sets no `requestTimeout` (app.ts), so "never" really is never — the request stream
      // and the transform would be held for the life of the process. `Promise.all` below answers the
      // client either way, so that leak is INVISIBLE in the response; the route test asserts on this
      // transform's `destroyed` flag instead.
      stored.catch((e) => hashing.destroy(e instanceof Error ? e : new Error(String(e))));
      // ⛔ `Promise.all`, and NEVER `allSettled` — the opposite of what an earlier version of this
      // code did, on a reason that was measured FALSE. That version claimed `Promise.all` "leaves the
      // loser's rejection unobserved — an unhandled rejection". It does not: `Promise.all` subscribes
      // to every element, so a later rejection is always observed (probed with a two-element `all`
      // where the second rejects 50 ms after the first — no `unhandledRejection` event fires).
      //
      // What `allSettled` DOES do is wait for `pipeline` to settle — and against a Fastify request
      // stream it never settles once the transform errors, which is exactly what the byte ceiling
      // above does. MEASURED under `app.inject`: the drain side rejects with the transform's error,
      // `pipeline`'s promise stays pending and `req.body.destroyed` is still false a second later, so
      // the handler never returns and the reply is never sent. `Promise.all` rejects on the first
      // failure and answers (413/500) while that unwinding happens behind it.
      //
      // ⚠ Accepted cost, stated rather than hidden: because this returns before the blob write has
      // necessarily finished, `discardBlob` below can race a sink that is still flushing. That is
      // tolerable precisely because that cleanup is best-effort by construction (see its doc
      // comment) — a leaked object is a leak, whereas a reply that is never sent is a hung request.
      await Promise.all([pipeline(req.body as NodeJS.ReadableStream, hashing), stored]);
    } catch (err) {
      // The register was freed by the gate above and no run row exists, so the only thing left over
      // is a possibly-partial object. Best-effort delete, logged — a lost cleanup must not change
      // the answer the operator gets, which is the transfer failure itself.
      await discardBlob(key, 'a failed facility import upload');
      throw overCap ?? err;
    }

    // An empty upload is refused rather than queued, the same call `ImportSchema.csv`'s
    // `must not be empty` refine makes on the inline route: a run minted for zero bytes would hold
    // `active_key` (locking the register out of the next, real upload) until a worker got round to
    // reporting that there was nothing in it. Checked HERE and not before the transfer because a
    // declared `content-length` is not the same claim as "bytes actually arrived".
    if (byteSize === 0) {
      await discardBlob(key, 'an empty facility import upload');
      reply.code(400);
      return { error: 'the uploaded register file is empty' };
    }

    const fileHash = digest.digest('hex');
    let run: FacilityImportRun;
    try {
      run = await importRuns.startUpload({
        nationalSystem,
        sourceFormat: format,
        blobKey: key,
        fileHash,
        byteSize,
        releaseVersion,
        // Only what the request actually chose. The import options proper (allowUnknownColumns,
        // onConflict, …) are the CONFIRM step's, not the upload's — recording a made-up set here
        // would put a decision in the durable record that no operator ever made.
        //
        // ⚠ `completeRelease` IS the upload's to record, unlike those: it is a claim about the FILE
        // being stored, and `absent` is classified at VALIDATE time, before any confirm exists — so
        // the confirm could not carry it even if it wanted to. Spread conditionally for the reason
        // the line above states: an unsent parameter leaves the key OUT of `options` entirely rather
        // than writing a `false` nobody sent.
        //
        // ⚠ …and so are the two PARSE-CHANGING overrides above, for the same reason and with the
        // same conditional spread: they select which rows the VALIDATE turns into records, so they
        // have to be in place before the summary the operator reviews is computed. See
        // `parseOverrides` and the confirm route's parse-override gate.
        //
        // ⚠ …and `columnMap` joins them for the identical reason (Task 8b) — it is the THIRD
        // parse-changing input, and the reason it must be set HERE rather than at confirm time. The
        // confirm route's `ConfirmSchema` deliberately has no `columnMap` key: `chosen` (built from
        // that schema) can therefore never overwrite what this line wrote, so an apply is guaranteed
        // to run with the SAME map its validate did — "the same map it was validated with" holds by
        // construction, not by a comparison anywhere.
        options: {
          nationalSystem,
          ...(completeRelease === undefined ? {} : { completeRelease }),
          ...parseOverrides,
          ...(columnMap ? { columnMap } : {}),
        },
        requestedBy: actorFromRequest(req).actorId,
      });
    } catch (err) {
      // The gate freed the register, so this is a genuine race: another request took it between the
      // gate and here. `startUpload`'s own readable pre-check is what produces this message — the
      // unique `active_key` index is the race-safe backstop behind it.
      await discardBlob(key, 'a facility import upload whose run could not be minted');
      reply.code(409);
      return { error: err instanceof Error ? err.message : String(err) };
    }

    await recordAudit(ctx, req, {
      action: 'facility.import.uploaded',
      entityType: 'facility',
      entityId: nationalSystem,
      before: null,
      after: null,
      metadata: { runId: run.id, nationalSystem, sourceFormat: format, blobKey: key, fileHash, byteSize, releaseVersion },
    });
    reply.code(202);
    return { runId: run.id };
  });

  /** Drop an object nothing will ever reference again. Contained and logged for the same reason
   *  every other best-effort side-write in this file is: it runs on a path that has already decided
   *  what to answer, and a failure here must not replace that answer with a different one. */
  async function discardBlob(key: string, why: string): Promise<void> {
    try {
      await ctx.blob.delete(key);
    } catch (err) {
      ctx.logger.error({ err, blobKey: key }, `failed to delete the stored object left by ${why}`);
    }
  }

  // Task 10: the run-history list — FAC-P1-03's "who imported which release and when", scoped to one
  // register or every register this instance has ever seen. Gated `facilities.view`, not `.manage`:
  // it is read-only, and an operator who can merely see the registry still benefits from knowing
  // whether/when it was last refreshed and by what.
  app.get('/api/facilities/import/runs', VIEW, async (req) => {
    const q = req.query as Record<string, unknown>;
    const runs = await importRuns.list(ownFirstString(q, 'nationalSystem'), parseLimit(q.limit));
    return { runs };
  });

  // ── A2b Task 5: the operator's confirm ────────────────────────────────────────────────────────
  //
  // The decision half of the background import. The worker validated an uploaded register and parked
  // the run at `awaiting_confirmation` with a summary; this route takes the operator's choices,
  // records them on the run, and hands it to the APPLY queue.
  //
  // ⛔ THIS ROUTE IS THE AUTHORISATION. `claimNext` selects on `status` alone, so the ONLY thing
  // standing between a validated file and a national register being rewritten is that the apply
  // worker claims `APPLY_PHASE.from` — a state nothing but the `confirm` call below ever writes. It
  // is not a flag on the row and not a field in `options` for exactly that reason: either could be
  // set by something that never asked an operator.
  //
  // 202, not 200: the register has NOT been imported when this returns — a worker will do that.
  app.post('/api/facilities/import/runs/:id/confirm', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ConfirmSchema.safeParse(req.body ?? {});
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const run = await importRuns.get(id);
    if (!run) { reply.code(404); return { error: `import run not found: ${id}` }; }

    // ⛔ `isApplicable`, the SAME predicate the inline route's `runId` guard asks — not a second
    // hand-written one, and not a `!== 'awaiting_confirmation'` literal. A confirm and an inline
    // apply are the same question ("may an apply start from this run?"), and A2a's Critical finding
    // was two guards answering it differently. It excludes an already-`confirmed` run too, so a
    // double-click cannot queue two applies.
    if (!isApplicable(run.status)) {
      reply.code(409);
      return { error: `import run ${id} is no longer applicable: status is "${run.status}"` };
    }

    // A DIFFERENT question from the status guard above, deliberately asked separately rather than
    // folded into it: `isApplicable` admits `previewed`, the state the INLINE A2a preview mints —
    // and that run carried its CSV in the request body and stored nothing. Confirming one would hand
    // the worker a run it can only fail, while taking it out of the state its own apply route needs.
    if (!run.blobKey) {
      reply.code(409);
      return {
        error: `import run ${id} has no stored file — it was previewed inline; `
          + 'apply it through POST /api/facilities/import carrying its runId',
      };
    }

    // The validate's own verdict, read ONCE and asked two different questions below. Both gates read
    // what `importFacilities` REPORTED rather than re-deriving it from the file — the file is not
    // even in this request.
    const summary = (run.summary ?? null) as {
      blocked?: unknown; blockedReason?: unknown; unknownColumns?: unknown; invalid?: unknown;
    } | null;

    // ⛔ THE PARSE-OVERRIDE GATE (whole-branch review I2). `allowUnknownColumns` and
    // `allowInvalidCoordinates` are fed straight to the PARSER (`parseOpts` in facility-import.ts),
    // so they decide which rows become records at all — and the summary this operator is confirming
    // was computed by a validate that ran with whatever the RUN already carried. Accepting a
    // different value here would make the apply classify a different record set than the one that was
    // approved, with nothing re-validating it and nothing re-showing it.
    //
    // ⛔ THIS IS NOT A TIDINESS RULE. Worst case, reachable through the API alone: a
    // `completeRelease=true` upload carrying one unrecognised column validates to `parsed: 0` and
    // `absent: null` — NOT EVALUATED — and still PARKS, because unknown columns set no
    // `blockedReason` and the gate below therefore passes it. A confirm carrying
    // `{ allowUnknownColumns: true, onAbsent: 'retire' }` would then parse the whole file, measure
    // absence across the WHOLE register, and retire everything the file omits — authorised against a
    // summary that measured none of it.
    //
    // ⛔ REFUSED ONLY WHERE THE OVERRIDE HAS SOMETHING TO ACT ON, which is what makes this exact
    // rather than merely strict. Both parser flags are inert unless the file actually contains the
    // thing they wave through, and `parseFacilityCsv` reports both populations UNCONDITIONALLY —
    // `unknownColumns` off the header row, `invalid` pushed before the drop ("Reported unconditionally;
    // DROPPED only without the override", facility-csv.ts) — so the stored summary answers "would
    // this flag have changed the parse?" for the file that was actually validated, in either
    // direction. An empty (or absent) population means the answer is no, and refusing then would
    // reject a confirm that could not have changed anything.
    //
    // ⚠ `allowMalformedRows` is deliberately NOT in this list and must stay out: it is read only by
    // the `blockedReason` decision, never by the parser, so it changes the VERDICT on a record set
    // and not the record set itself. It is the documented override for a `quarantined-rows` block,
    // which the gate immediately below relies on.
    //
    // The overrides that DO change the parse belong to the upload, which is the request that runs
    // before the classification — see its `parseOverrides`.
    // ⛔ AND THE FORMAT DECIDES HALF OF IT. `allowUnknownColumns` is a documented NO-OP for JSONL:
    // `parseFacilityRelease` (packages/terminology/src/facility-release.ts) never reads
    // `opts.allowUnknownColumns` at all — verified by reading that function, not by trusting its
    // docblock — because every JSONL line is a self-describing object, so an unrecognised key cannot
    // shift any other field the way an unrecognised CSV header can. It still REPORTS `unknownColumns`,
    // so a JSONL run's summary populates the list without the flag ever having had anything to act
    // on, and refusing there would reject a confirm over a flag that provably cannot change the
    // parse — while the message told the operator to re-upload with it. `allowInvalidCoordinates` has
    // NO such asymmetry: both parsers honour it (facility-release.ts's `row` branch and
    // facility-csv.ts alike), so it stays in play for either format.
    //
    // ⚠ Written `!== 'jsonl'` rather than `=== 'csv'` so it FAILS CLOSED: a third source format added
    // later is refused until someone has established what the flag does to it, which is the safe
    // direction for a gate whose failure mode is authorising an unreviewed retirement.
    const storedOptions = (run.options as Record<string, unknown> | null) ?? {};
    const nonEmptyList = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
    const inPlay: Record<'allowUnknownColumns' | 'allowInvalidCoordinates', boolean> = {
      allowUnknownColumns: nonEmptyList(summary?.unknownColumns) && run.sourceFormat !== 'jsonl',
      allowInvalidCoordinates: nonEmptyList(summary?.invalid),
    };
    const parseChanging = (['allowUnknownColumns', 'allowInvalidCoordinates'] as const)
      .filter((k) => inPlay[k] && k in p.data && !!p.data[k] !== !!storedOptions[k]);
    if (parseChanging.length > 0) {
      reply.code(409);
      return {
        error: `import run ${id} cannot be confirmed with ${parseChanging.join(', ')}: `
          + 'that changes how the file parses, and the summary being confirmed was computed without '
          + 'it — re-upload the file with that option on the upload request, so the validation you '
          + 'review is the one that gets applied',
      };
    }

    // ⛔ THE BLOCKED GATE, and it READS the importer's own verdict rather than re-deriving it.
    // `importFacilities` reports `blocked`/`blockedReason` precisely so its consumers stop rebuilding
    // the predicate (see `FacilityImportResult.blocked`); the worker stored that verdict on the run,
    // and A2b Task 4 pinned that a blocked file still PARKS — the operator is entitled to see the
    // reconciliation result. Refusing it is THIS route's job.
    //
    // ⚠ `'quarantined-rows'` is overridable and `'duplicate-columns'` is not — the override family
    // `allowMalformedRows` belongs to, and the reason `blockedReason` is a machine token at all.
    // Fail-closed: a reason this does not recognise is refused, so a blocked reason added later
    // cannot be waved through by omission.
    if (summary?.blocked === true) {
      const overridden = summary.blockedReason === 'quarantined-rows' && p.data.allowMalformedRows === true;
      if (!overridden) {
        reply.code(409);
        return {
          error: `import run ${id} cannot be applied: the file is blocked (${String(summary.blockedReason)})`
            + (summary.blockedReason === 'quarantined-rows'
              ? ' — confirm with allowMalformedRows to import the rest of the file anyway'
              : ''),
        };
      }
    }

    // ⛔ Only the keys the operator actually sent reach the durable record. A decision nobody made,
    // stored as though they had, is the shape of defect FAC-P1-03 names one layer up — and every one
    // of these options is defaulted by `importFacilities` itself, so recording an unsent one buys
    // nothing and asserts something false.
    //
    // ⚠ MEASURED, because the obvious belief is wrong and this line was written twice on it: zod does
    // NOT put an omitted `.optional()` key into its output as `undefined` — it omits the key. A
    // `{ onConflict: 'skip' }` body parses to an object whose own keys are exactly `['onConflict']`
    // (printed from this line). So the `Object.entries(...).filter(v !== undefined)` this used to be
    // was dead code that could never remove anything, and the property is really held by the SCHEMA:
    // keep these `.optional()`, never `.default(...)`, or an unsent choice starts being recorded.
    const chosen = { ...p.data };
    // Stored first, choices after: the upload recorded `{ nationalSystem }`, the register identity
    // `active_key` locks on, and a client cannot be allowed to overwrite it — `ConfirmSchema` has no
    // such key, so nothing in `chosen` can. The worker additionally re-imposes it off the run row.
    const options = { ...storedOptions, ...chosen };

    // Compare-and-swap on the status just read — see the store's own note. `false` means the run
    // moved between the read above and this write (a newer upload superseded it, releasing its
    // register), so reporting 202 would promise an apply that will never run.
    if (!(await importRuns.confirm(id, run.status, options))) {
      reply.code(409);
      return { error: `import run ${id} was taken over before it could be confirmed` };
    }

    // ⛔ The only place the CONFIRMING operator is recorded. `facility_import_runs.requested_by` is
    // whoever UPLOADED, and there is no column for whoever confirmed — while the actual write is
    // performed later by a worker with no request behind it, which audits `facility.import` as the
    // system. Without this entry the decision that authorised a national register's rewrite would
    // have no actor anywhere.
    await recordAudit(ctx, req, {
      action: 'facility.import.confirmed',
      entityType: 'facility',
      entityId: run.nationalSystem,
      before: null,
      after: null,
      metadata: { runId: id, nationalSystem: run.nationalSystem, options },
    });

    reply.code(202);
    return { runId: id, status: APPLY_PHASE.from };
  });

  // A2b Task 6: ask an import run to stop.
  //
  // ⛔ THIS ROUTE'S ONLY HARD RULE IS THAT IT DOES NOT OVERSTATE WHAT HAPPENED, and the two success
  // codes exist to keep that honest — the store answers a DIFFERENT question depending on whether
  // anything is actually listening:
  //
  //   200 `cancelled` — the run was in a state NO worker claims (`awaiting_confirmation`, the state
  //     every background run parks in; or `previewed`, the inline path's). Nothing would ever have
  //     read a flag set on it, so `requestCancel` carries the cancellation out itself: the run is
  //     terminal and its register released. Saying "cancelled" here is a fact, not a forecast.
  //   202 `requested` — a worker holds the run (`validating`/`applying`). The flag is observed at
  //     phase boundaries and CANNOT interrupt the running transaction, so an apply already inside
  //     its write will finish and the run will end `applied`. That is the truthful outcome and the
  //     operator must not be told otherwise, which is why this is not 200 and not `cancelled`.
  //
  // ⛔ 409 for a terminal run rather than a cheerful no-op: a cancel arriving after the write is a
  // request that CANNOT be honoured, and an applied run stays applied. Reporting success would tell
  // an operator a national register had not been imported when it had.
  app.post('/api/facilities/import/runs/:id/cancel', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };

    const outcome = await importRuns.requestCancel(id);
    if (outcome === 'not-found') { reply.code(404); return { error: `import run not found: ${id}` }; }
    if (outcome === 'already-terminal') {
      reply.code(409);
      return { error: `import run ${id} has already finished and cannot be cancelled` };
    }

    // Audited on both live outcomes, and the action records which one — an operator asking a running
    // import to stop is a decision worth an actor even when the import goes on to finish anyway.
    await recordAudit(ctx, req, {
      action: 'facility.import.cancelled',
      entityType: 'facility',
      entityId: id,
      before: null,
      after: null,
      metadata: { runId: id, outcome },
    });

    reply.code(outcome === 'cancelled' ? 200 : 202);
    return { runId: id, outcome };
  });

  // One run's full detail — the preview summary an operator reviews before confirming an apply, or
  // the record of one that already happened. Same static-vs-parametric non-issue as the other
  // `/api/facilities/*` routes above: `import/runs/:id` carries a different segment count than
  // `/api/facilities/:id`, so the two can never collide regardless of registration order.
  app.get('/api/facilities/import/runs/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await importRuns.get(id);
    if (!run) { reply.code(404); return { error: 'not found' }; }
    return run;
  });
}
