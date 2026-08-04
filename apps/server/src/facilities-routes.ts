import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { splitFacilityAnswers, CORE_FACILITY_KEYS } from '@openldr/db';
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
 *  below). `targetPages` is typed `unknown` here — not `FormDefinition['targetPages']` — on
 *  purpose: it flows straight from whatever `ctx.forms.get()` handed back into a boundary function
 *  that normalizes it, so a differently-shaped store (a test double, or a future store revision)
 *  degrades to "not the facilities form" instead of a thrown TypeError. */
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
  return { fields: schema?.fields ?? [], targetPages: (def as { targetPages?: unknown }).targetPages ?? null };
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
 * below. The branch exists only because `AppContext['forms']` is a wide store type and this
 * function is handed whatever a caller's `ctx.forms.get()` returns at runtime, not a value this
 * module controls end to end; a test double or a future store revision that instead forwards the
 * raw column value degrades to a normal array check rather than crashing or silently accepting
 * a string that happens to contain the substring "facilities".
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
      // Kysely as `where(col, '=', [...])`.
      region: firstString(q.region),
      district: firstString(q.district),
      council: firstString(q.council),
      status: firstString(q.status),
      limit: parseLimit(q.limit),
    });
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
