import type { Kysely } from 'kysely';
import { markTerminologyChanged, type ExternalSchema, type InternalSchema, type TerminologyAdminStore } from '@openldr/db';

// Labels for patient identifier systems (docs/superpowers/specs/2026-10-12-patient-index-design.md,
// section 1). One concept per system URI in a code system CE creates on first write. The concept's
// display is the operator's label. Its properties hold two flags: listColumn (show in the list) and
// searchable (search may match it). Terminology lives in the internal db and identifiers in the
// warehouse, so the two are read separately and joined here.

export const PATIENT_IDENTIFIER_SYSTEM = 'urn:openldr:cs:patient-identifier-system';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const MANAGED_KEYS = ['listColumn', 'searchable'] as const;

export class PatientIndexError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'not-found' | 'central-managed') {
    super(message);
    this.name = 'PatientIndexError';
  }
}

export interface SystemSettings { label: string | null; labelSource: 'operator' | 'source' | 'none'; listColumn: boolean; searchable: boolean }
export interface IdentifierSystemRow {
  system: string | null; label: string | null; labelSource: 'operator' | 'source' | 'none';
  patientCount: number; listColumn: boolean; searchable: boolean;
}
export interface IdentifierSystemList { rows: IdentifierSystemRow[]; total: number; ownedHere: boolean }
export interface IdentifierSystemInput { system: string; label: string | null; listColumn: boolean; searchable: boolean }

export interface PatientIdentifierSystems {
  list(q: { limit: number; offset: number }): Promise<IdentifierSystemList>;
  settings(): Promise<Map<string, SystemSettings>>;
  /** Like settings(), but the source-text scan runs only for the given systems. */
  settingsFor(systems: string[]): Promise<Map<string, SystemSettings>>;
  /** Systems whose concept says searchable is false. Reads concepts only. */
  unsearchableSystems(): Promise<string[]>;
  get(system: string): Promise<IdentifierSystemRow | null>;
  set(input: IdentifierSystemInput): Promise<IdentifierSystemRow>;
  ownedHere(): Promise<boolean>;
}

export function parseSystemListQuery(raw: Record<string, unknown>): { ok: true; query: { limit: number; offset: number } } | { ok: false; error: string } {
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  return { ok: true, query: { limit, offset: Number(offsetRaw) } };
}

export function parseSystemInput(raw: unknown): { ok: true; input: IdentifierSystemInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const system = typeof r.system === 'string' ? r.system.trim() : '';
  if (!system) return { ok: false, error: 'system is required' };
  if (typeof r.listColumn !== 'boolean' || typeof r.searchable !== 'boolean') {
    return { ok: false, error: 'listColumn and searchable must be true or false' };
  }
  if (r.label !== null && r.label !== undefined && typeof r.label !== 'string') return { ok: false, error: 'label must be text' };
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : null;
  return { ok: true, input: { system, label, listColumn: r.listColumn, searchable: r.searchable } };
}

function propsOf(properties: unknown): Record<string, unknown> {
  const value = typeof properties === 'string' ? (JSON.parse(properties) as unknown) : properties;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const compareSystems = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
};

