import { type Kysely } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// Mirrors @openldr/terminology's RESULT_PARAM_SYSTEM (packages/terminology/src/loaders/result-parameters.ts).
// packages/db cannot import that constant — @openldr/terminology depends on @openldr/db, not the
// other way around, so importing it here would create a circular package dependency.
const RESULT_PARAM_SYSTEM = 'urn:openldr:default_result';
const PUB = 'pub-system';

interface SeedValueSet {
  slug: string;
  title: string;
  description: string;
  compose: VsCompose;
}

// ⚠ These three ValueSets classify a site's result-parameter dictionary (PARMDICT-style), which is
// imported separately (Task 1's loader) — its concepts do not exist yet when this migration runs.
// Two of the three are intensional (`filter`, not `concept`), and the third ("the dictionary's own
// scope") is a whole-system include with neither `concept` nor `filter`. None of them can have a
// materialized expansion here: `valueset_expansions` rows and `expanded_at` are deliberately left
// unset. Recomputing the expansion, once concepts exist, is Task 4's job.
const SEEDS: SeedValueSet[] = [
  {
    slug: 'result-observation',
    title: 'Result Observation Codes',
    description: 'Every code in the site result-parameter dictionary (urn:openldr:default_result), regardless of result_role.',
    compose: { include: [{ system: RESULT_PARAM_SYSTEM }] },
  },
  {
    slug: 'reportable-result',
    title: 'Reportable Result Codes',
    description: "Codes whose result_role is 'result' — fill the clinical report's results table.",
    compose: { include: [{ system: RESULT_PARAM_SYSTEM, filter: [{ property: 'result_role', op: '=', value: 'result' }] }] },
  },
  {
    slug: 'non-reportable',
    title: 'Non-Reportable Codes',
    // ⚠ TWO include clauses, which UNION — not one clause with two filters, which would INTERSECT
    // and yield the empty set (no concept is both 'metadata' and 'admin'). `specimen` is deliberately
    // absent: it is displayed, just in a different band of the clinical report.
    description: "Codes whose result_role is 'metadata' or 'admin' — appear nowhere on the clinical report.",
    compose: {
      include: [
        { system: RESULT_PARAM_SYSTEM, filter: [{ property: 'result_role', op: '=', value: 'metadata' }] },
        { system: RESULT_PARAM_SYSTEM, filter: [{ property: 'result_role', op: '=', value: 'admin' }] },
      ],
    },
  },
];

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;

  for (const s of SEEDS) {
    const url = `urn:openldr:valueset:${s.slug}`;
    const id = `vs-${s.slug}`;

    await seedDb.insertInto('value_sets').values({
      id,
      url,
      version: null,
      name: s.slug,
      title: s.title,
      status: 'active',
      experimental: false,
      description: s.description,
      compose: JSON.stringify(s.compose) as never,
      immutable: false,
      category: null,
      publisher_id: PUB,
      expanded_at: null,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

    const resource = valueSetToFhirResource({
      id, url, status: 'active', experimental: false, version: null,
      name: s.slug, title: s.title, description: s.description, compose: s.compose,
    });
    // ⚠ `fhir_resources` was relocated to the `fhir` schema by migration 045 (the FHIR storage
    // CQRS pivot) — it must be addressed as `fhir.fhir_resources` here, not the bare (now
    // nonexistent) `public.fhir_resources` that 014 (written pre-045) still targets.
    //
    // We write ONLY the canonical row — no `fhir.resource_history`, no `fhir.change_log`.
    // ⚠ That is normally a defect: a canonical row with no change_log entry is invisible to the
    // incremental projection (it reads `where seq > cursor`), which is exactly why migration 014's
    // seeded ValueSets never reached the warehouse and needed an `openldr terminology reproject`
    // backfill. It is safe HERE for one specific reason: these three sets are seeded with NO
    // expansion, so `projectValueSet` emits zero rows — there is no content to lose. The moment
    // concepts exist, the re-expansion goes through `valueSets.save()` → `refreshCacheAndProject`
    // → `fhirStore.save()`, which DOES write a change_log row and projects normally.
    // ⇒ If you ever seed a set here WITH an expansion, this comment stops applying.
    // `version`/`version_id` are left to their defaults; because no history row is written,
    // `save()`'s `max(version)+1` yields 1, matching the seeded default — no version skew.
    await seedDb.insertInto('fhir.fhir_resources').values({
      id, resource_type: 'ValueSet', resource: JSON.stringify(resource),
    } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

    await seedDb.insertInto('terminology_systems').values({
      url, version: null, kind: 'ValueSet', resource_id: id,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  const urls = SEEDS.map((s) => `urn:openldr:valueset:${s.slug}`);
  const ids = SEEDS.map((s) => `vs-${s.slug}`);

  await seedDb.deleteFrom('terminology_systems').where('url', 'in', urls).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', 'in', ids).execute();
  await seedDb.deleteFrom('value_sets').where('url', 'in', urls).execute();
}
