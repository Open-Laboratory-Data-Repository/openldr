import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { splitFacilityAnswers, CORE_FACILITY_KEYS, FACILITY_ADMIN_LEVELS } from '@openldr/db';
import type { FacilityAdminLevel } from '@openldr/db';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const VIEW = { preHandler: requireCapability('facilities.view') };
const MANAGE = { preHandler: requireCapability('facilities.manage') };

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

  app.get('/api/facilities/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await ctx.facilityRegistry.get(id);
    if (!rec) { reply.code(404); return { error: 'not found' }; }
    return rec;
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

    await recordAudit(ctx, req, { action: 'facility.create', entityType: 'facility', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
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
        ...before, ...record, ...nulls, id, name: record.name ?? before.name, extras,
        // An edit never changes who manages the row.
        managedOrigin: before.managedOrigin, source: before.source,
      } as never);
    } catch (err) {
      return mapFacilityDbError(err, reply);
    }

    await recordAudit(ctx, req, { action: 'facility.update', entityType: 'facility', entityId: id, before, after });
    return after;
  });

  app.delete('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.facilityRegistry.remove(id);
    await recordAudit(ctx, req, { action: 'facility.delete', entityType: 'facility', entityId: id, before, after: null });
    return { ok: true };
  });
}