export function createPatientIdentifierSystems(deps: {
  internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; admin: TerminologyAdminStore;
}): PatientIdentifierSystems {
  const { internalDb, externalDb, admin } = deps;

  async function ownedHere(): Promise<boolean> {
    // A lab that pulled this system from central has it stamped 'central' by its terminology drain,
    // as result fields' is (result-fields.ts, ownedHere).
    const row = await internalDb.selectFrom('terminology_systems').select('managed_origin')
      .where('url', '=', PATIENT_IDENTIFIER_SYSTEM).executeTakeFirst();
    return row?.managed_origin !== 'central';
  }

  async function concepts(): Promise<Map<string, { display: string | null; props: Record<string, unknown> }>> {
    const rows = await internalDb.selectFrom('terminology_concepts').select(['code', 'display', 'properties'])
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).execute();
    return new Map(rows.map((r) => [r.code, { display: r.display, props: propsOf(r.properties) }]));
  }

  /** The most common non-empty type_text per system. Ties go to the alphabetically first text. */
  async function sourceTexts(onlySystems?: string[]): Promise<Map<string, string>> {
    if (onlySystems && !onlySystems.length) return new Map();
    let query = externalDb.selectFrom('patient_identifiers')
      .select(['system', 'type_text', (eb) => eb.fn.countAll<string | number>().as('n')])
      .where('system', 'is not', null).where('type_text', 'is not', null);
    if (onlySystems) query = query.where('system', 'in', onlySystems);
    const rows = await query.groupBy(['system', 'type_text']).execute();
    const best = new Map<string, { text: string; n: number }>();
    for (const r of rows) {
      if (!r.system || !r.type_text) continue;
      const n = Number(r.n);
      const cur = best.get(r.system);
      if (!cur || n > cur.n || (n === cur.n && r.type_text < cur.text)) best.set(r.system, { text: r.type_text, n });
    }
    return new Map([...best].map(([s, v]) => [s, v.text]));
  }

  function settingOf(system: string | null, concept: { display: string | null; props: Record<string, unknown> } | undefined, source: string | undefined): SystemSettings {
    const listColumn = concept?.props.listColumn === true;
    const searchable = concept?.props.searchable !== false;
    if (concept?.display) return { label: concept.display, labelSource: 'operator', listColumn, searchable };
    if (system !== null && source) return { label: source, labelSource: 'source', listColumn, searchable };
    return { label: null, labelSource: 'none', listColumn, searchable };
  }

  async function settings(): Promise<Map<string, SystemSettings>> {
    const [c, s] = await Promise.all([concepts(), sourceTexts()]);
    const out = new Map<string, SystemSettings>();
    for (const system of new Set([...c.keys(), ...s.keys()])) out.set(system, settingOf(system, c.get(system), s.get(system)));
    return out;
  }

  async function settingsForSystems(wanted: string[]): Promise<Map<string, SystemSettings>> {
    const [c, s] = await Promise.all([concepts(), sourceTexts(wanted)]);
    const out = new Map<string, SystemSettings>();
    for (const system of new Set([...c.keys(), ...s.keys()])) out.set(system, settingOf(system, c.get(system), s.get(system)));
    return out;
  }

  async function unsearchableSystems(): Promise<string[]> {
    return [...(await concepts())].filter(([, v]) => v.props.searchable === false).map(([system]) => system);
  }

  async function allRows(): Promise<IdentifierSystemRow[]> {
    const [counts, c, s] = await Promise.all([
      externalDb.selectFrom('patient_identifiers')
        .select(['system', (eb) => eb.fn.count<string | number>('patient_id').distinct().as('n')])
        .groupBy('system').execute(),
      concepts(),
      sourceTexts(),
    ]);
    return counts
      .map((r) => ({ system: r.system, patientCount: Number(r.n), ...settingOf(r.system, r.system === null ? undefined : c.get(r.system), r.system === null ? undefined : s.get(r.system)) }))
      .sort((a, b) => compareSystems(a.system, b.system));
  }

  async function list(q: { limit: number; offset: number }): Promise<IdentifierSystemList> {
    const rows = await allRows();
    return { rows: rows.slice(q.offset, q.offset + q.limit), total: rows.length, ownedHere: await ownedHere() };
  }

  async function get(system: string): Promise<IdentifierSystemRow | null> {
    const found = (await allRows()).find((r) => r.system === system);
    if (found) return found;
    const c = (await concepts()).get(system);
    return c ? { system, patientCount: 0, ...settingOf(system, c, undefined) } : null;
  }

  async function set(input: IdentifierSystemInput): Promise<IdentifierSystemRow> {
    if (!(await ownedHere())) {
      throw new PatientIndexError('this lab receives its identifier system labels from central; only central can change them', 'central-managed');
    }
    // NOT SEEDED: the system holds an operator's labels, so the operator can delete it again, as a
    // register's own facility types can (facility-register-vocabulary.ts).
    await admin.codingSystems.upsertByUrl({
      url: PATIENT_IDENTIFIER_SYSTEM, systemCode: 'PATIENT-IDENTIFIER-SYSTEM',
      systemName: 'Patient identifier systems', systemVersion: null, publisherId: 'pub-system', seeded: false,
    });
    const stored = await internalDb.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).where('code', '=', input.system).executeTakeFirst();
    const next: Record<string, unknown> = { ...propsOf(stored?.properties) };
    for (const k of MANAGED_KEYS) delete next[k];
    next.listColumn = input.listColumn;
    next.searchable = input.searchable;
    await internalDb.insertInto('terminology_concepts').values({
      system: PATIENT_IDENTIFIER_SYSTEM, code: input.system, display: input.label, status: 'ACTIVE',
      properties: JSON.stringify(next) as never,
    }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
      display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
    }))).execute();
    // One terminology_system signal per edit, as the test catalog does, so central's labels reach labs.
    await markTerminologyChanged(internalDb, PATIENT_IDENTIFIER_SYSTEM);
    const saved = await get(input.system);
    if (!saved) throw new PatientIndexError(`identifier system ${input.system} was not saved`, 'not-found');
    return saved;
  }

  return { list, settings, settingsFor: settingsForSystems, unsearchableSystems, get, set, ownedHere };
}
