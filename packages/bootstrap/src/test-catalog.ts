import { sql, type Kysely } from 'kysely';
import {
  markTerminologyChanged, type InternalSchema, type TerminologyAdminStore, type TermMapping, type TermMappingInput,
  type VsCompose,
} from '@openldr/db';
import { toCsv } from '@openldr/reporting';
import { LOINC_SYSTEM, type Operations } from '@openldr/terminology';
import { readTableFile, TableFileError, type TableFileFormat } from './table-file';
import type { AuditDetails } from './record-audit';
import {
  CATALOG_EXPORT_COLUMNS, catalogExportRow,
  CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ROWS, checkColumnMap, matchCategory, matchSpecimen,
  readCatalogRows, splitSpecimens, suggestCatalogColumns, valueKey,
  type CatalogColumnMap, type CatalogValueMap, type CategoryAnswer,
} from './test-catalog-import';

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
/** The lab's test list, which the Lab order's Tests field binds. Must equal LAB_TESTS_VALUE_SET in
 *  migration 105, which seeds its row. */
export const LAB_TESTS_VALUE_SET = 'urn:openldr:valueset:lab-tests';

/** The map type of a test's LOINC link. concept_map_elements stores it as the equivalence. */
const LOINC_MAP_TYPE = 'SAME-AS' as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
/** Terminology's statuses are ACTIVE, DRAFT, DEPRECATED and DISABLED, and the Terminology page accepts
 *  nothing else (apps/server/src/terminology-admin-routes.ts), so a retired test is stored as DEPRECATED. */
const RETIRED_STATUS = 'DEPRECATED';
const LOINC_CODE = /^\d{1,7}-\d$/;
/** An import looks its LOINC codes up in batches, so thousands of rows cost a few queries. */
const LOINC_LOOKUP_CHUNK = 1000;

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

/** A category the sheet can offer. */
export interface CatalogCategoryOption {
  code: string;
  display: string | null;
}

/** A specimen type the sheet can offer. */
export interface CatalogSpecimenOption {
  system: string;
  code: string;
  display: string | null;
}

/** Everything the page's pickers offer, taken from the same ValueSets the save checks against. */
export interface CatalogOptions {
  categories: CatalogCategoryOption[];
  specimenTypes: CatalogSpecimenOption[];
  /** The LOINC code system when LOINC is loaded here, so the sheet can search it. Null otherwise. */
  loinc: { systemId: string; system: string } | null;
}

/** A file read for import: its table, and CE's guess at which column feeds which field. */
export interface CatalogImportFile {
  headers: string[];
  rows: string[][];
  sheetName: string | null;
  sheetCount: number;
  suggested: CatalogColumnMap;
}

/** One import step. The studio sends the table back with each one, so the server keeps nothing between steps. */
export interface CatalogImportInput {
  table: { headers: string[]; rows: string[][] };
  columnMap: CatalogColumnMap;
  valueMap?: CatalogValueMap;
}

export interface CatalogImportRefusal {
  /** The spreadsheet row. The header is row 1. */
  line: number;
  code: string | null;
  reason: string;
}

/** File text that matched nothing in a list, and how many rows use it. */
export interface CatalogUnmatchedValue {
  text: string;
  rows: number;
}

/** What an import will do (preview) or did (apply). Both are worked out by the same code. */
export interface CatalogImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: CatalogImportRefusal[];
  /** Every text that matched nothing on its own, answered or not, so the Values step can list it. */
  unmatched: { categories: CatalogUnmatchedValue[]; specimens: CatalogUnmatchedValue[] };
  /** The new categories the operator named that a written test uses. */
  categoriesToAdd: Array<{ code: string; display: string }>;
  /** false when LOINC is not loaded here, so LOINC codes were checked for their format only. */
  loincChecked: boolean;
}

export class TestCatalogError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'not-found' | 'conflict' | 'central-managed') {
    super(message);
    this.name = 'TestCatalogError';
  }
}

