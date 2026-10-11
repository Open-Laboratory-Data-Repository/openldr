import type { Kysely } from 'kysely';
import type { InternalSchema, TerminologyAdminStore, TermMapping } from '@openldr/db';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM, RESULT_ROLES } from '@openldr/terminology';
import { toCsv } from '@openldr/reporting';
import { isLoincLoaded, LOINC_CODE, TestCatalogError } from './test-catalog';
import { TEST_MAPPING_IMPORT_MAX_BYTES, TEST_MAPPING_IMPORT_MAX_ROWS } from './test-mapping';
import { readTableFile, TableFileError } from './table-file';

// Result fields (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md, 4.2 and 4.5): the
// site's result dictionary, urn:openldr:default_result, with each field's optional LOINC link. A link is
// a term mapping from the field to LOINC, the same shape as a catalog test's link. The routes and the
// CLI call this module (AGENTS.md section 6).

const MAP_TYPE = 'SAME-AS' as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const LOINC_FILTERS = ['linked', 'none', 'all'] as const;
const CSV_COLUMNS = ['code', 'display', 'role', 'units', 'loinc'].map((k) => ({ key: k, label: k }));

export interface ResultField { code: string; display: string | null; role: string | null; units: string | null; loinc: string | null }

export interface ResultFieldQuery { q: string; loinc: 'linked' | 'none' | 'all'; role: string | null; limit: number; offset: number }

export interface ResultFieldList {
  rows: ResultField[];
  total: number;
  /** false when this install received its dictionary from central and may not change its links. */
  ownedHere: boolean;
  /** false when no dictionary is loaded here at all. */
  loaded: boolean;
}

export interface ResultFieldLinkChange { code: string; before: string | null; after: string | null }

export interface ResultFieldImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: Array<{ line: number; code: string; reason: string }>;
}

/** Read list filters from a query string or CLI flags, so both doors refuse a bad value in the same words. */
export function parseResultFieldQuery(raw: Record<string, unknown>): { ok: true; query: ResultFieldQuery } | { ok: false; error: string } {
  const loinc = raw.loinc === undefined || raw.loinc === '' ? 'all' : String(raw.loinc);
  if (!(LOINC_FILTERS as readonly string[]).includes(loinc)) return { ok: false, error: 'loinc must be linked, none or all' };
  const role = raw.role === undefined || raw.role === '' ? null : String(raw.role);
  if (role !== null && !(RESULT_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: `role must be ${RESULT_ROLES.slice(0, -1).join(', ')} or ${RESULT_ROLES[RESULT_ROLES.length - 1]}` };
  }
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  return { ok: true, query: { q, loinc: loinc as ResultFieldQuery['loinc'], role, limit, offset: Number(offsetRaw) } };
}

