import type { Kysely } from 'kysely';
import { testMapId, type ExternalSchema, type InternalSchema, type MapType, type TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM } from '@openldr/terminology';
import { toCsv } from '@openldr/reporting';
import { TEST_CATALOG_SYSTEM, TestCatalogError } from './test-catalog';
import { readTableFile, TableFileError } from './table-file';

// Test mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md). Each lab's own test codes,
// as the warehouse stores them in lab_requests.panel_system and panel_code, map to catalog tests
// through ordinary term_mappings rows. The route, the CLI and the content pack installer all call
// this module (AGENTS.md section 6), and test_map is the warehouse copy report SQL joins.

/** Must equal the map type the catalog's LOINC link uses (test-catalog.ts, LOINC_MAP_TYPE). */
const MAP_TYPE = 'SAME-AS' as const;
/** The catalog's retired status (test-catalog.ts, RETIRED_STATUS). */
const RETIRED = 'DEPRECATED';
/** 9 columns per row keeps one insert under MSSQL's ~2,000 bound parameters. */
const INSERT_CHUNK = 200;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const STATUSES = ['unmapped', 'mapped', 'ambiguous', 'all'] as const;

export type ObservedStatus = 'unmapped' | 'mapped' | 'ambiguous';

export interface ObservedTestCode {
  system: string;
  code: string;
  description: string | null;
  /** Requests carrying this code in the warehouse. 0 for a code mapped before any data arrived. */
  requests: number;
  lastSeen: string | null;
  status: ObservedStatus;
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

export interface TestMapPublishResult {
  mapped: number;
  ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>;
  targetMissing: Array<{ system: string; code: string; catalogCode: string }>;
  written: number;
}

export type RebuildOutcome = { ok: true; result: TestMapPublishResult } | { ok: false; error: string };

export interface TestMappingDeps {
  internalDb: Kysely<InternalSchema>;
  externalDb: Kysely<ExternalSchema>;
  admin: TerminologyAdminStore;
  logger: { warn(obj: object, msg: string): void };
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

/** A term mapping into the catalog is a test mapping. One out of the catalog is its LOINC link. Both
 *  change test_map. */
export function mappingTouchesTestMap(fromSystem: string | null | undefined, toSystem: string | null | undefined): boolean {
  return toSystem === TEST_CATALOG_SYSTEM || fromSystem === TEST_CATALOG_SYSTEM;
}

/** Whether a record a lab pulled from central changes test_map. A term mapping delete carries no body,
 *  so it counts: a spare rebuild is cheap, a missed one leaves reports wrong. */
export function isTestMapRelevantRecord(rec: { entityType: string; body?: unknown }): boolean {
  const body = rec.body as { fromSystem?: string; toSystem?: string; url?: string } | null;
  if (rec.entityType === 'term_mapping') return body === null || body === undefined || mappingTouchesTestMap(body.fromSystem, body.toSystem);
  if (rec.entityType === 'terminology_system') return body?.url === TEST_CATALOG_SYSTEM;
  return false;
}

export const TEST_MAPPING_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const TEST_MAPPING_IMPORT_MAX_ROWS = 20_000;

const CSV_COLUMNS = ['system', 'code', 'description', 'requests', 'catalog_code', 'loinc'].map((k) => ({ key: k, label: k }));

export interface MappingImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: Array<{ line: number; system: string; code: string; reason: string }>;
  /** Set by apply. Null for a preview. */
  rebuild: RebuildOutcome | null;
}

type PlannedRow = { system: string; code: string; catalogCode: string; name: string | null };

export function createTestMapping(deps: TestMappingDeps) {
  const { internalDb, externalDb } = deps;
  let lastRebuild: { ok: boolean; error: string | null } = { ok: true, error: null };

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

  async function readMappings(): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(MAPPING_COLUMNS)
      .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();
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
      const targets = [...new Set(group.map((g) => g.to_code))].sort(compare);
      const resolved: Resolved = targets.length > 1
        ? { kind: 'ambiguous', catalogCodes: targets }
        : catalog.has(targets[0]) ? { kind: 'mapped', catalogCode: targets[0] } : { kind: 'missing', catalogCode: targets[0] };
      out.set(k, { system: group[0].from_system, code: group[0].from_code, resolved, central: group.some((g) => g.managed_origin === 'central') });
    }
    return out;
  }

  async function publish(opts: { apply: boolean }): Promise<TestMapPublishResult> {
    const catalog = await readCatalog();
    const resolved = [...resolveAll(await readMappings(), catalog).values()];
    const mapped = resolved.filter((r) => r.resolved.kind === 'mapped');
    const rows = mapped.map((r) => {
      const catalogCode = (r.resolved as { catalogCode: string }).catalogCode;
      const entry = catalog.get(catalogCode)!;
      return {
        id: testMapId('test', r.system, r.code), level: 'test', source_system: r.system, source_code: r.code,
        catalog_code: catalogCode, catalog_name: entry.name, category: entry.category, loinc: entry.loinc,
      };
    });
    const result: TestMapPublishResult = {
      mapped: mapped.length,
      ambiguous: resolved.flatMap((r) => (r.resolved.kind === 'ambiguous' ? [{ system: r.system, code: r.code, catalogCodes: r.resolved.catalogCodes }] : [])),
      targetMissing: resolved.flatMap((r) => (r.resolved.kind === 'missing' ? [{ system: r.system, code: r.code, catalogCode: r.resolved.catalogCode }] : [])),
      written: rows.length,
    };
    if (!opts.apply) return result;
    // Delete then insert in one transaction, so a reader never sees the table empty. Only this
    // level's rows: the result-field slice owns the 'result' rows.
    await externalDb.transaction().execute(async (trx) => {
      await trx.deleteFrom('test_map').where('level', '=', 'test').execute();
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

  async function readObservedGroups(): Promise<Array<{ system: string; code: string; description: string | null; requests: number; lastSeen: string | null }>> {
    const rows = await externalDb.selectFrom('lab_requests')
      .select((eb) => [
        'panel_system', 'panel_code',
        eb.fn.max('panel_desc').as('description'),
        eb.fn.countAll().as('requests'),
        eb.fn.max('authored_at').as('last_seen'),
      ])
      .where('panel_system', 'is not', null)
      .where('panel_code', 'is not', null)
      .groupBy(['panel_system', 'panel_code'])
      .execute();
    return rows.map((r) => {
      const last = r.last_seen as unknown;
      return {
        system: r.panel_system as string, code: r.panel_code as string,
        description: (r.description as string | null) ?? null,
        requests: Number(r.requests),
        lastSeen: last === null || last === undefined ? null : last instanceof Date ? last.toISOString() : String(last),
      };
    });
  }

  async function observedAll(): Promise<ObservedTestCode[]> {
    const catalog = await readCatalog();
    const resolved = resolveAll(await readMappings(), catalog);
    const seen = new Map((await readObservedGroups()).map((g) => [sourceKey(g.system, g.code), g]));
    // A code mapped before any data arrived is still listed, so a CLI-made mapping is never invisible.
    for (const [k, r] of resolved) {
      if (!seen.has(k)) seen.set(k, { system: r.system, code: r.code, description: null, requests: 0, lastSeen: null });
    }
    const rows = [...seen.entries()].map(([k, g]): ObservedTestCode => {
      const r = resolved.get(k);
      const kind = r?.resolved.kind;
      const catalogCode = kind === 'mapped' ? (r!.resolved as { catalogCode: string }).catalogCode : null;
      const entry = catalogCode ? catalog.get(catalogCode)! : null;
      return {
        ...g,
        status: kind === 'mapped' ? 'mapped' : kind === 'ambiguous' ? 'ambiguous' : 'unmapped',
        catalog: catalogCode ? { code: catalogCode, name: entry!.name, loinc: entry!.loinc } : null,
        centralManaged: r?.central ?? false,
      };
    });
    return rows.sort((a, b) => compare(a.system, b.system) || compare(a.code, b.code));
  }

  async function observed(query: ObservedQuery): Promise<ObservedResult> {
    const needle = query.q.toLowerCase();
    const matched = (await observedAll()).filter((r) => (query.status === 'all' || r.status === query.status)
      && (needle === '' || [r.code, r.description, r.catalog?.name].some((v) => (v ?? '').toLowerCase().includes(needle))));
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      warehouse: { stale: !lastRebuild.ok, error: lastRebuild.error },
    };
  }

  async function targets(): Promise<CatalogTarget[]> {
    return [...(await readCatalog()).entries()]
      .map(([code, e]) => ({ code, name: e.name, loinc: e.loinc, retired: e.retired }))
      .sort((a, b) => compare(a.code, b.code));
  }

  async function activeFor(system: string, code: string): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(MAPPING_COLUMNS)
      .where('from_system', '=', system).where('from_code', '=', code)
      .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();
  }

  function assertSource(system: string, code: string): void {
    if (system.trim() === '' || code.trim() === '') throw new TestCatalogError('system and code are required', 'invalid');
  }

  function assertNotCentral(rows: MappingRow[], code: string): void {
    if (rows.some((r) => r.managed_origin === 'central')) {
      throw new TestCatalogError(`central maps ${code}; a lab cannot change it`, 'central-managed');
    }
  }

  async function deactivate(row: MappingRow): Promise<void> {
    await deps.admin.termMappings.update(row.id, {
      fromSystem: row.from_system, fromCode: row.from_code, toSystem: TEST_CATALOG_SYSTEM, toCode: row.to_code,
      toDisplay: row.to_display, mapType: row.map_type as MapType, isActive: false,
    });
  }

  /** Make `catalogCode` the one active catalog mapping for this code. No guard and no rebuild: the
   *  callers (set, CSV import, pack install) check first and rebuild once at the end. */
  async function writeMapping(system: string, code: string, catalogCode: string, name: string | null): Promise<void> {
    const saved = await deps.admin.termMappings.saveExclusive({
      fromSystem: system, fromCode: code, toSystem: TEST_CATALOG_SYSTEM, toCode: catalogCode,
      toDisplay: name, mapType: MAP_TYPE, isActive: true,
    });
    // saveExclusive supersedes only SAME-AS rows. One made through the general mapping dialog with
    // another type would stay active and make the code ambiguous, so it goes too.
    for (const other of await activeFor(system, code)) {
      if (other.id !== saved.mapping.id) await deactivate(other);
    }
  }

  async function set(system: string, code: string, catalogCode: string): Promise<TestMappingChange> {
    assertSource(system, code);
    const entry = (await readCatalog()).get(catalogCode);
    if (!entry) throw new TestCatalogError(`no catalog test has code ${catalogCode}`, 'invalid');
    const existing = await activeFor(system, code);
    assertNotCentral(existing, code);
    const before = existing.map((r) => r.to_code).sort(compare)[0] ?? null;
    await writeMapping(system, code, catalogCode, entry.name);
    return { system, code, before, after: catalogCode, rebuild: await rebuildNow() };
  }

  async function clear(system: string, code: string): Promise<TestMappingChange> {
    assertSource(system, code);
    const existing = await activeFor(system, code);
    if (existing.length === 0) throw new TestCatalogError(`${code} has no catalog mapping`, 'not-found');
    assertNotCentral(existing, code);
    for (const row of existing) await deactivate(row);
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

  async function catalogCodesForLoinc(loinc: string): Promise<string[]> {
    const rows = await internalDb.selectFrom('term_mappings').select('from_code')
      .where('from_system', '=', TEST_CATALOG_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('to_code', '=', loinc).where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    return [...new Set(rows.map((r) => r.from_code))].sort(compare);
  }

  async function exportCsv(): Promise<string> {
    const rows = await observedAll();
    return toCsv(CSV_COLUMNS, rows.map((r) => ({
      system: r.system, code: r.code, description: r.description, requests: r.requests,
      catalog_code: r.catalog?.code ?? null, loinc: r.catalog?.loinc ?? null,
    })));
  }

  async function planImport(bytes: Uint8Array): Promise<{ report: MappingImportReport; writes: PlannedRow[] }> {
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
    if (col('catalog_code') < 0 && col('loinc') < 0) throw new TestCatalogError('the file needs a catalog_code column or a loinc column', 'invalid');
    const cell = (row: string[], name: string): string => (col(name) < 0 ? '' : (row[col(name)] ?? '').trim());

    const catalog = await readCatalog();
    // One warehouse read per import. A code the warehouse holds with surrounding spaces is a different
    // code from its trimmed form, and a file cell cannot carry the spaces (readTableFile trims every cell).
    const observedCodes = new Map<string, Set<string>>();
    for (const g of await readObservedGroups()) {
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
      const system = cell(table.rows[i], 'system');
      const code = cell(table.rows[i], 'code');
      if (system === '' || code === '') { refuse(line, system, code, 'system and code are required'); continue; }
      const key = sourceKey(system, code);
      if (seen.has(key)) { refuse(line, system, code, 'listed twice in the file'); continue; }
      seen.add(key);
      if (heldWithSpaces(system, code)) {
        refuse(line, system, code, 'the warehouse holds this code with surrounding spaces; map it on the Observed tab or with map set');
        continue;
      }

      const catalogCodeCell = cell(table.rows[i], 'catalog_code');
      const loinc = cell(table.rows[i], 'loinc');
      let catalogCode: string | null = null;
      if (catalogCodeCell !== '') {
        if (!catalog.has(catalogCodeCell)) { refuse(line, system, code, `no catalog test has code ${catalogCodeCell}`); continue; }
        catalogCode = catalogCodeCell;
      } else if (loinc !== '') {
        const codes = await catalogCodesForLoinc(loinc);
        if (codes.length === 0) { refuse(line, system, code, `no catalog test is linked to LOINC ${loinc}`); continue; }
        if (codes.length > 1) { refuse(line, system, code, `${codes.length} catalog tests are linked to LOINC ${loinc}`); continue; }
        catalogCode = codes[0];
      }

      const existing = await activeFor(system, code);
      // Blank catalog_code and loinc: leave the code as it is. An exported file lists unmapped codes so.
      if (catalogCode === null) { report.counts.unchanged += 1; continue; }
      const targets = [...new Set(existing.map((r) => r.to_code))];
      // A row that asks for the target the code already has is no change, central-owned or not, so an
      // untouched export re-imports cleanly. Central only blocks a different target.
      if (targets.length === 1 && targets[0] === catalogCode) { report.counts.unchanged += 1; continue; }
      if (existing.some((r) => r.managed_origin === 'central')) { refuse(line, system, code, `central maps ${code}; a lab cannot change it`); continue; }
      if (existing.length === 0) report.counts.new += 1; else report.counts.changed += 1;
      writes.push({ system, code, catalogCode, name: catalog.get(catalogCode)!.name });
    }
    return { report, writes };
  }

  async function importPreview(bytes: Uint8Array): Promise<MappingImportReport> {
    return (await planImport(bytes)).report;
  }

  async function importApply(bytes: Uint8Array): Promise<MappingImportReport> {
    const { report, writes } = await planImport(bytes);
    for (const w of writes) await writeMapping(w.system, w.code, w.catalogCode, w.name);
    return { ...report, rebuild: await rebuildNow() };
  }

  return {
    observed, observedAll, targets, publish, rebuildNow, requestRebuild, settled, set, clear, writeMapping, activeFor, readCatalog, readMappings,
    exportCsv, importPreview, importApply, catalogCodesForLoinc,
  };
}

export type TestMapping = ReturnType<typeof createTestMapping>;
