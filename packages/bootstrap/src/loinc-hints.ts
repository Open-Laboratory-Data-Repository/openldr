import type { Kysely } from 'kysely';
import { LOCAL_MAP_URL, type InternalSchema, type OntologyStore, type TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM, type Operations } from '@openldr/terminology';
import type { ResultType, TestResultParam } from './result-params';
import type { ResultFields } from './result-fields';
import { reexpandValueSetsForSystem } from './reexpand-value-sets';
import {
  isLoincLoaded, LOINC_CODE, SPECIMEN_TYPE_VALUE_SET, TEST_CATEGORY_VALUE_SET, TestCatalogError,
  type CatalogCategoryOption, type CatalogSpecimenOption,
} from './test-catalog';

// LOINC hints for the test catalog (docs/superpowers/specs/2026-11-23-test-catalog-hints-design.md,
// calls 4 to 7). The route and `openldr test-catalog loinc-hints` / `result-fields from-loinc` both
// call this module (AGENTS.md section 6).
//
// Everything read here is already stored: LOINC's concepts (CLASS, SCALE_TYP and the example unit) and
// the LOINC ontology build (panels, answer lists and SNOMED specimens, packages/db/src/ontology-store.ts).
// Nothing here names a clinical code. Categories and specimen types come from the lab's own value sets.

const SNOMED_SYSTEM = 'http://snomed.info/sct';
/** The value set a coded field from LOINC takes its answers from. One per LOINC code. */
export const LOINC_ANSWERS_VALUE_SET_PREFIX = 'urn:openldr:valueset:loinc-answers:';

/** One SNOMED specimen LOINC names for a code, and the lab's specimen type it matches, if any. */
export interface LoincSpecimenHint {
  snomed: string;
  /** The SNOMED display when SNOMED is loaded here. Null otherwise. */
  display: string | null;
  /** LOINC's equivalence for the map: 'equivalent', 'narrower' and so on. */
  equivalence: string;
  /** The lab's specimen type whose code is this SNOMED code, or which the local map translates to it. */
  specimenType: CatalogSpecimenOption | null;
  /** True on the one match the sheet may tick by itself: the only match, and an equivalent one. */
  tick: boolean;
}

export interface LoincPanelMemberHint {
  code: string;
  display: string;
  required: boolean;
}

export interface LoincHints {
  code: string;
  display: string | null;
  /** LOINC's CLASS, such as CHEM. */
  class: string | null;
  /** The lab's test category whose code or display equals the class. Null when none does. */
  categorySuggestion: CatalogCategoryOption | null;
  /** LOINC's example UCUM unit. Null when LOINC gives none. */
  unit: string | null;
  /** What a result field made from this code would be. */
  resultType: ResultType;
  specimens: LoincSpecimenHint[];
  /** LOINC's answer list, in LOINC's order. Codes are LOINC answer codes (LA...) in http://loinc.org. */
  answers: Array<{ code: string; display: string }>;
  /** Member tests when the code is a panel, in LOINC's order. Empty otherwise. */
  panelMembers: LoincPanelMemberHint[];
}

export interface ResultFieldsFromLoincAnswer {
  /** One entry per field, in the order asked for, or LOINC's panel order. */
  params: TestResultParam[];
  /** Result field codes made by this call. */
  created: string[];
  /** Result field codes that already existed and were used as they are. */
  reused: string[];
  /** Answer value sets made by this call. */
  valueSetsCreated: string[];
}

export interface LoincHintsDeps {
  db: Kysely<InternalSchema>;
  admin: TerminologyAdminStore;
  ops: Operations;
  ontology: Pick<OntologyStore, 'get' | 'panelMembers' | 'answerOptions' | 'specimenCodes'>;
  resultFields: Pick<ResultFields, 'ownedHere' | 'link'>;
}

