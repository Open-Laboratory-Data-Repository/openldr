import type { Kysely } from 'kysely';
import { testMapId, type ExternalSchema, type InternalSchema, type MapType, type TerminologyAdminStore, type TestMapLevel } from '@openldr/db';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { toCsv } from '@openldr/reporting';
import { TEST_CATALOG_SYSTEM, TestCatalogError } from './test-catalog';
import { readTableFile, TableFileError } from './table-file';

// Test mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md) and result field mapping
// (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md). A lab's own test codes map to
// catalog tests, and its result codes map to fields of the result dictionary, through ordinary
// term_mappings rows. The route, the CLI and the content pack installer all call this module
// (AGENTS.md section 6), and test_map is the warehouse copy report SQL joins.

/** Must equal the map type the catalog's LOINC link uses (test-catalog.ts, LOINC_MAP_TYPE). */
const MAP_TYPE = 'SAME-AS' as const;
/** The catalog's retired status (test-catalog.ts, RETIRED_STATUS). */
const RETIRED = 'DEPRECATED';
/** 9 columns per row keeps one insert under MSSQL's ~2,000 bound parameters. */
const INSERT_CHUNK = 200;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
/** How long the Observed list reuses one warehouse scan. */
const OBSERVED_CACHE_MS = 60_000;
const STATUSES = ['unmapped', 'mapped', 'ambiguous', 'all'] as const;

/** A mapping's level: a lab test code maps to a catalog test, a lab result code to a result field. */
export type MapLevel = TestMapLevel;
/** Where each level's mappings point. A code in this system is a target already and needs no mapping. */
export const MAP_TARGET_SYSTEM: Record<MapLevel, string> = { test: TEST_CATALOG_SYSTEM, result: RESULT_PARAM_SYSTEM };
const TARGET_SYSTEMS = new Set(Object.values(MAP_TARGET_SYSTEM));
/** How each level names its target in messages. Slice 1's test-level wording is kept exactly. */
const TARGET_NOUN: Record<MapLevel, string> = { test: 'catalog test', result: 'result field' };

/** Read a level from a query string, a body or a CLI flag. Blank means 'test', slice 1's only level. */
export function parseMapLevel(raw: unknown): { ok: true; level: MapLevel } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, level: 'test' };
  if (raw === 'test' || raw === 'result') return { ok: true, level: raw };
  return { ok: false, error: 'level must be test or result' };
}

export type ObservedStatus = 'unmapped' | 'mapped' | 'ambiguous';

export interface ObservedTestCode {
  system: string;
  code: string;
  description: string | null;
  /** Rows carrying this code in the warehouse: requests at the test level, results at the result level.
   *  0 for a code mapped before any data arrived. */
  requests: number;
  lastSeen: string | null;
  status: ObservedStatus;
  /** The target: a catalog test at the test level, a result field at the result level. */
  catalog: { code: string; name: string | null; loinc: string | null } | null;
  /** Central sent this mapping down. A lab cannot change it. */
  centralManaged: boolean;
}

export interface ObservedQuery { status: ObservedStatus | 'all'; q: string; limit: number; offset: number }

export interface ObservedResult {
  rows: ObservedTestCode[];
  total: number;
  /** The last rebuild in this process failed, so test_map may be out of date. Boot rebuilds again. */
  warehouse: { stale: boolean; error: string | null };
}

export interface CatalogTarget { code: string; name: string | null; loinc: string | null; retired: boolean }

export interface LevelPublishSummary {
  mapped: number;
  ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>;
  targetMissing: Array<{ system: string; code: string; catalogCode: string }>;
}

/** The top-level counts are the test level, as slice 1 shipped them. */
export interface TestMapPublishResult extends LevelPublishSummary {
  /** The same counts for result codes. */
  results: LevelPublishSummary;
  /** Rows that point a catalog test or a result field at itself, so CE's own orders and results join. */
  selfRows: number;
  /** Every row written: both levels, self rows included. */
  written: number;
}

export type RebuildOutcome = { ok: true; result: TestMapPublishResult } | { ok: false; error: string };

export interface TestMappingDeps {
  internalDb: Kysely<InternalSchema>;
  externalDb: Kysely<ExternalSchema>;
  admin: TerminologyAdminStore;
  logger: { warn(obj: object, msg: string): void };
  /** Clock in ms, for the Observed scan cache. Tests inject one. Defaults to Date.now. */
  now?: () => number;
}

