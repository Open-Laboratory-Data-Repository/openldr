import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  importFacilities, scanObservedFacilities, resolveObservedFacilities, publishFacilityMap, projectRegistryRows,
  retireRegistryConcepts, reprojectAfterRegistryDelete, listFacilityMappingConflicts,
  type AppContext, type FacilityImportResult, type ScanResult, type PublishResult,
} from '@openldr/bootstrap';
import {
  splitFacilityAnswers, CORE_FACILITY_KEYS, FACILITY_ADMIN_LEVELS, referenceCapture,
  FACILITY_REGISTRY_SYSTEM,
} from '@openldr/db';
import type { FacilityAdminLevel, ExternalSchema } from '@openldr/db';
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
// the deleted per-row capture path did, but it is still real, row-count-proportional work sitting
// inside one HTTP request — a client timeout or a proxy's own request deadline can still abort the
// connection while a large enough apply keeps running server-side.
//
// Decision: bound APPLY to a row-count cap and point the operator at the CLI
// (`openldr facilities import --apply`, packages/cli/src/facilities.ts) above it — the CLI runs
// the identical `importFacilities` call with no request deadline. 2000 stays a generous bound for
// the common case (a district- or council-scoped partial register, the routine incremental update)
// without ever touching the CLI, while keeping the worst case — a full re-import's CSV parse,
// batched write, and registry projection, all synchronous in one request — well clear of a client
// or proxy timeout. This is NOT a background-job system — a request over the cap is simply
// refused, nothing is queued. A dry run (no `apply`) is exempt: it never opens a transaction (or
// projects), so a 14 000-row register can always be PREVIEWED inline regardless of this cap.
const MAX_INLINE_APPLY_ROWS = 2000;

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
  // The caller opts IN to writing (mirrors the CLI's `--apply`). Omitted/false ⇒ dry run: parse
  // and report, write NOTHING — the default, so a 14 000-row register can never be silently
  // rewritten by a client that forgot to set this.
  apply: z.boolean().optional(),
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
type ResolvedForm = { fields: FieldRef[]; targetPages: unknown };

/** Resolve the submitted form so `apiProperty` and `targetPages` can be read. Returns
 *  `{ fields: [], targetPages: null }` both when no form id was submitted AND when the id does not
 *  resolve — callers MUST treat an empty field list as "the form could not be resolved" and refuse
 *  to write, never as "no core fields, everything is extras" (see the empty-field-list guards in
 *  POST/PUT below). */
async function resolveForm(ctx: AppContext, formSchemaId: string | null | undefined): Promise<ResolvedForm> {
  if (!formSchemaId) return { fields: [], targetPages: null };
  const def = await ctx.forms.get(formSchemaId);
  if (!def) return { fields: [], targetPages: null };
  const schema = def.schema as { fields?: FieldRef[] } | undefined;
  return { fields: schema?.fields ?? [], targetPages: def.targetPages ?? null };
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

export function registerFacilitiesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/facilities', VIEW, async (req) => {
    const q = req.query as Record<string, unknown>;
    return ctx.facilityRegistry.list({
      // A repeated query param (`?region=A&region=B`) arrives as an array; only a plain string is a
      // valid filter value, so anything else is treated as "not specified" rather than reaching
      // Kysely as `where(col, '=', [...])`. `ownFirstString` (not `firstString(q.region)` directly)
      // additionally keeps this reading only `q`'s OWN properties — see its doc comment.
      region: ownFirstString(q, 'region'),
      district: ownFirstString(q, 'district'),
      council: ownFirstString(q, 'council'),
      status: ownFirstString(q, 'status'),
      limit: parseLimit(q.limit),
    });
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

  app.post('/api/facilities', MANAGE, async (req, reply) => {
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const { fields, targetPages } = await resolveForm(ctx, p.data.formSchemaId);
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

    // Only the write itself is guarded — an error from `recordAudit` below must never be mapped
    // as if it came from `upsert` (e.g. a 23505 from the audit table mis-reported to the client as
    // "a facility with that local code already exists" after the facility row already committed).
    let created;
    try {
      // ⛔ The id is ALWAYS generated here. The CSV importer derives ids deterministically from
      // sha256(nationalSystem|nationalCode), so a client-chosen id could collide with an imported
      // row and silently overwrite it.
      created = await ctx.facilityRegistry.upsert({
        ...record,
        id: randomUUID(),
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

    const { fields, targetPages } = await resolveForm(ctx, p.data.formSchemaId);
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

    await reprojectAfterRegistryDelete(deps, {
      id,
      localCode: before.localCode ?? null,
      nationalCode: before.nationalCode ?? null,
    });

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

    // Fix 1 (mapping-ux report): `admin` lets `importFacilities` project every written row into
    // FACILITY_REGISTRY_SYSTEM — the Facilities-page upload gets the same immediate-mapping
    // behaviour as a single facility create/update (POST/PUT above) and the CLI.
    // Task 5: `facilityJobs` lets an applied import enqueue the same `facility-map-rebuild` job a
    // single create/update/delete does (see importFacilities' own matching comment for why that is
    // a single call per import already, not per row).
    const deps = { db: ctx.internalDb, capture: referenceCapture, admin: ctx.terminology.admin, facilityJobs: ctx.facilityJobs };
    const importOpts = {
      nationalSystem: p.data.nationalSystem,
      allowUnknownColumns: p.data.allowUnknownColumns,
      allowMalformedRows: p.data.allowMalformedRows,
    };

    // Always preview first (parse-only — importFacilities never opens a transaction when
    // `apply` is falsy, see its own early-return). This gives an AUTHORITATIVE `parsed` count —
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
    let preview: FacilityImportResult;
    try {
      preview = await importFacilities(deps, p.data.csv, { ...importOpts, apply: false });
    } catch (err) {
      if (!isCsvParseError(err)) throw err;
      reply.code(400);
      return { error: err.message };
    }
    if (!p.data.apply || preview.parsed === 0) return preview;

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

    // ⛔ Wrapped for the same reason as the preview call above. In practice the preview call
    // above already parsed this exact `p.data.csv` successfully (a malformed file would have been
    // caught and returned as a 400 before this line is ever reached), so `parseFacilityCsv`
    // itself will not throw a second time here — this guard exists so the apply path does not
    // silently regress to a raw 500 if that assumption ever stops holding (e.g. a future change
    // that lets the two calls see different input), not because it is expected to fire today. A
    // non-parse error (a DB failure from the write transaction this call opens) is rethrown
    // unchanged, exactly as before this fix — it must still surface as a 500, never a 400.
    let result: FacilityImportResult;
    try {
      result = await importFacilities(deps, p.data.csv, { ...importOpts, apply: true });
    } catch (err) {
      if (!isCsvParseError(err)) throw err;
      reply.code(400);
      return { error: err.message };
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
}
