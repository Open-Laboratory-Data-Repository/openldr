import type { Kysely } from 'kysely';
import { testMapId, type ExternalSchema, type InternalSchema, type TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from './test-catalog';

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
      .select(['id', 'from_system', 'from_code', 'to_code', 'to_display', 'map_type', 'managed_origin'])
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

  /** Rebuild test_map now. Never throws: a failure is logged, kept for the Observed list, and returned. */
  async function rebuildNow(): Promise<RebuildOutcome> {
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

  return { observed, observedAll, targets, publish, rebuildNow, readCatalog, readMappings };
}

export type TestMapping = ReturnType<typeof createTestMapping>;
