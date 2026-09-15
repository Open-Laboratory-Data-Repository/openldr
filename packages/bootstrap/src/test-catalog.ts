import { sql, type Kysely } from 'kysely';
import { markTerminologyChanged, type InternalSchema, type TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM, type Operations } from '@openldr/terminology';

// The national test catalog, slice S1 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.2).
// The route and the `openldr test-catalog` CLI both call this module, so they share every rule
// (AGENTS.md section 6).
//
// The catalog is a CE-owned code system. Each test is a concept: code, display, status, and the
// properties shortName, category and specimenTypes. Its LOINC code is a term mapping, not a property.
// This install's own settings for a test live in test_catalog_lab_settings, which sync never writes.

/** Must equal CATALOG_SYSTEM in migration 104. */
export const TEST_CATALOG_SYSTEM = 'urn:openldr:codesystem:test-catalog';
/** Must equal CATEGORY_SYSTEM in migration 104. */
export const TEST_CATEGORY_SYSTEM = 'urn:openldr:codesystem:test-category';
/** A test's category must be a code in this ValueSet. Must equal CATEGORY_VALUE_SET in migration 104. */
export const TEST_CATEGORY_VALUE_SET = 'urn:openldr:valueset:test-category';
/** A test's specimens must come from the list the Lab order's specimen picker offers
 *  (packages/forms/src/samples/forms.ts), or narrowing at data entry could never match. */
export const SPECIMEN_TYPE_VALUE_SET = 'urn:openldr:valueset:specimen-type';

/** The map type of a test's LOINC link. concept_map_elements stores it as the equivalence. */
const LOINC_MAP_TYPE = 'SAME-AS' as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
/** Terminology's statuses are ACTIVE, DRAFT, DEPRECATED and DISABLED, and the Terminology page accepts
 *  nothing else (apps/server/src/terminology-admin-routes.ts), so a retired test is stored as DEPRECATED. */
const RETIRED_STATUS = 'DEPRECATED';
const LOINC_CODE = /^\d{1,7}-\d$/;

export interface SpecimenCoding {
  system: string;
  code: string;
}

export interface CatalogTest {
  code: string;
  display: string;
  shortName: string | null;
  category: string | null;
  specimenTypes: SpecimenCoding[];
  loinc: string | null;
  /** false when the test is retired. */
  active: boolean;
  /** This install's own settings. specimenTypes null means "use the catalog's list". */
  lab: { enabled: boolean; specimenTypes: SpecimenCoding[] | null; localDisplay: string | null };
}

export interface CatalogListQuery {
  q?: string;
  category?: string;
  loinc?: 'linked' | 'none';
  enabled?: boolean;
  status: 'active' | 'retired' | 'all';
  limit: number;
  offset: number;
}

export interface CatalogListResult {
  rows: CatalogTest[];
  total: number;
  /** false when this install received its catalog from central and may not change its tests. */
  ownedHere: boolean;
}

/** A whole test, as the edit sheet sends it. A field left out is cleared. */
export interface CatalogTestInput {
  /** The national code. Optional on create, where a test with none takes its LOINC code. Fixed once saved. */
  code?: string | null;
  display: string;
  shortName?: string | null;
  category?: string | null;
  specimenTypes?: SpecimenCoding[];
  loinc?: string | null;
  /** false retires the test. Retiring is reversible. Defaults to true. */
  active?: boolean;
}

export interface LabSettingsInput {
  enabled: boolean;
  /** null means "use the catalog's list". A list may only narrow it. */
  specimenTypes: SpecimenCoding[] | null;
  localDisplay: string | null;
}

export class TestCatalogError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'not-found' | 'conflict' | 'central-managed') {
    super(message);
    this.name = 'TestCatalogError';
  }
}

export interface TestCatalog {
  ownedHere(): Promise<boolean>;
  list(query: CatalogListQuery): Promise<CatalogListResult>;
  get(code: string): Promise<CatalogTest | null>;
  create(input: CatalogTestInput): Promise<CatalogTest>;
  update(code: string, input: CatalogTestInput): Promise<CatalogTest>;
  setLabSettings(code: string, input: LabSettingsInput): Promise<CatalogTest>;
}

export interface TestCatalogDeps {
  db: Kysely<InternalSchema>;
  admin: TerminologyAdminStore;
  ops: Operations;
}