/**
 * Read an uploaded file for import. The route and `openldr test-catalog import` both call this, so they
 * refuse the same files in the same words.
 */
export function readCatalogImportFile(bytes: Uint8Array, format: TableFileFormat): CatalogImportFile {
  try {
    const table = readTableFile(bytes, format, { maxBytes: CATALOG_IMPORT_MAX_BYTES, maxRows: CATALOG_IMPORT_MAX_ROWS });
    return { ...table, suggested: suggestCatalogColumns(table.headers) };
  } catch (err) {
    if (err instanceof TableFileError) throw new TestCatalogError(err.message, 'invalid');
    throw err;
  }
}

/** The audit action for a row change. The route and the CLI both record it, so they must agree. */
export function catalogChangeAction(field: 'enabled' | 'active', value: boolean): string {
  if (field === 'enabled') return value ? 'test_catalog.enable' : 'test_catalog.disable';
  return value ? 'test_catalog.restore' : 'test_catalog.retire';
}

/** The audit entry for an applied import. The route and the CLI both record it, so they must agree. */
export function catalogImportAudit(report: CatalogImportReport): AuditDetails {
  return {
    action: 'test_catalog.import', entityType: 'test_catalog', entityId: TEST_CATALOG_SYSTEM,
    metadata: { counts: report.counts, categoriesAdded: report.categoriesToAdd.map((c) => c.code) },
  };
}