type MappingRow = { id: string; from_system: string; from_code: string; to_code: string; to_display: string | null; map_type: string; managed_origin: string | null };
type CatalogEntry = { name: string | null; category: string | null; loinc: string | null; retired: boolean };
type Resolved =
  | { kind: 'mapped'; catalogCode: string }
  | { kind: 'ambiguous'; catalogCodes: string[] }
  | { kind: 'missing'; catalogCode: string };

const MAPPING_COLUMNS = ['id', 'from_system', 'from_code', 'to_code', 'to_display', 'map_type', 'managed_origin'] as const;

const sourceKey = (system: string, code: string): string => `${system}\u0000${code}`;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function categoryOf(properties: unknown): string | null {
  const value = typeof properties === 'string' ? (JSON.parse(properties) as unknown) : properties;
  const category = (value as { category?: unknown } | null)?.category;
  return typeof category === 'string' && category !== '' ? category : null;
}

/** Read list filters from a query string or CLI flags. The route and `openldr test-catalog map list`
 *  both call this, so a bad value is refused in the same words at either door. */
export function parseObservedQuery(raw: Record<string, unknown>): { ok: true; query: ObservedQuery } | { ok: false; error: string } {
  const status = raw.status === undefined || raw.status === '' ? 'all' : String(raw.status);
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be unmapped, mapped, ambiguous or all' };
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  return { ok: true, query: { status: status as ObservedQuery['status'], q, limit, offset: Number(offsetRaw) } };
}

export interface TestMappingChange {
  system: string;
  code: string;
  before: string | null;
  after: string | null;
  rebuild: RebuildOutcome;
}

/** Coalesce rebuild requests. One run at a time; requests made while it runs share one more run.
 *  A sync pull can apply hundreds of relevant records, and each must not cost a rebuild. */
export function createCoalescedRunner(run: () => Promise<void>): (() => Promise<void>) & { idle(): Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;
  const loop = async (): Promise<void> => {
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      running = null;
    }
  };
  const request = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
  /** Resolves when no run is in flight, including the extra run a burst asked for. Starts nothing. */
  const idle = (): Promise<void> => running ?? Promise.resolve();
  return Object.assign(request, { idle });
}

/** A term mapping into the catalog or the dictionary is a mapping. One out of either is a LOINC link. All
 *  of them change test_map. */
export function mappingTouchesTestMap(fromSystem: string | null | undefined, toSystem: string | null | undefined): boolean {
  return TARGET_SYSTEMS.has(toSystem ?? '') || TARGET_SYSTEMS.has(fromSystem ?? '');
}

/** Whether a record a lab pulled from central changes test_map. A term mapping delete carries no body,
 *  so it counts: a spare rebuild is cheap, a missed one leaves reports wrong. */
export function isTestMapRelevantRecord(rec: { entityType: string; body?: unknown }): boolean {
  const body = rec.body as { fromSystem?: string; toSystem?: string; url?: string } | null;
  if (rec.entityType === 'term_mapping') return body === null || body === undefined || mappingTouchesTestMap(body.fromSystem, body.toSystem);
  if (rec.entityType === 'terminology_system') return TARGET_SYSTEMS.has(body?.url ?? '');
  return false;
}

export const TEST_MAPPING_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const TEST_MAPPING_IMPORT_MAX_ROWS = 20_000;

/** Each level's CSV. The count column and the target column differ; system, code and loinc do not. */
const CSV_COLUMNS: Record<MapLevel, Array<{ key: string; label: string }>> = {
  test: ['system', 'code', 'description', 'requests', 'catalog_code', 'loinc'].map((k) => ({ key: k, label: k })),
  result: ['system', 'code', 'description', 'results', 'parameter_code', 'loinc'].map((k) => ({ key: k, label: k })),
};
const COUNT_COLUMN: Record<MapLevel, string> = { test: 'requests', result: 'results' };
const TARGET_COLUMN: Record<MapLevel, string> = { test: 'catalog_code', result: 'parameter_code' };

export interface MappingImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: Array<{ line: number; system: string; code: string; reason: string }>;
  /** Set by apply. Null for a preview. */
  rebuild: RebuildOutcome | null;
}

type PlannedRow = { system: string; code: string; catalogCode: string; name: string | null };

export interface PackMappingInput { system: string; code: string; loinc: string }