/**
 * Read list filters from a query string or from CLI flags. GET /api/test-catalog and
 * `openldr test-catalog list` both call this, so a bad value is refused in the same words at either door.
 */
export function parseCatalogListQuery(raw: Record<string, unknown>): { ok: true; query: CatalogListQuery } | { ok: false; error: string } {
  const str = (key: string): string | undefined => {
    const v = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const loinc = str('loinc');
  if (loinc !== undefined && loinc !== 'linked' && loinc !== 'none') return { ok: false, error: 'loinc must be "linked" or "none"' };
  const enabled = str('enabled');
  if (enabled !== undefined && enabled !== 'on' && enabled !== 'off') return { ok: false, error: 'enabled must be "on" or "off"' };
  const status = str('status') ?? 'active';
  if (status !== 'active' && status !== 'retired' && status !== 'all') return { ok: false, error: 'status must be "active", "retired" or "all"' };
  const limitText = str('limit');
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetText = str('offset');
  const offset = offsetText === undefined ? 0 : Number(offsetText);
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number, 0 or more' };

  const query: CatalogListQuery = { status, limit, offset };
  const text = str('q');
  if (text !== undefined) query.q = text;
  const category = str('category');
  if (category !== undefined) query.category = category;
  if (loinc !== undefined) query.loinc = loinc;
  if (enabled !== undefined) query.enabled = enabled === 'on';
  return { ok: true, query };
}

type ConceptRow = { code: string; display: string | null; status: string | null; properties: unknown };
type LabRow = { code: string; enabled: boolean; specimen_types: unknown; local_display: string | null };

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toCodings(value: unknown): SpecimenCoding[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => !!c && typeof c === 'object' && typeof c.system === 'string' && typeof c.code === 'string')
    .map((c: SpecimenCoding) => ({ system: c.system, code: c.code }));
}

function toTest(c: ConceptRow, loinc: string | null, lab: LabRow | undefined): CatalogTest {
  const p = (parseJson(c.properties) ?? {}) as Record<string, unknown>;
  return {
    code: c.code,
    display: c.display ?? c.code,
    shortName: typeof p.shortName === 'string' ? p.shortName : null,
    category: typeof p.category === 'string' ? p.category : null,
    specimenTypes: toCodings(p.specimenTypes),
    loinc,
    // NULL counts as ACTIVE, as it does everywhere else in terminology. DEPRECATED is how this
    // catalog stores a retired test; a DRAFT or DISABLED concept made on the Terminology page also
    // reads as not active.
    active: c.status === 'ACTIVE' || c.status === null,
    lab: {
      enabled: lab?.enabled ?? false,
      specimenTypes: lab && lab.specimen_types !== null ? toCodings(lab.specimen_types) : null,
      localDisplay: lab?.local_display ?? null,
    },
  };
}

type ValidTest = {
  display: string;
  shortName: string | null;
  category: string | null;
  specimenTypes: SpecimenCoding[];
  loinc: string | null;
  active: boolean;
};

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function codingKey(c: SpecimenCoding): string {
  return `${c.system}|${c.code}`;
}

/** Drop repeats, keeping the first of each, in the order given. */
function uniqueCodings(list: SpecimenCoding[]): SpecimenCoding[] {
  const seen = new Set<string>();
  const out: SpecimenCoding[] = [];
  for (const c of list) {
    const key = codingKey(c);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ system: c.system, code: c.code });
    }
  }
  return out;
}