function propsOf(properties: unknown): Record<string, unknown> {
  const value = typeof properties === 'string' ? (JSON.parse(properties) as unknown) : properties;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
// The export puts an apostrophe before a cell that starts with = @ + - (reporting toCsv). Take it off.
const unguard = (v: string): string => (/^'[=@+-]/.test(v) ? v.slice(1) : v);

export function createResultFields(deps: { db: Kysely<InternalSchema>; admin: TerminologyAdminStore; onChanged?: () => void }) {
  const { db } = deps;
  const invalid = (message: string) => new TestCatalogError(message, 'invalid');

  async function ownedHere(): Promise<boolean> {
    // A lab that pulled central's dictionary has this row stamped 'central' by its terminology drain, as
    // the catalog's row is (test-catalog.ts, ownedHere).
    const row = await db.selectFrom('terminology_systems').select('managed_origin')
      .where('url', '=', RESULT_PARAM_SYSTEM).executeTakeFirst();
    return row?.managed_origin !== 'central';
  }

  async function refuseUnlessOwned(): Promise<void> {
    if (!(await ownedHere())) {
      throw new TestCatalogError('this lab receives its result dictionary from central; only central can change its LOINC links', 'central-managed');
    }
  }

  async function readAll(): Promise<ResultField[]> {
    const concepts = await db.selectFrom('terminology_concepts').select(['code', 'display', 'properties'])
      .where('system', '=', RESULT_PARAM_SYSTEM).execute();
    const links = await db.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', RESULT_PARAM_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    const loinc = new Map(links.map((l) => [l.from_code, l.to_code]));
    return concepts.map((c) => {
      const p = propsOf(c.properties);
      return { code: c.code, display: c.display, role: text(p.result_role), units: text(p.parm_units), loinc: loinc.get(c.code) ?? null };
    }).sort((a, b) => compare(a.code, b.code));
  }

  async function list(query: ResultFieldQuery): Promise<ResultFieldList> {
    const all = await readAll();
    const needle = query.q.toLowerCase();
    const matched = all.filter((f) => (query.loinc === 'all' || (query.loinc === 'linked') === (f.loinc !== null))
      && (query.role === null || f.role === query.role)
      && (needle === '' || [f.code, f.display, f.loinc].some((v) => (v ?? '').toLowerCase().includes(needle))));
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      ownedHere: await ownedHere(),
      loaded: all.length > 0,
    };
  }

  async function currentLink(code: string): Promise<TermMapping | undefined> {
    return (await deps.admin.termMappings.listOutgoing(RESULT_PARAM_SYSTEM, code))
      .find((m) => m.toSystem === LOINC_SYSTEM && m.mapType === MAP_TYPE && m.isActive);
  }

  async function knownLoinc(loinc: string): Promise<boolean> {
    const row = await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', loinc)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The reason a LOINC code is refused, or null. With no LOINC loaded only the shape can be checked. */
  async function loincProblem(loinc: string, loaded: boolean): Promise<string | null> {
    if (!LOINC_CODE.test(loinc)) return `"${loinc}" is not a LOINC code. LOINC codes look like 12345-6.`;
    if (loaded && !(await knownLoinc(loinc))) return `LOINC code ${loinc} is not in the LOINC loaded on this install.`;
    return null;
  }

  async function saveLink(code: string, loinc: string): Promise<void> {
    // saveExclusive keeps one active LOINC link per field and deactivates the old one.
    await deps.admin.termMappings.saveExclusive({
      fromSystem: RESULT_PARAM_SYSTEM, fromCode: code, toSystem: LOINC_SYSTEM, toCode: loinc,
      toDisplay: null, mapType: MAP_TYPE, isActive: true,
    });
  }

  async function link(code: string, loinc: string): Promise<ResultFieldLinkChange> {
    await refuseUnlessOwned();
    if (!(await readAll()).some((f) => f.code === code)) throw new TestCatalogError(`no result field has code ${code}`, 'not-found');
    const wanted = loinc.trim();
    const problem = await loincProblem(wanted, await isLoincLoaded(db));
    if (problem) throw invalid(problem);
    const current = await currentLink(code);
    if (current?.toCode !== wanted) await saveLink(code, wanted);
    deps.onChanged?.();
    return { code, before: current?.toCode ?? null, after: wanted };
  }

  async function unlink(code: string): Promise<ResultFieldLinkChange> {
    await refuseUnlessOwned();
    const current = await currentLink(code);
    if (!current) throw new TestCatalogError(`${code} has no LOINC link`, 'not-found');
    const { id, ...rest } = current;
    await deps.admin.termMappings.update(id, { ...rest, isActive: false });
    deps.onChanged?.();
    return { code, before: current.toCode, after: null };
  }

  async function exportCsv(): Promise<string> {
    return toCsv(CSV_COLUMNS, (await readAll()).map((f) => ({ ...f })));
  }

  async function planImport(bytes: Uint8Array): Promise<{ report: ResultFieldImportReport; writes: Array<{ code: string; loinc: string }> }> {
    await refuseUnlessOwned();
    let table;
    try {
      table = readTableFile(bytes, 'csv', { maxBytes: TEST_MAPPING_IMPORT_MAX_BYTES, maxRows: TEST_MAPPING_IMPORT_MAX_ROWS });
    } catch (err) {
      if (err instanceof TableFileError) throw invalid(err.message);
      throw err;
    }
    const headers = table.headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    const col = (name: string): number => headers.indexOf(name);
    if (col('code') < 0 || col('loinc') < 0) throw invalid('the file needs a code column and a loinc column');
    const cell = (row: string[], name: string): string => (row[col(name)] ?? '').trim();

    const fields = new Map((await readAll()).map((f) => [f.code, f]));
    const loaded = await isLoincLoaded(db);
    const report: ResultFieldImportReport = { counts: { new: 0, changed: 0, unchanged: 0, refused: 0 }, refused: [] };
    const writes: Array<{ code: string; loinc: string }> = [];
    const seen = new Set<string>();
    const refuse = (line: number, code: string, reason: string) => {
      report.counts.refused += 1;
      report.refused.push({ line, code, reason });
    };

    for (let i = 0; i < table.rows.length; i++) {
      const line = i + 2;
      const code = unguard(cell(table.rows[i], 'code'));
      const loinc = cell(table.rows[i], 'loinc');
      if (code === '') { refuse(line, code, 'code is required'); continue; }
      if (seen.has(code)) { refuse(line, code, 'listed twice in the file'); continue; }
      seen.add(code);
      const field = fields.get(code);
      if (!field) { refuse(line, code, `no result field has code ${code}`); continue; }
      // A blank loinc leaves the link as it is. Clearing one is unlink.
      if (loinc === '') { report.counts.unchanged += 1; continue; }
      const problem = await loincProblem(loinc, loaded);
      if (problem) { refuse(line, code, problem); continue; }
      if (field.loinc === loinc) { report.counts.unchanged += 1; continue; }
      if (field.loinc === null) report.counts.new += 1; else report.counts.changed += 1;
      writes.push({ code, loinc });
    }
    return { report, writes };
  }

  async function importPreview(bytes: Uint8Array): Promise<ResultFieldImportReport> {
    return (await planImport(bytes)).report;
  }

  async function importApply(bytes: Uint8Array): Promise<ResultFieldImportReport> {
    const { report, writes } = await planImport(bytes);
    try {
      for (const w of writes) await saveLink(w.code, w.loinc);
    } finally {
      // Links already saved stay saved, so test_map must catch up even when a later write fails.
      if (writes.length > 0) deps.onChanged?.();
    }
    return report;
  }

  return { list, link, unlink, exportCsv, importPreview, importApply, ownedHere };
}

export type ResultFields = ReturnType<typeof createResultFields>;