export interface TestCatalog {
  ownedHere(): Promise<boolean>;
  list(query: CatalogListQuery): Promise<CatalogListResult>;
  get(code: string): Promise<CatalogTest | null>;
  create(input: CatalogTestInput): Promise<CatalogTest>;
  update(code: string, input: CatalogTestInput): Promise<CatalogTest>;
  setLabSettings(code: string, input: LabSettingsInput): Promise<CatalogTest>;
  options(): Promise<CatalogOptions>;
  setEnabled(code: string, enabled: boolean): Promise<CatalogTest>;
  setActive(code: string, active: boolean): Promise<CatalogTest>;
  importPreview(input: CatalogImportInput): Promise<CatalogImportReport>;
  importApply(input: CatalogImportInput): Promise<CatalogImportReport>;
  exportCsv(): Promise<string>;
  /** The specimens at least one of these tests accepts, by this lab's lists. Codings outside the
   *  catalog are ignored. Empty means there is nothing to narrow by (test catalog S4). */
  specimensFor(tests: Array<{ system: string; code: string }>): Promise<CatalogSpecimenOption[]>;
  /** Each catalog test's LOINC coding, keyed `system|code` of the test, for tests with an active link. */
  loincCodingsFor(tests: Array<{ system: string; code: string }>): Promise<Map<string, { system: string; code: string }>>;
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

/** What checkTest needs from the database. An import reads it once for every row. */
interface CheckContext {
  categories: CatalogSpecimenOption[];
  specimens: CatalogSpecimenOption[];
  loincLoaded: boolean;
  /** The LOINC codes asked about that LOINC holds as more than a DRAFT stub. */
  knownLoinc: Set<string>;
}

/** A row the import will write. */
interface PlannedWrite {
  code: string;
  test: ValidTest;
  /** The stored properties, so keys this catalog does not manage survive. Null for a new test. */
  stored: unknown;
  /** The LOINC code linked before the import. */
  loincBefore: string | null;
}

/** Status is not compared: an import never changes it. */
function sameTest(a: CatalogTest, b: ValidTest): boolean {
  return a.display === b.display && a.shortName === b.shortName && a.category === b.category && a.loinc === b.loinc
    && a.specimenTypes.map(codingKey).join('\n') === b.specimenTypes.map(codingKey).join('\n');
}

function isLoincLink(m: TermMapping): boolean {
  return m.toSystem === LOINC_SYSTEM && m.mapType === LOINC_MAP_TYPE && m.isActive;
}

function loincLinkInput(code: string, loinc: string): TermMappingInput {
  return {
    fromSystem: TEST_CATALOG_SYSTEM, fromCode: code, toSystem: LOINC_SYSTEM, toCode: loinc,
    toDisplay: null, mapType: LOINC_MAP_TYPE, isActive: true,
  };
}

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

/** Order picker choices by what the operator reads: the name, or the code when there is none. */
function byLabel(a: { code: string; display: string | null }, b: { code: string; display: string | null }): number {
  return (a.display ?? a.code).localeCompare(b.display ?? b.code);
}

/**
 * The lab's test list as a ValueSet compose: the active catalog tests switched on here, each under the
 * lab's local name when it set one. Worked out on every read, so it is never stale and never stored
 * (test catalog S4, decision 1). With nothing switched on it is `{ include: [] }`: an include of the
 * catalog system with no concepts would list the whole catalog (packages/db/src/value-set-expander.ts:53-62).
 */
export async function labTestsCompose(db: Kysely<InternalSchema>): Promise<VsCompose> {
  const rows = await db.selectFrom('terminology_concepts as c')
    .innerJoin('test_catalog_lab_settings as l', 'l.code', 'c.code')
    .select(['c.code as code', 'c.display as display', 'l.local_display as localDisplay'])
    .where('c.system', '=', TEST_CATALOG_SYSTEM)
    .where('l.enabled', '=', true)
    // NULL counts as ACTIVE, as toTest reads it.
    .where((eb) => eb.or([eb('c.status', '=', 'ACTIVE'), eb('c.status', 'is', null)]))
    .orderBy('c.code')
    .execute();
  if (rows.length === 0) return { include: [] };
  return {
    include: [{
      system: TEST_CATALOG_SYSTEM,
      concept: rows.map((r) => ({ code: r.code, display: r.localDisplay ?? r.display ?? r.code })),
    }],
  };
}

/**
 * Wrap a terminology source's getResourceByUrl so the lab's test list is worked out when read. Only
 * that url changes, and only when migration 105's row exists: the stored resource keeps its id and
 * title, and its compose is replaced. Both places bootstrap builds ops use this (index.ts and
 * terminology-context.ts), so the pickers, the submit check and `openldr terminology expand` agree.
 */
export function withLabTestsList(
  db: Kysely<InternalSchema>,
  getResourceByUrl: (url: string) => Promise<unknown | null>,
): (url: string) => Promise<unknown | null> {
  return async (url) => {
    const stored = await getResourceByUrl(url);
    if (url !== LAB_TESTS_VALUE_SET || !stored || typeof stored !== 'object') return stored;
    return { ...(stored as Record<string, unknown>), compose: await labTestsCompose(db) };
  };
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

  async function expandEntries(url: string): Promise<CatalogSpecimenOption[]> {
    const vs = await deps.ops.expand(url, { count: 100_000 });
    return (vs.expansion?.contains ?? [])
      .map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null }));
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

  /**
   * The rules every write shares: create, update and each import row. It reads nothing, so an import
   * checks thousands of rows against one read of the lists. `linked` is the LOINC code the test already
   * has. It was checked when it was linked, so a row that keeps it is not checked again.
   */
  function checkTest(input: CatalogTestInput, ctx: CheckContext, linked: string | null = null): ValidTest {
    const display = clean(input.display);
    if (!display) throw invalid('A test needs a name.');
    const category = clean(input.category);
    if (category && !ctx.categories.some((c) => c.code === category)) {
      throw invalid(`Category ${category} is not in the test category list.`);
    }
    const specimenTypes = uniqueCodings(input.specimenTypes ?? []);
    const offered = new Set(ctx.specimens.map(codingKey));
    const missing = specimenTypes.find((s) => !offered.has(codingKey(s)));
    if (missing) throw invalid(`Specimen ${missing.code} (${missing.system}) is not in the specimen type list.`);
    const loinc = clean(input.loinc);
    if (loinc && loinc !== linked) {
      if (!LOINC_CODE.test(loinc)) throw invalid(`"${loinc}" is not a LOINC code. LOINC codes look like 12345-6.`);
      // With no LOINC loaded, only the format can be checked.
      if (ctx.loincLoaded && !ctx.knownLoinc.has(loinc)) {
        throw invalid(`LOINC code ${loinc} is not in the LOINC loaded on this install.`);
      }
    }
    return { display, shortName: clean(input.shortName), category, specimenTypes, loinc, active: input.active ?? true };
  }

  async function loadCheckContext(loincCodes: string[]): Promise<CheckContext> {
    const [categories, specimens, loaded] = await Promise.all([
      expandEntries(TEST_CATEGORY_VALUE_SET), expandEntries(SPECIMEN_TYPE_VALUE_SET), loincLoaded(),
    ]);
    const knownLoinc = new Set<string>();
    const wanted = [...new Set(loincCodes.filter((c) => LOINC_CODE.test(c)))];
    if (loaded) {
      for (let i = 0; i < wanted.length; i += LOINC_LOOKUP_CHUNK) {
        const found = await db.selectFrom('terminology_concepts').select('code')
          .where('system', '=', LOINC_SYSTEM)
          .where('code', 'in', wanted.slice(i, i + LOINC_LOOKUP_CHUNK))
          // A DRAFT row is the stub an earlier link left, not a loaded code.
          .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
          .execute();
        for (const f of found) knownLoinc.add(f.code);
      }
    }
    return { categories, specimens, loincLoaded: loaded, knownLoinc };
  }

  async function validate(input: CatalogTestInput): Promise<ValidTest> {
    const loinc = clean(input.loinc);
    return checkTest(input, await loadCheckContext(loinc ? [loinc] : []));
  }

  async function storedConcept(code: string): Promise<{ properties: unknown } | undefined> {
    return db.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code).executeTakeFirst();
  }

  async function writeConceptOn(exec: Kysely<InternalSchema>, code: string, t: ValidTest, stored: unknown): Promise<void> {
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
    await exec.insertInto('terminology_concepts').values({
      system: TEST_CATALOG_SYSTEM, code, display: t.display,
      status: t.active ? 'ACTIVE' : RETIRED_STATUS,
      properties: properties as never,
    }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
      display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
    }))).execute();
  }

  async function writeConcept(code: string, t: ValidTest, stored: unknown): Promise<void> {
    await writeConceptOn(db, code, t, stored);
    // One terminology_system signal per edit, as terms.create does, so labs pull the change.
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
  }

  async function writeLoincLink(code: string, loinc: string | null): Promise<void> {
    const current = (await deps.admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, code)).find(isLoincLink);
    if (loinc && current?.toCode !== loinc) {
      // saveExclusive keeps one active LOINC link per test and deactivates the old one.
      await deps.admin.termMappings.saveExclusive(loincLinkInput(code, loinc));
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

  async function options(): Promise<CatalogOptions> {
    const [categories, specimenTypes] = await Promise.all([
      expandEntries(TEST_CATEGORY_VALUE_SET),
      expandEntries(SPECIMEN_TYPE_VALUE_SET),
    ]);
    let loinc: CatalogOptions['loinc'] = null;
    if (await loincLoaded()) {
      const row = await db.selectFrom('coding_systems').select('id').where('url', '=', LOINC_SYSTEM).executeTakeFirst();
      if (row) loinc = { systemId: row.id, system: LOINC_SYSTEM };
    }
    return {
      categories: categories.map(({ code, display }) => ({ code, display })).sort(byLabel),
      specimenTypes: specimenTypes.sort(byLabel),
      loinc,
    };
  }

  async function setEnabled(code: string, enabled: boolean): Promise<CatalogTest> {
    // Only the switch changes. The lab's narrowed specimens and local name stay as they are, even when
    // central has since dropped a specimen the lab kept: switching a test on must not fail on a field
    // the operator did not touch. Nothing here signals sync.
    if (!(await storedConcept(code))) throw notFound(code);
    await db.insertInto('test_catalog_lab_settings').values({ code, enabled, updated_at: sql<Date>`now()` })
      .onConflict((oc) => oc.column('code').doUpdateSet({ enabled, updated_at: sql<Date>`now()` }))
      .execute();
    return saved(code);
  }

  async function setActive(code: string, active: boolean): Promise<CatalogTest> {
    await refuseUnlessOwned();
    const test = await get(code);
    if (!test) throw notFound(code);
    // Only the status changes, so retiring never fails on a field it does not touch. No change means
    // no write and no sync signal.
    if (test.active === active) return test;
    await db.updateTable('terminology_concepts')
      .set({ status: active ? 'ACTIVE' : RETIRED_STATUS })
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code)
      .execute();
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
    return saved(code);
  }

  /**
   * The new categories the operator named, checked. A bad one stops the whole step, because it is the
   * operator's own answer and they can fix it on the Values step.
   */
  async function newCategories(answers: CategoryAnswer[]): Promise<Array<{ code: string; display: string }>> {
    const taken = new Set((await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', TEST_CATEGORY_SYSTEM).execute()).map((r) => r.code));
    const added = new Map<string, string>();
    for (const a of answers) {
      if (a.kind !== 'new') continue;
      const code = a.code.trim();
      const display = a.display.trim();
      if (!code) throw invalid(`The new category for "${a.text}" needs a code.`);
      if (!display) throw invalid(`The new category ${code} needs a name.`);
      // Checked against every concept in the category system, a retired one included, because the
      // insert would collide with it.
      if (taken.has(code)) throw invalid(`Category ${code} already exists. Choose it instead of adding it.`);
      const seen = added.get(code);
      if (seen !== undefined && seen !== display) throw invalid(`Category ${code} is added twice, with two names.`);
      added.set(code, display);
    }
    return [...added].map(([code, display]) => ({ code, display })).sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Work out what an import does, row by row, writing nothing. The preview returns the report; the apply
   * runs this again and writes the plan, so it never trusts what an earlier preview said.
   */
  async function planImport(input: CatalogImportInput): Promise<{ report: CatalogImportReport; writes: PlannedWrite[] }> {
    await refuseUnlessOwned();
    const { table, columnMap } = input;
    if (table.rows.length > CATALOG_IMPORT_MAX_ROWS) {
      throw invalid(`The file has ${table.rows.length} rows under its header. The limit is ${CATALOG_IMPORT_MAX_ROWS}.`);
    }
    const mapProblem = checkColumnMap(columnMap, table.headers);
    if (mapProblem) throw invalid(mapProblem);
    const rows = readCatalogRows(table, columnMap);

    const tests = new Map((await readTests()).map((t) => [t.code, t]));
    const storedByCode = new Map((await db.selectFrom('terminology_concepts').select(['code', 'properties'])
      .where('system', '=', TEST_CATALOG_SYSTEM).execute()).map((r) => [r.code, r.properties as unknown]));
    const ctx = await loadCheckContext(rows.flatMap((r) => (r.values.loinc ? [r.values.loinc] : [])));
    const answers = input.valueMap ?? { categories: [], specimens: [] };
    const toAdd = await newCategories(answers.categories);
    // A row may use a category this import adds.
    const rowCtx: CheckContext = {
      ...ctx,
      categories: [...ctx.categories, ...toAdd.map((c) => ({ system: TEST_CATEGORY_SYSTEM, code: c.code, display: c.display }))],
    };
    const categoryAnswers = new Map(answers.categories
      .filter((a) => a.code.trim() !== '')
      .map((a) => [valueKey(a.text), a.code.trim()]));
    const specimenAnswers = new Map(answers.specimens.map((a) => [valueKey(a.text), { system: a.system, code: a.code }]));

    const unmatchedCategories = new Map<string, CatalogUnmatchedValue>();
    const unmatchedSpecimens = new Map<string, CatalogUnmatchedValue>();
    const tally = (into: Map<string, CatalogUnmatchedValue>, text: string): void => {
      const seen = into.get(valueKey(text));
      if (seen) seen.rows += 1;
      else into.set(valueKey(text), { text, rows: 1 });
    };

    const report: CatalogImportReport = {
      counts: { new: 0, changed: 0, unchanged: 0, refused: 0 },
      refused: [],
      unmatched: { categories: [], specimens: [] },
      categoriesToAdd: [],
      loincChecked: ctx.loincLoaded,
    };
    const writes: PlannedWrite[] = [];
    const firstLine = new Map<string, number>();

    for (const { line, values: v } of rows) {
      // A test with no national code takes its LOINC code, as create does.
      const code = v.code || v.loinc || null;
      if (!code) {
        report.refused.push({ line, code: null, reason: 'A test needs a national code or a LOINC code.' });
        continue;
      }
      const first = firstLine.get(code);
      if (first !== undefined) {
        report.refused.push({ line, code, reason: `Test ${code} is already on row ${first} of this file.` });
        continue;
      }
      firstLine.set(code, line);

      const problems: string[] = [];
      // undefined means the column is not mapped, so the test keeps what it has (decision 4).
      let category: string | null | undefined;
      if (v.category !== undefined) {
        category = v.category === '' ? null : matchCategory(v.category, ctx.categories);
        if (v.category !== '' && category === null) {
          tally(unmatchedCategories, v.category);
          category = categoryAnswers.get(valueKey(v.category)) ?? null;
          if (category === null) problems.push(`Category "${v.category}" is not in the test category list. Choose a category for it.`);
        }
      }
      let specimenTypes: SpecimenCoding[] | undefined;
      if (v.specimenTypes !== undefined) {
        specimenTypes = [];
        for (const text of splitSpecimens(v.specimenTypes)) {
          let hit = matchSpecimen(text, ctx.specimens);
          if (!hit) {
            tally(unmatchedSpecimens, text);
            hit = specimenAnswers.get(valueKey(text)) ?? null;
          }
          if (hit) specimenTypes.push(hit);
          else problems.push(`Specimen "${text}" is not in the specimen type list. Choose a specimen for it.`);
        }
      }
      if (problems.length) {
        report.refused.push({ line, code, reason: problems.join(' ') });
        continue;
      }

      const before = tests.get(code);
      // A mapped column is authoritative, so an empty cell clears the field. An unmapped one is left alone.
      const merged: CatalogTestInput = {
        display: v.name ?? '',
        shortName: v.shortName !== undefined ? v.shortName : before?.shortName ?? null,
        category: category !== undefined ? category : before?.category ?? null,
        specimenTypes: specimenTypes ?? before?.specimenTypes ?? [],
        loinc: v.loinc !== undefined ? v.loinc : before?.loinc ?? null,
        // An import never retires or restores a test. Retiring is always explicit (spec 4.4).
        active: before?.active ?? true,
      };
      let test: ValidTest;
      try {
        test = checkTest(merged, rowCtx, before?.loinc ?? null);
      } catch (err) {
        if (!(err instanceof TestCatalogError)) throw err;
        report.refused.push({ line, code, reason: err.message });
        continue;
      }
      if (!before) {
        report.counts.new += 1;
        writes.push({ code, test, stored: null, loincBefore: null });
      } else if (sameTest(before, test)) {
        report.counts.unchanged += 1;
      } else {
        report.counts.changed += 1;
        writes.push({ code, test, stored: storedByCode.get(code) ?? null, loincBefore: before.loinc });
      }
    }

    report.counts.refused = report.refused.length;
    const byText = (a: CatalogUnmatchedValue, b: CatalogUnmatchedValue): number => a.text.localeCompare(b.text);
    report.unmatched = {
      categories: [...unmatchedCategories.values()].sort(byText),
      specimens: [...unmatchedSpecimens.values()].sort(byText),
    };
    // Only a new category a written test uses is added.
    report.categoriesToAdd = toAdd.filter((c) => writes.some((w) => w.test.category === c.code));
    return { report, writes };
  }

  async function importPreview(input: CatalogImportInput): Promise<CatalogImportReport> {
    return (await planImport(input)).report;
  }

  async function importApply(input: CatalogImportInput): Promise<CatalogImportReport> {
    const { report, writes } = await planImport(input);
    if (writes.length === 0) return report;

    // The links to switch off are read before the transaction, so every statement inside it runs on it.
    // No row touches another row's link: a code appears once in a plan.
    const unlink = new Map<string, TermMapping>();
    for (const w of writes) {
      if (w.loincBefore === null || w.test.loinc !== null) continue;
      const link = (await deps.admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, w.code)).find(isLoincLink);
      if (link) unlink.set(w.code, link);
    }

    // ⛔ One transaction for categories, tests and links (spec 4.4). saveExclusive and update take it,
    // so neither opens one of its own and a failure part way leaves nothing behind.
    await db.transaction().execute(async (trx) => {
      for (const c of report.categoriesToAdd) {
        await trx.insertInto('terminology_concepts').values({
          system: TEST_CATEGORY_SYSTEM, code: c.code, display: c.display, status: 'ACTIVE', properties: null as never,
        }).execute();
      }
      for (const w of writes) {
        await writeConceptOn(trx, w.code, w.test, w.stored);
        if (w.test.loinc !== null && w.test.loinc !== w.loincBefore) {
          await deps.admin.termMappings.saveExclusive(loincLinkInput(w.code, w.test.loinc), { trx });
        } else {
          const link = unlink.get(w.code);
          if (link) {
            const { id, ...rest } = link;
            await deps.admin.termMappings.update(id, { ...rest, isActive: false }, { trx });
          }
        }
      }
    });
    // markTerminologyChanged opens its own transaction, so the signals follow the commit, one per system,
    // as the loaders send them (packages/db/src/terminology-sync.ts). A failed import sends none.
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
    if (report.categoriesToAdd.length) await markTerminologyChanged(db, TEST_CATEGORY_SYSTEM);
    return report;
  }

  async function exportCsv(): Promise<string> {
    // Active tests only, as the page shows by default. Retired tests stay out of a file meant for editing.
    const tests = (await readTests()).filter((t) => t.active);
    return toCsv(CATALOG_EXPORT_COLUMNS, tests.map(catalogExportRow));
  }

  async function specimensFor(tests: Array<{ system: string; code: string }>): Promise<CatalogSpecimenOption[]> {
    const codes = new Set(tests.filter((t) => t.system === TEST_CATALOG_SYSTEM).map((t) => t.code));
    if (codes.size === 0) return [];
    // The lab's narrower list when it set one, else the catalog's (spec 4.5).
    const accepted = new Set((await readTests())
      .filter((t) => codes.has(t.code))
      .flatMap((t) => (t.lab.specimenTypes ?? t.specimenTypes).map(codingKey)));
    if (accepted.size === 0) return [];
    // Only what the specimen picker offers can be submitted, so a specimen since dropped from that
    // list is left out.
    return (await expandEntries(SPECIMEN_TYPE_VALUE_SET)).filter((s) => accepted.has(codingKey(s))).sort(byLabel);
  }

  async function loincCodingsFor(tests: Array<{ system: string; code: string }>): Promise<Map<string, { system: string; code: string }>> {
    const codes = [...new Set(tests.filter((t) => t.system === TEST_CATALOG_SYSTEM).map((t) => t.code))];
    if (codes.length === 0) return new Map();
    const links = await db.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', TEST_CATALOG_SYSTEM)
      .where('from_code', 'in', codes)
      .where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', LOINC_MAP_TYPE)
      .where('is_active', '=', true)
      .execute();
    return new Map(links.map((l) => [`${TEST_CATALOG_SYSTEM}|${l.from_code}`, { system: LOINC_SYSTEM, code: l.to_code }]));
  }

  return {
    ownedHere,
    list,
    get,
    create,
    update,
    setLabSettings,
    options,
    setEnabled,
    setActive,
    importPreview,
    importApply,
    exportCsv,
    specimensFor,
    loincCodingsFor,
  };
}