export function createTestCatalog(deps: TestCatalogDeps): TestCatalog {
  const { db } = deps;

  async function ownedHere(): Promise<boolean> {
    // A lab that has pulled central's catalog has this row stamped 'central' by its terminology drain
    // (packages/sync/src/terminology-sync.ts). Central, a standalone lab and a lab that never pulled
    // own their catalog.
    const row = await db.selectFrom('terminology_systems').select('managed_origin')
      .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirst();
    return row?.managed_origin !== 'central';
  }

  async function readTests(code?: string): Promise<CatalogTest[]> {
    let concepts = db.selectFrom('terminology_concepts')
      .select(['code', 'display', 'status', 'properties'])
      .where('system', '=', TEST_CATALOG_SYSTEM);
    let links = db.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', TEST_CATALOG_SYSTEM)
      .where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', LOINC_MAP_TYPE)
      .where('is_active', '=', true);
    let labs = db.selectFrom('test_catalog_lab_settings').select(['code', 'enabled', 'specimen_types', 'local_display']);
    if (code !== undefined) {
      concepts = concepts.where('code', '=', code);
      links = links.where('from_code', '=', code);
      labs = labs.where('code', '=', code);
    }
    // Codes are unique within the system, so ordering by code alone gives a stable page (AGENTS.md section 7).
    const rows = await concepts.orderBy('code').execute();
    const loincByCode = new Map((await links.execute()).map((l) => [l.from_code, l.to_code]));
    const labByCode = new Map((await labs.execute()).map((l) => [l.code, l as LabRow]));
    return rows.map((r) => toTest(r, loincByCode.get(r.code) ?? null, labByCode.get(r.code)));
  }

  async function list(query: CatalogListQuery): Promise<CatalogListResult> {
    // The catalog is capped at a few thousand tests (spec 4.4), so it is read whole and filtered
    // here. The search spans four fields, one of them from the lab settings table.
    const needle = query.q?.toLowerCase();
    const matched = (await readTests()).filter((t) => {
      if (query.status === 'active' && !t.active) return false;
      if (query.status === 'retired' && t.active) return false;
      if (query.category !== undefined && t.category !== query.category) return false;
      if (query.loinc === 'linked' && t.loinc === null) return false;
      if (query.loinc === 'none' && t.loinc !== null) return false;
      if (query.enabled !== undefined && t.lab.enabled !== query.enabled) return false;
      if (needle) {
        const text = [t.code, t.display, t.shortName ?? '', t.lab.localDisplay ?? ''].join('\n').toLowerCase();
        if (!text.includes(needle)) return false;
      }
      return true;
    });
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      ownedHere: await ownedHere(),
    };
  }

  async function get(code: string): Promise<CatalogTest | null> {
    return (await readTests(code))[0] ?? null;
  }

  function invalid(message: string): TestCatalogError {
    return new TestCatalogError(message, 'invalid');
  }

  function notFound(code: string): TestCatalogError {
    return new TestCatalogError(`Test ${code} is not in the catalog.`, 'not-found');
  }

  async function refuseUnlessOwned(): Promise<void> {
    if (!(await ownedHere())) {
      throw new TestCatalogError(
        'This catalog comes from central, so only central can change its tests. This lab can switch tests '
          + 'on or off, narrow their specimens and set a local name.',
        'central-managed',
      );
    }
  }

  async function expandCodes(url: string): Promise<SpecimenCoding[]> {
    const vs = await deps.ops.expand(url, { count: 100_000 });
    return (vs.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '' }));
  }

  async function loincLoaded(): Promise<boolean> {
    // Linking a test to a LOINC code that is not loaded stubs a DRAFT concept (terminology-admin-store.ts,
    // termMappings.create and saveExclusive), so DRAFT rows alone do not mean LOINC is loaded.
    const row = await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', LOINC_SYSTEM)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async function checkLoinc(code: string): Promise<void> {
    if (!LOINC_CODE.test(code)) throw invalid(`"${code}" is not a LOINC code. LOINC codes look like 12345-6.`);
    // With no LOINC loaded, only the format can be checked.
    if (!(await loincLoaded())) return;
    const hit = await db.selectFrom('terminology_concepts').select('status')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', code).executeTakeFirst();
    if (!hit || hit.status === 'DRAFT') throw invalid(`LOINC code ${code} is not in the LOINC loaded on this install.`);
  }

  async function validate(input: CatalogTestInput): Promise<ValidTest> {
    const display = clean(input.display);
    if (!display) throw invalid('A test needs a name.');
    const category = clean(input.category);
    if (category && !(await expandCodes(TEST_CATEGORY_VALUE_SET)).some((c) => c.code === category)) {
      throw invalid(`Category ${category} is not in the test category list.`);
    }
    const specimenTypes = uniqueCodings(input.specimenTypes ?? []);
    if (specimenTypes.length) {
      const offered = new Set((await expandCodes(SPECIMEN_TYPE_VALUE_SET)).map(codingKey));
      const missing = specimenTypes.find((s) => !offered.has(codingKey(s)));
      if (missing) throw invalid(`Specimen ${missing.code} (${missing.system}) is not in the specimen type list.`);
    }
    const loinc = clean(input.loinc);
    if (loinc) await checkLoinc(loinc);
    return { display, shortName: clean(input.shortName), category, specimenTypes, loinc, active: input.active ?? true };
  }

  async function storedConcept(code: string): Promise<{ properties: unknown } | undefined> {
    return db.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code).executeTakeFirst();
  }

  async function writeConcept(code: string, t: ValidTest, stored: unknown): Promise<void> {
    // Keep every key this catalog does not manage, as terms.update does since test catalog S0.
    const parsed = parseJson(stored);
    const next: Record<string, unknown> = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
    delete next.shortName;
    delete next.category;
    delete next.specimenTypes;
    if (t.shortName) next.shortName = t.shortName;
    if (t.category) next.category = t.category;
    if (t.specimenTypes.length) next.specimenTypes = t.specimenTypes;
    const properties = Object.keys(next).length ? JSON.stringify(next) : null;
    await db.insertInto('terminology_concepts').values({
      system: TEST_CATALOG_SYSTEM, code, display: t.display,
      status: t.active ? 'ACTIVE' : RETIRED_STATUS,
      properties: properties as never,
    }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
      display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
    }))).execute();
    // One terminology_system signal per edit, as terms.create does, so labs pull the change.
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
  }

  async function writeLoincLink(code: string, loinc: string | null): Promise<void> {
    const current = (await deps.admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, code))
      .find((m) => m.toSystem === LOINC_SYSTEM && m.mapType === LOINC_MAP_TYPE && m.isActive);
    if (loinc && current?.toCode !== loinc) {
      // saveExclusive keeps one active LOINC link per test and deactivates the old one.
      await deps.admin.termMappings.saveExclusive({
        fromSystem: TEST_CATALOG_SYSTEM, fromCode: code, toSystem: LOINC_SYSTEM, toCode: loinc,
        toDisplay: null, mapType: LOINC_MAP_TYPE, isActive: true,
      });
    } else if (!loinc && current) {
      const { id, ...rest } = current;
      await deps.admin.termMappings.update(id, { ...rest, isActive: false });
    }
  }

  async function saved(code: string): Promise<CatalogTest> {
    const test = await get(code);
    if (!test) throw notFound(code);
    return test;
  }

  async function create(input: CatalogTestInput): Promise<CatalogTest> {
    await refuseUnlessOwned();
    const t = await validate(input);
    const code = clean(input.code) ?? t.loinc;
    if (!code) throw invalid('A test needs a national code or a LOINC code.');
    if (await storedConcept(code)) throw new TestCatalogError(`Test ${code} is already in the catalog.`, 'conflict');
    // Two writes, not one transaction: the admin store opens its own. A failed link leaves the test
    // saved without it, and saving again links it.
    await writeConcept(code, t, null);
    await writeLoincLink(code, t.loinc);
    return saved(code);
  }

  async function update(code: string, input: CatalogTestInput): Promise<CatalogTest> {
    await refuseUnlessOwned();
    const stored = await storedConcept(code);
    if (!stored) throw notFound(code);
    const given = clean(input.code);
    if (given && given !== code) throw invalid(`A test's code cannot change once saved (${code}).`);
    const t = await validate(input);
    await writeConcept(code, t, stored.properties);
    await writeLoincLink(code, t.loinc);
    return saved(code);
  }

  async function setLabSettings(code: string, input: LabSettingsInput): Promise<CatalogTest> {
    // Any install may set these, a lab that receives central's catalog included. Nothing here signals
    // sync: the table is this install's own.
    const test = await get(code);
    if (!test) throw notFound(code);
    let specimenTypes: SpecimenCoding[] | null = null;
    if (input.specimenTypes !== null) {
      specimenTypes = uniqueCodings(input.specimenTypes);
      const offered = new Set(test.specimenTypes.map(codingKey));
      const extra = specimenTypes.find((s) => !offered.has(codingKey(s)));
      if (extra) throw invalid(`Specimen ${extra.code} is not on this test's catalog list. A lab can narrow the list but not add to it.`);
    }
    const values = {
      enabled: input.enabled,
      specimen_types: specimenTypes === null ? null : JSON.stringify(specimenTypes),
      local_display: clean(input.localDisplay),
      updated_at: sql<Date>`now()`,
    };
    await db.insertInto('test_catalog_lab_settings').values({ code, ...values })
      .onConflict((oc) => oc.column('code').doUpdateSet(values))
      .execute();
    return saved(code);
  }

  return {
    ownedHere,
    list,
    get,
    create,
    update,
    setLabSettings,
  };
}