export interface PackMappingPlan {
  mapped: Array<{ system: string; code: string; catalogCode: string }>;
  /** Already mapped here, by hand or by central. A pack never overwrites. */
  kept: Array<{ system: string; code: string }>;
  skipped: Array<{ system: string; code: string; reason: string }>;
}

/** Map matching codes (result field mapping spec 4.5): the unmapped result codes of one lab system that
 *  equal a dictionary code. On a DISA site the dictionary is DISA's own list, so most codes match. */
export interface MatchPlan {
  system: string;
  matches: Array<{ code: string; display: string | null; results: number }>;
}

export function createTestMapping(deps: TestMappingDeps) {
  const { internalDb, externalDb } = deps;
  let lastRebuild: { ok: boolean; error: string | null } = { ok: true, error: null };
  const now = deps.now ?? Date.now;

  async function readCatalog(): Promise<Map<string, CatalogEntry>> {
    const concepts = await internalDb.selectFrom('terminology_concepts')
      .select(['code', 'display', 'status', 'properties'])
      .where('system', '=', TEST_CATALOG_SYSTEM).execute();
    const links = await internalDb.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', TEST_CATALOG_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    const loinc = new Map(links.map((l) => [l.from_code, l.to_code]));
    return new Map(concepts.map((c) => [c.code, {
      name: c.display, category: categoryOf(c.properties), loinc: loinc.get(c.code) ?? null, retired: c.status === RETIRED,
    }]));
  }

  /** The result dictionary, shaped like the catalog. A field has no category. */
  async function readParams(): Promise<Map<string, CatalogEntry>> {
    const concepts = await internalDb.selectFrom('terminology_concepts')
      .select(['code', 'display', 'status'])
      .where('system', '=', RESULT_PARAM_SYSTEM).execute();
    const links = await internalDb.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', RESULT_PARAM_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    const loinc = new Map(links.map((l) => [l.from_code, l.to_code]));
    return new Map(concepts.map((c) => [c.code, {
      name: c.display, category: null, loinc: loinc.get(c.code) ?? null, retired: c.status === RETIRED,
    }]));
  }

  function readTargets(level: MapLevel): Promise<Map<string, CatalogEntry>> {
    return level === 'test' ? readCatalog() : readParams();
  }

  async function readMappings(level: MapLevel = 'test'): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(MAPPING_COLUMNS)
      .where('to_system', '=', MAP_TARGET_SYSTEM[level]).where('is_active', '=', true)
      // A row from the target system to itself would collide with that code's self row on the key.
      .where('from_system', '!=', MAP_TARGET_SYSTEM[level]).execute();
  }

  function resolveAll(rows: MappingRow[], catalog: Map<string, CatalogEntry>): Map<string, { system: string; code: string; resolved: Resolved; central: boolean }> {
    const groups = new Map<string, MappingRow[]>();
    for (const r of rows) {
      const k = sourceKey(r.from_system, r.from_code);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const out = new Map<string, { system: string; code: string; resolved: Resolved; central: boolean }>();
    for (const [k, group] of groups) {
      // Distinct targets, not rows: two rows naming one test resolve the same way.
      // Central wins: when central has mapped the code, a lab's own row for it is ignored.
      const central = group.filter((g) => g.managed_origin === 'central');
      const deciding = central.length > 0 ? central : group;
      const targets = [...new Set(deciding.map((g) => g.to_code))].sort(compare);
      const resolved: Resolved = targets.length > 1
        ? { kind: 'ambiguous', catalogCodes: targets }
        : catalog.has(targets[0]) ? { kind: 'mapped', catalogCode: targets[0] } : { kind: 'missing', catalogCode: targets[0] };
      out.set(k, { system: group[0].from_system, code: group[0].from_code, resolved, central: central.length > 0 });
    }
    return out;
  }

  type TestMapRow = {
    id: string; level: MapLevel; source_system: string; source_code: string;
    catalog_code: string; catalog_name: string | null; category: string | null; loinc: string | null;
  };

  async function planLevel(level: MapLevel): Promise<{ rows: TestMapRow[]; selfRows: number; summary: LevelPublishSummary }> {
    const targets = await readTargets(level);
    const resolved = [...resolveAll(await readMappings(level), targets).values()];
    const row = (system: string, code: string, targetCode: string): TestMapRow => {
      const entry = targets.get(targetCode)!;
      return {
        id: testMapId(level, system, code), level, source_system: system, source_code: code,
        catalog_code: targetCode, catalog_name: entry.name, category: entry.category, loinc: entry.loinc,
      };
    };
    const mapped = resolved.flatMap((r) => (r.resolved.kind === 'mapped' ? [row(r.system, r.code, r.resolved.catalogCode)] : []));
    // CE's own orders and results already carry the target's code, so each target maps to itself.
    const self = [...targets.keys()].sort(compare).map((code) => row(MAP_TARGET_SYSTEM[level], code, code));
    return {
      rows: [...mapped, ...self],
      selfRows: self.length,
      summary: {
        mapped: mapped.length,
        ambiguous: resolved.flatMap((r) => (r.resolved.kind === 'ambiguous' ? [{ system: r.system, code: r.code, catalogCodes: r.resolved.catalogCodes }] : [])),
        targetMissing: resolved.flatMap((r) => (r.resolved.kind === 'missing' ? [{ system: r.system, code: r.code, catalogCode: r.resolved.catalogCode }] : [])),
      },
    };
  }

  async function publish(opts: { apply: boolean }): Promise<TestMapPublishResult> {
    const tests = await planLevel('test');
    const results = await planLevel('result');
    const rows = [...tests.rows, ...results.rows];
    const result: TestMapPublishResult = {
      ...tests.summary, results: results.summary, selfRows: tests.selfRows + results.selfRows, written: rows.length,
    };
    if (!opts.apply) return result;
    // Delete then insert in one transaction, so a reader never sees the table empty. This module owns
    // both levels, so it replaces the whole table.
    await externalDb.transaction().execute(async (trx) => {
      await trx.deleteFrom('test_map').execute();
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await trx.insertInto('test_map').values(rows.slice(i, i + INSERT_CHUNK)).execute();
      }
    });
    return result;
  }

  async function doRebuild(): Promise<RebuildOutcome> {
    try {
      const result = await publish({ apply: true });
      lastRebuild = { ok: true, error: null };
      return { ok: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      lastRebuild = { ok: false, error };
      deps.logger.warn({ err }, 'test_map rebuild failed');
      return { ok: false, error };
    }
  }

  // One rebuild at a time. Two overlapping rebuilds both delete, then the second insert hits the primary
  // key and rolls back, so the table is right but the outcome says "stale". Later calls wait their turn.
  let chain: Promise<unknown> = Promise.resolve();

  /** Rebuild test_map now. Never throws: a failure is logged, kept for the Observed list, and returned. */
  function rebuildNow(): Promise<RebuildOutcome> {
    const run = chain.then(doRebuild, doRebuild);
    chain = run.catch(() => undefined);
    return run;
  }

  type ObservedGroup = { system: string; code: string; description: string | null; requests: number; lastSeen: string | null };
  // The group-by over lab_requests or lab_results is the costly read behind the Observed list. Cache it
  // for a minute, one entry per level. A rebuild does not clear it: a rebuild changes neither table.
  // Mappings, the catalog and the dictionary are never cached. A failed scan is not kept.
  const observedCache: Record<MapLevel, { at: number; groups: Promise<ObservedGroup[]> } | null> = { test: null, result: null };

  function readObservedGroups(level: MapLevel = 'test'): Promise<ObservedGroup[]> {
    const cached = observedCache[level];
    if (cached && now() - cached.at < OBSERVED_CACHE_MS) return cached.groups;
    const entry = { at: now(), groups: level === 'test' ? scanRequestGroups() : scanResultGroups() };
    observedCache[level] = entry;
    entry.groups.catch(() => { if (observedCache[level] === entry) observedCache[level] = null; });
    return entry.groups;
  }

  function toGroup(r: { system: unknown; code: unknown; description: unknown; requests: unknown; last_seen: unknown }): ObservedGroup {
    const last = r.last_seen;
    return {
      system: r.system as string, code: r.code as string,
      description: (r.description as string | null) ?? null,
      requests: Number(r.requests),
      lastSeen: last === null || last === undefined ? null : last instanceof Date ? last.toISOString() : String(last),
    };
  }

  async function scanRequestGroups(): Promise<ObservedGroup[]> {
    const rows = await externalDb.selectFrom('lab_requests')
      .select((eb) => [
        'panel_system as system', 'panel_code as code',
        eb.fn.max('panel_desc').as('description'),
        eb.fn.countAll().as('requests'),
        eb.fn.max('authored_at').as('last_seen'),
      ])
      .where('panel_system', 'is not', null)
      .where('panel_code', 'is not', null)
      // CE's own orders carry catalog codes, which self rows map already.
      .where('panel_system', '!=', TEST_CATALOG_SYSTEM)
      .groupBy(['panel_system', 'panel_code'])
      .execute();
    return rows.map(toGroup);
  }

  async function scanResultGroups(): Promise<ObservedGroup[]> {
    const rows = await externalDb.selectFrom('lab_results')
      .select((eb) => [
        'observation_system as system', 'observation_code as code',
        eb.fn.max('observation_desc').as('description'),
        eb.fn.countAll().as('requests'),
        // When the row reached the warehouse. cdr sends no result time of its own.
        eb.fn.max('created_at').as('last_seen'),
      ])
      .where('observation_system', 'is not', null)
      .where('observation_code', 'is not', null)
      // CE's own results carry dictionary codes, which self rows map already.
      .where('observation_system', '!=', RESULT_PARAM_SYSTEM)
      .groupBy(['observation_system', 'observation_code'])
      .execute();
    return rows.map(toGroup);
  }

  async function observedAll(level: MapLevel = 'test'): Promise<ObservedTestCode[]> {
    const targetsByCode = await readTargets(level);
    const resolved = resolveAll(await readMappings(level), targetsByCode);
    const seen = new Map((await readObservedGroups(level)).map((g) => [sourceKey(g.system, g.code), g]));
    // A code mapped before any data arrived is still listed, so a CLI-made mapping is never invisible.
    for (const [k, r] of resolved) {
      if (!seen.has(k)) seen.set(k, { system: r.system, code: r.code, description: null, requests: 0, lastSeen: null });
    }
    const rows = [...seen.entries()].map(([k, g]): ObservedTestCode => {
      const r = resolved.get(k);
      const kind = r?.resolved.kind;
      const targetCode = kind === 'mapped' ? (r!.resolved as { catalogCode: string }).catalogCode : null;
      const entry = targetCode ? targetsByCode.get(targetCode)! : null;
      return {
        ...g,
        status: kind === 'mapped' ? 'mapped' : kind === 'ambiguous' ? 'ambiguous' : 'unmapped',
        catalog: targetCode ? { code: targetCode, name: entry!.name, loinc: entry!.loinc } : null,
        centralManaged: r?.central ?? false,
      };
    });
    return rows.sort((a, b) => compare(a.system, b.system) || compare(a.code, b.code));
  }

  async function observed(query: ObservedQuery, level: MapLevel = 'test'): Promise<ObservedResult> {
    const needle = query.q.toLowerCase();
    const matched = (await observedAll(level)).filter((r) => (query.status === 'all' || r.status === query.status)
      && (needle === '' || [r.code, r.description, r.catalog?.name].some((v) => (v ?? '').toLowerCase().includes(needle))));
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      warehouse: { stale: !lastRebuild.ok, error: lastRebuild.error },
    };
  }

  async function targets(level: MapLevel = 'test'): Promise<CatalogTarget[]> {
    return [...(await readTargets(level)).entries()]
      .map(([code, e]) => ({ code, name: e.name, loinc: e.loinc, retired: e.retired }))
      .sort((a, b) => compare(a.code, b.code));
  }

  async function activeFor(system: string, code: string, level: MapLevel = 'test'): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(MAPPING_COLUMNS)
      .where('from_system', '=', system).where('from_code', '=', code)
      .where('to_system', '=', MAP_TARGET_SYSTEM[level]).where('is_active', '=', true).execute();
  }

  /** A code in the target system is a target already. Mapping it would collide with its self row. */
  function selfSystemReason(system: string, level: MapLevel): string | null {
    return system === MAP_TARGET_SYSTEM[level] ? `${system} codes are ${TARGET_NOUN[level]}s already and need no mapping` : null;
  }

  function assertSource(system: string, code: string, level: MapLevel): void {
    if (system.trim() === '' || code.trim() === '') throw new TestCatalogError('system and code are required', 'invalid');
    const self = selfSystemReason(system, level);
    if (self) throw new TestCatalogError(self, 'invalid');
  }

  function assertNotCentral(rows: MappingRow[], code: string): void {
    if (rows.some((r) => r.managed_origin === 'central')) {
      throw new TestCatalogError(`central maps ${code}; a lab cannot change it`, 'central-managed');
    }
  }

  async function deactivate(row: MappingRow, level: MapLevel): Promise<void> {
    await deps.admin.termMappings.update(row.id, {
      fromSystem: row.from_system, fromCode: row.from_code, toSystem: MAP_TARGET_SYSTEM[level], toCode: row.to_code,
      toDisplay: row.to_display, mapType: row.map_type as MapType, isActive: false,
    });
  }

  /** Make `targetCode` the one active mapping for this code at this level. No guard and no rebuild: the
   *  callers (set, CSV import, pack install, match) check first and rebuild once at the end. */
  async function writeMapping(system: string, code: string, targetCode: string, name: string | null, level: MapLevel = 'test'): Promise<void> {
    const saved = await deps.admin.termMappings.saveExclusive({
      fromSystem: system, fromCode: code, toSystem: MAP_TARGET_SYSTEM[level], toCode: targetCode,
      toDisplay: name, mapType: MAP_TYPE, isActive: true,
    });
    // saveExclusive supersedes only SAME-AS rows. One made through the general mapping dialog with
    // another type would stay active and make the code ambiguous, so it goes too.
    for (const other of await activeFor(system, code, level)) {
      if (other.id !== saved.mapping.id) await deactivate(other, level);
    }
  }

  async function set(system: string, code: string, targetCode: string, level: MapLevel = 'test'): Promise<TestMappingChange> {
    assertSource(system, code, level);
    const entry = (await readTargets(level)).get(targetCode);
    if (!entry) throw new TestCatalogError(`no ${TARGET_NOUN[level]} has code ${targetCode}`, 'invalid');
    const existing = await activeFor(system, code, level);
    assertNotCentral(existing, code);
    const before = existing.map((r) => r.to_code).sort(compare)[0] ?? null;
    await writeMapping(system, code, targetCode, entry.name, level);
    return { system, code, before, after: targetCode, rebuild: await rebuildNow() };
  }

  async function clear(system: string, code: string, level: MapLevel = 'test'): Promise<TestMappingChange> {
    assertSource(system, code, level);
    const existing = await activeFor(system, code, level);
    // Slice 1's words at the test level, kept exactly.
    if (existing.length === 0) throw new TestCatalogError(`${code} has no ${level === 'test' ? 'catalog' : 'result field'} mapping`, 'not-found');
    assertNotCentral(existing, code);
    for (const row of existing) await deactivate(row, level);
    return { system, code, before: existing.map((r) => r.to_code).sort(compare)[0], after: null, rebuild: await rebuildNow() };
  }

  const requestRebuild = createCoalescedRunner(async () => { await rebuildNow(); });

  /** Resolves when no rebuild is running or queued. Starts none, and never rejects. A process that is
   *  about to close its databases waits on this, so a rebuild it asked for is not cut off. */
  async function settled(): Promise<void> {
    try {
      await requestRebuild.idle();
      await chain;
    } catch {
      // rebuildNow never throws; nothing here may stop a close.
    }
  }

  async function catalogCodesForLoinc(loinc: string, level: MapLevel = 'test'): Promise<string[]> {
    const rows = await internalDb.selectFrom('term_mappings').select('from_code')
      .where('from_system', '=', MAP_TARGET_SYSTEM[level]).where('to_system', '=', LOINC_SYSTEM)
      .where('to_code', '=', loinc).where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    return [...new Set(rows.map((r) => r.from_code))].sort(compare);
  }

  async function exportCsv(level: MapLevel = 'test'): Promise<string> {
    const rows = await observedAll(level);
    return toCsv(CSV_COLUMNS[level], rows.map((r) => ({
      system: r.system, code: r.code, description: r.description, [COUNT_COLUMN[level]]: r.requests,
      [TARGET_COLUMN[level]]: r.catalog?.code ?? null, loinc: r.catalog?.loinc ?? null,
    })));
  }

  async function planImport(bytes: Uint8Array, level: MapLevel): Promise<{ report: MappingImportReport; writes: PlannedRow[] }> {
    let table;
    try {
      table = readTableFile(bytes, 'csv', { maxBytes: TEST_MAPPING_IMPORT_MAX_BYTES, maxRows: TEST_MAPPING_IMPORT_MAX_ROWS });
    } catch (err) {
      if (err instanceof TableFileError) throw new TestCatalogError(err.message, 'invalid');
      throw err;
    }
    const headers = table.headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    const col = (name: string): number => headers.indexOf(name);
    if (col('system') < 0 || col('code') < 0) throw new TestCatalogError('the file needs a system column and a code column', 'invalid');
    const targetColumn = TARGET_COLUMN[level];
    if (col(targetColumn) < 0 && col('loinc') < 0) throw new TestCatalogError(`the file needs a ${targetColumn} column or a loinc column`, 'invalid');
    const cell = (row: string[], name: string): string => (col(name) < 0 ? '' : (row[col(name)] ?? '').trim());
    // The export puts an apostrophe before a cell that starts with = @ + - so a spreadsheet does not run
    // it as a formula (reporting toCsv). Take that one apostrophe off the system and code cells.
    const unguard = (v: string): string => (/^'[=@+-]/.test(v) ? v.slice(1) : v);

    const targetsByCode = await readTargets(level);
    // One warehouse read per import. A code the warehouse holds with surrounding spaces is a different
    // code from its trimmed form, and a file cell cannot carry the spaces (readTableFile trims every cell).
    const observedCodes = new Map<string, Set<string>>();
    for (const g of await readObservedGroups(level)) {
      const set = observedCodes.get(g.system) ?? new Set<string>();
      set.add(g.code);
      observedCodes.set(g.system, set);
    }
    const heldWithSpaces = (system: string, code: string): boolean => {
      const codes = observedCodes.get(system);
      if (!codes || codes.has(code)) return false;
      for (const c of codes) if (c !== code && c.trim() === code) return true;
      return false;
    };
    const report: MappingImportReport = { counts: { new: 0, changed: 0, unchanged: 0, refused: 0 }, refused: [], rebuild: null };
    const writes: PlannedRow[] = [];
    const seen = new Set<string>();
    const refuse = (line: number, system: string, code: string, reason: string) => {
      report.counts.refused += 1;
      report.refused.push({ line, system, code, reason });
    };

    for (let i = 0; i < table.rows.length; i++) {
      const line = i + 2;
      // readTableFile and cell() trim the cell, so a code cannot keep surrounding spaces here. A file
      // cell is read as the trimmed code. Codes match exactly, so heldWithSpaces refuses the row when
      // the warehouse holds only the padded form, rather than writing a mapping that never joins.
      const system = unguard(cell(table.rows[i], 'system'));
      const code = unguard(cell(table.rows[i], 'code'));
      if (system === '' || code === '') { refuse(line, system, code, 'system and code are required'); continue; }
      const key = sourceKey(system, code);
      if (seen.has(key)) { refuse(line, system, code, 'listed twice in the file'); continue; }
      seen.add(key);
      if (heldWithSpaces(system, code)) {
        refuse(line, system, code, 'the warehouse holds this code with surrounding spaces; map it on the Observed tab or with map set');
        continue;
      }

      const self = selfSystemReason(system, level);
      if (self) { refuse(line, system, code, self); continue; }

      const targetCell = cell(table.rows[i], targetColumn);
      const loinc = cell(table.rows[i], 'loinc');
      const noun = TARGET_NOUN[level];
      let targetCode: string | null = null;
      if (targetCell !== '') {
        if (!targetsByCode.has(targetCell)) { refuse(line, system, code, `no ${noun} has code ${targetCell}`); continue; }
        targetCode = targetCell;
      } else if (loinc !== '') {
        const codes = await catalogCodesForLoinc(loinc, level);
        if (codes.length === 0) { refuse(line, system, code, `no ${noun} is linked to LOINC ${loinc}`); continue; }
        if (codes.length > 1) { refuse(line, system, code, `${codes.length} ${noun}s are linked to LOINC ${loinc}`); continue; }
        targetCode = codes[0];
      }

      const existing = await activeFor(system, code, level);
      // Blank target and loinc: leave the code as it is. An exported file lists unmapped codes so.
      if (targetCode === null) { report.counts.unchanged += 1; continue; }
      const current = [...new Set(existing.map((r) => r.to_code))];
      // A row that asks for the target the code already has is no change, central-owned or not, so an
      // untouched export re-imports cleanly. Central only blocks a different target.
      if (current.length === 1 && current[0] === targetCode) { report.counts.unchanged += 1; continue; }
      if (existing.some((r) => r.managed_origin === 'central')) { refuse(line, system, code, `central maps ${code}; a lab cannot change it`); continue; }
      if (existing.length === 0) report.counts.new += 1; else report.counts.changed += 1;
      writes.push({ system, code, catalogCode: targetCode, name: targetsByCode.get(targetCode)!.name });
    }
    return { report, writes };
  }

  async function importPreview(bytes: Uint8Array, level: MapLevel = 'test'): Promise<MappingImportReport> {
    return (await planImport(bytes, level)).report;
  }

  async function importApply(bytes: Uint8Array, level: MapLevel = 'test'): Promise<MappingImportReport> {
    const { report, writes } = await planImport(bytes, level);
    try {
      for (const w of writes) await writeMapping(w.system, w.code, w.catalogCode, w.name, level);
    } catch (err) {
      // Writes already made stay made, so test_map must still catch up with them before the failure goes up.
      await rebuildNow();
      throw err;
    }
    return { ...report, rebuild: await rebuildNow() };
  }

  async function observedSystems(level: MapLevel = 'test'): Promise<string[]> {
    return [...new Set((await observedAll(level)).map((r) => r.system))].sort(compare);
  }

  async function planMatch(system: string): Promise<MatchPlan> {
    if (system.trim() === '') throw new TestCatalogError('system is required', 'invalid');
    const self = selfSystemReason(system, 'result');
    if (self) throw new TestCatalogError(self, 'invalid');
    const params = await readTargets('result');
    // Only unmapped codes. A code central has mapped counts as mapped, even when its field left the dictionary (status 'unmapped' then). An ambiguous one needs a person.
    const rows = (await observedAll('result')).filter((r) => r.system === system && r.status === 'unmapped' && !r.centralManaged && params.has(r.code));
    return { system, matches: rows.map((r) => ({ code: r.code, display: params.get(r.code)!.name, results: r.requests })) };
  }

  async function applyMatch(system: string): Promise<MatchPlan & { rebuild: RebuildOutcome }> {
    const plan = await planMatch(system);
    try {
      for (const m of plan.matches) await writeMapping(system, m.code, m.code, m.display, 'result');
    } catch (err) {
      // As importApply: writes already made stay made, so test_map catches up before the failure goes up.
      await rebuildNow();
      throw err;
    }
    return { ...plan, rebuild: await rebuildNow() };
  }

  async function planPack(mappings: PackMappingInput[], level: MapLevel = 'test'): Promise<PackMappingPlan> {
    const plan: PackMappingPlan = { mapped: [], kept: [], skipped: [] };
    const noun = TARGET_NOUN[level];
    const seen = new Set<string>();
    for (const m of mappings) {
      const key = sourceKey(m.system, m.code);
      if (seen.has(key)) { plan.skipped.push({ system: m.system, code: m.code, reason: 'listed twice in this pack' }); continue; }
      seen.add(key);
      const self = selfSystemReason(m.system, level);
      if (self) { plan.skipped.push({ system: m.system, code: m.code, reason: self }); continue; }
      if ((await activeFor(m.system, m.code, level)).length > 0) { plan.kept.push({ system: m.system, code: m.code }); continue; }
      const codes = await catalogCodesForLoinc(m.loinc, level);
      if (codes.length === 0) { plan.skipped.push({ system: m.system, code: m.code, reason: `no ${noun} is linked to LOINC ${m.loinc}` }); continue; }
      if (codes.length > 1) { plan.skipped.push({ system: m.system, code: m.code, reason: `${codes.length} ${noun}s are linked to LOINC ${m.loinc}` }); continue; }
      plan.mapped.push({ system: m.system, code: m.code, catalogCode: codes[0] });
    }
    return plan;
  }

  async function applyPack(mappings: PackMappingInput[], level: MapLevel = 'test'): Promise<PackMappingPlan & { rebuild: RebuildOutcome }> {
    const plan = await planPack(mappings, level);
    const targetsByCode = await readTargets(level);
    try {
      for (const m of plan.mapped) await writeMapping(m.system, m.code, m.catalogCode, targetsByCode.get(m.catalogCode)?.name ?? null, level);
    } catch (err) {
      // As applyMatch: writes already made stay made, so test_map catches up before the failure goes up.
      await rebuildNow();
      throw err;
    }
    return { ...plan, rebuild: await rebuildNow() };
  }

  return {
    observed, observedAll, targets, publish, rebuildNow, requestRebuild, settled, set, clear, writeMapping, activeFor, readCatalog, readMappings, readTargets,
    exportCsv, importPreview, importApply, catalogCodesForLoinc, planPack, applyPack, observedSystems, planMatch, applyMatch,
  };
}

export type TestMapping = ReturnType<typeof createTestMapping>;