function propsOf(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const same = (a: string | null, b: string): boolean => a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

export function createLoincHints(deps: LoincHintsDeps) {
  const { db } = deps;
  const invalid = (message: string) => new TestCatalogError(message, 'invalid');

  /** LOINC's coding system id when both LOINC's concepts and its ontology build are here. */
  async function loincSystemId(): Promise<string | null> {
    if (!(await isLoincLoaded(db))) return null;
    const row = await db.selectFrom('coding_systems').select('id').where('url', '=', LOINC_SYSTEM).executeTakeFirst();
    if (!row) return null;
    const dist = await deps.ontology.get(row.id);
    return dist?.indexStatus === 'ready' ? row.id : null;
  }

  async function concept(code: string): Promise<{ display: string | null; props: Record<string, unknown> } | null> {
    const row = await db.selectFrom('terminology_concepts').select(['display', 'properties', 'status'])
      .where('system', '=', LOINC_SYSTEM).where('code', '=', code).executeTakeFirst();
    if (!row || row.status === 'DRAFT') return null;
    return { display: row.display, props: propsOf(row.properties) };
  }

  async function expandEntries(url: string): Promise<CatalogSpecimenOption[]> {
    const vs = await deps.ops.expand(url, { count: 100_000 });
    return (vs.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null }));
  }

  // Both import doors write the class and unit under different keys: `openldr terminology import loinc`
  // keeps LOINC's column names (loaders/loinc.ts), a terms CSV writes class and unit (terms-csv.ts).
  const classOf = (props: Record<string, unknown>) => text(props.CLASS) ?? text(props.class);
  const unitOf = (props: Record<string, unknown>) => text(props.EXAMPLE_UCUM_UNITS) ?? text(props.unit);
  const scaleOf = (props: Record<string, unknown>) => text(props.SCALE_TYP)
    ?? text((props.metadata as Record<string, unknown> | undefined)?.scaleType);

  function resultTypeOf(props: Record<string, unknown>, answers: unknown[]): ResultType {
    if (answers.length > 0) return 'coded';
    return scaleOf(props) === 'Qn' || unitOf(props) !== null ? 'numeric' : 'text';
  }

  async function specimenHints(systemId: string, code: string): Promise<LoincSpecimenHint[]> {
    const maps = await deps.ontology.specimenCodes(systemId, code);
    if (maps.length === 0) return [];
    const types = await expandEntries(SPECIMEN_TYPE_VALUE_SET);
    // Each specimen type's SNOMED codes through the lab's local map ($translate). The list is short.
    const translated = await Promise.all(types.map(async (t) => {
      const res = await deps.ops.translate({ mapUrl: LOCAL_MAP_URL, system: t.system, code: t.code, targetSystem: SNOMED_SYSTEM });
      return new Set(res.matches.map((m) => m.targetCode));
    }));
    const out: LoincSpecimenHint[] = [];
    for (const m of maps) {
      const display = (await deps.ops.lookup(SNOMED_SYSTEM, m.snomedCode)).display;
      const matched = types.filter((t, i) => t.code === m.snomedCode || translated[i]!.has(m.snomedCode));
      if (matched.length === 0) out.push({ snomed: m.snomedCode, display, equivalence: m.equivalence, specimenType: null, tick: false });
      for (const t of matched) out.push({ snomed: m.snomedCode, display, equivalence: m.equivalence, specimenType: t, tick: false });
    }
    // Ticked by itself only when exactly one specimen type matched, through an equivalent map. Several
    // matches are suggested and none is ticked (spec call 4).
    const matches = out.filter((s) => s.specimenType !== null);
    if (matches.length === 1 && matches[0]!.equivalence === 'equivalent') matches[0]!.tick = true;
    return out;
  }

  /** Hints for one LOINC code. Null when LOINC or its ontology is not loaded here. */
  async function hints(rawCode: string): Promise<LoincHints | null> {
    const code = rawCode.trim();
    if (!LOINC_CODE.test(code)) throw invalid(`"${code}" is not a LOINC code. LOINC codes look like 12345-6.`);
    const systemId = await loincSystemId();
    if (!systemId) return null;
    const c = await concept(code);
    if (!c) throw new TestCatalogError(`LOINC code ${code} is not in the LOINC loaded on this install.`, 'not-found');
    const [answers, members, specimens, categories] = await Promise.all([
      deps.ontology.answerOptions(systemId, code),
      deps.ontology.panelMembers(systemId, code),
      specimenHints(systemId, code),
      expandEntries(TEST_CATEGORY_VALUE_SET),
    ]);
    const cls = classOf(c.props);
    const category = cls === null ? undefined : categories.find((o) => same(o.code, cls) || same(o.display, cls));
    return {
      code,
      display: c.display,
      class: cls,
      categorySuggestion: category ? { code: category.code, display: category.display } : null,
      unit: unitOf(c.props),
      resultType: resultTypeOf(c.props, answers),
      specimens,
      answers: answers.map((a) => ({ code: a.value, display: a.label })),
      panelMembers: members.map((m) => ({ code: m.memberLoinc, display: m.displayName, required: m.required })),
    };
  }

  /** The result field already standing for a LOINC code: one with that code, else one linked to it. */
  async function existingField(loinc: string): Promise<string | null> {
    const own = await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', RESULT_PARAM_SYSTEM).where('code', '=', loinc).executeTakeFirst();
    if (own) return own.code;
    const linked = await db.selectFrom('term_mappings').select('from_code')
      .where('from_system', '=', RESULT_PARAM_SYSTEM).where('to_system', '=', LOINC_SYSTEM).where('to_code', '=', loinc)
      .where('map_type', '=', 'SAME-AS').where('is_active', '=', true)
      .orderBy('from_code').executeTakeFirst();
    return linked?.from_code ?? null;
  }

  async function ensureAnswers(loinc: string, answers: Array<{ value: string; label: string }>): Promise<{ url: string; created: boolean }> {
    const url = `${LOINC_ANSWERS_VALUE_SET_PREFIX}${loinc}`;
    if (await deps.admin.valueSets.getByUrl(url)) return { url, created: false };
    // LOINC answer codes (LA...) are LOINC codes, so the set lists them under http://loinc.org.
    await deps.admin.valueSets.save({
      url, name: `loinc-answers-${loinc}`, title: `LOINC answers for ${loinc}`, status: 'active',
      description: `LOINC's answer list for ${loinc}, made when a result field was made from it.`,
      compose: { include: [{ system: LOINC_SYSTEM, concept: answers.map((a) => ({ code: a.value, display: a.label })) }] },
    });
    return { url, created: true };
  }

  /**
   * Make the result fields for these LOINC codes, or for each panel's members with `panel`. A field
   * that already stands for a code is used as it is, and an answer set that already exists is kept, so
   * a second call makes nothing new (spec call 6).
   */
  async function resultFieldsFromLoinc(rawCodes: string[], opts: { panel?: boolean } = {}): Promise<ResultFieldsFromLoincAnswer> {
    const asked = [...new Set(rawCodes.map((c) => c.trim()).filter((c) => c !== ''))];
    if (asked.length === 0) throw invalid('name at least one LOINC code');
    for (const c of asked) if (!LOINC_CODE.test(c)) throw invalid(`"${c}" is not a LOINC code. LOINC codes look like 12345-6.`);
    if (!(await deps.resultFields.ownedHere())) {
      throw new TestCatalogError('this lab receives its result dictionary from central; only central can add result fields', 'central-managed');
    }
    const systemId = await loincSystemId();
    if (!systemId) throw invalid('LOINC and its ontology must be loaded here first. Import LOINC with openldr terminology import loinc.');

    // Each wanted code with the name to give it when LOINC's concept has none.
    const wanted: Array<{ code: string; name: string | null }> = [];
    for (const c of asked) {
      if (!opts.panel) { wanted.push({ code: c, name: null }); continue; }
      const members = await deps.ontology.panelMembers(systemId, c);
      if (members.length === 0) throw invalid(`LOINC code ${c} is not a panel, so it has no member tests.`);
      for (const m of members) wanted.push({ code: m.memberLoinc, name: m.displayName });
    }

    const answer: ResultFieldsFromLoincAnswer = { params: [], created: [], reused: [], valueSetsCreated: [] };
    const seen = new Set<string>();
    const newRows: Array<{ code: string; display: string; units: string | null; inLoinc: boolean }> = [];
    const planned: Array<{ code: string; fieldCode: string | null; type: ResultType; answers: Array<{ value: string; label: string }> }> = [];
    for (const w of wanted) {
      if (seen.has(w.code)) continue;
      seen.add(w.code);
      const c = await concept(w.code);
      if (!c && w.name === null) throw new TestCatalogError(`LOINC code ${w.code} is not in the LOINC loaded on this install.`, 'not-found');
      const answers = await deps.ontology.answerOptions(systemId, w.code);
      const props = c?.props ?? {};
      const fieldCode = await existingField(w.code);
      if (fieldCode === null) newRows.push({ code: w.code, display: c?.display ?? w.name ?? w.code, units: unitOf(props), inLoinc: c !== null });
      planned.push({ code: w.code, fieldCode, type: resultTypeOf(props, answers), answers });
    }

    if (newRows.length > 0) {
      await deps.admin.terms.importRows(newRows.map((r) => ({
        system: RESULT_PARAM_SYSTEM, code: r.code, display: r.display, status: 'ACTIVE',
        properties: { result_role: 'result', ...(r.units ? { parm_units: r.units } : {}) },
      })));
      // The test sheet's picker and the save check read the reportable-result set, built on this system.
      await reexpandValueSetsForSystem(deps.admin, RESULT_PARAM_SYSTEM);
      // The same link the Result fields page saves, so test mapping carries the LOINC code. A panel
      // member missing from the loaded LOINC cannot be linked (result-fields.ts refuses it), so it is not.
      for (const r of newRows) if (r.inLoinc) await deps.resultFields.link(r.code, r.code);
    }

    for (const p of planned) {
      const code = p.fieldCode ?? p.code;
      if (p.fieldCode === null) answer.created.push(code); else answer.reused.push(code);
      let valueSetUrl: string | null = null;
      if (p.type === 'coded') {
        const vs = await ensureAnswers(p.code, p.answers);
        valueSetUrl = vs.url;
        if (vs.created) answer.valueSetsCreated.push(vs.url);
      }
      answer.params.push({ system: RESULT_PARAM_SYSTEM, code, resultType: p.type, valueSetUrl, bands: [] });
    }
    return answer;
  }

  return { hints, resultFieldsFromLoinc };
}

export type LoincHintsService = ReturnType<typeof createLoincHints>;
