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
/** Local map equivalences that say a specimen type is the SNOMED code itself. The Terminology page writes
 *  its map type (SAME-AS) here; an imported FHIR ConceptMap writes equivalent or equal. A wider, narrower
 *  or related map is suggested but never ticked. */
const SAME_EQUIVALENCES = new Set(['same-as', 'equivalent', 'equal']);
/** A retired result field. Terminology's statuses are ACTIVE, DRAFT, DEPRECATED and DISABLED. */
const RETIRED_STATUSES = new Set(['DEPRECATED', 'DISABLED']);
/** The value set a coded field from LOINC takes its answers from. One per LOINC code. */
export const LOINC_ANSWERS_VALUE_SET_PREFIX = 'urn:openldr:valueset:loinc-answers:';

/** One SNOMED specimen LOINC names for a code, and the lab's specimen type it matches, if any. Or, when
 *  LOINC links no specimen to the code, a specimen type whose name matches LOINC's SYSTEM part. */
export interface LoincSpecimenHint {
  /** The SNOMED code. Null on a match by name. */
  snomed: string | null;
  /** The SNOMED display when SNOMED is loaded here. Null otherwise. */
  display: string | null;
  /** LOINC's equivalence for the map: 'equivalent', 'narrower' and so on. Null on a match by name. */
  equivalence: string | null;
  /** The lab's specimen type whose code is this SNOMED code, or which the local map translates to it. */
  specimenType: CatalogSpecimenOption | null;
  /** True on the one match the sheet may tick by itself: the only match, and an equivalent one. */
  tick: boolean;
  /** How the match was found: LOINC's SNOMED link, or LOINC's SYSTEM part against the specimen type's name. */
  via: 'snomed' | 'system-name';
}

/** The result field a LOINC code becomes on a test. */
export interface LoincFieldPlan {
  loinc: string;
  /** The dictionary field that already stands for the code (may be another code, CHOL for 2093-3), else the LOINC code. */
  code: string;
  /** LOINC's COMPONENT ("HIV 1 RNA"); the long name, then the panel member name, when it has none. */
  display: string;
  /** Qn is numeric, Ord with answers is coded, anything else is text (spec call 3). */
  resultType: ResultType;
  /** LOINC's example unit. Numeric only. */
  unit: string | null;
  /** Coded only: `${LOINC_ANSWERS_VALUE_SET_PREFIX}${loinc}`. */
  valueSetUrl: string | null;
  /** True when `code` is already a dictionary field. False means Save makes it. */
  exists: boolean;
}

export interface LoincPanelMemberHint {
  code: string;
  display: string;
  required: boolean;
  field: LoincFieldPlan | null;
  /** Why `field` is null: the field standing for the code has another role or is retired. */
  fieldProblem: string | null;
}

export interface LoincHints {
  code: string;
  display: string | null;
  /** LOINC's SHORTNAME, or a terms CSV's shortName. */
  shortName: string | null;
  /** LOINC's COMPONENT. */
  component: string | null;
  /** LOINC's SYSTEM part, such as "Ser/Plas". */
  systemPart: string | null;
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
  /** The result field this code becomes. Null for a panel, or when the existing field is unusable. */
  field: LoincFieldPlan | null;
  /** Why `field` is null on a code that is not a panel: the refusal that existingField gives. */
  fieldProblem: string | null;
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

  // Both import doors write LOINC's facts under different keys: `openldr terminology import loinc` keeps
  // LOINC's column names (loaders/loinc.ts), a terms CSV writes class, unit, shortName and a metadata
  // object (terms-csv.ts).
  const meta = (props: Record<string, unknown>) => (props.metadata ?? {}) as Record<string, unknown>;
  const classOf = (props: Record<string, unknown>) => text(props.CLASS) ?? text(props.class);
  const unitOf = (props: Record<string, unknown>) => text(props.EXAMPLE_UCUM_UNITS) ?? text(props.unit);
  const shortNameOf = (props: Record<string, unknown>) => text(props.SHORTNAME) ?? text(props.shortName);
  const componentOf = (props: Record<string, unknown>) => text(props.COMPONENT) ?? text(meta(props).component);
  const systemPartOf = (props: Record<string, unknown>) => text(props.SYSTEM) ?? text(meta(props).loincSystem);
  const scaleOf = (props: Record<string, unknown>) => text(props.SCALE_TYP) ?? text(meta(props).scaleType);

  /** Spec call 3, as Corlix: Qn is numeric, Ord with an answer list is coded, anything else is text. */
  function resultTypeOf(props: Record<string, unknown>, answers: unknown[]): ResultType {
    const scale = scaleOf(props)?.toLowerCase();
    if (scale === 'qn') return 'numeric';
    if (scale === 'ord' && answers.length > 0) return 'coded';
    return 'text';
  }

  /**
   * Corlix's fallback when LOINC links no specimen to the code: a specimen type whose name equals LOINC's
   * SYSTEM part, or which the part contains, compared lowercase. This is wider than Corlix's `includes`,
   * because LOINC writes abbreviations: each piece of the part split on "/" also matches a name it
   * abbreviates, that is a name starting with the same letter that holds the piece's letters in order.
   * So "Ser/Plas" matches Serum and Plasma, and "Bld" matches Blood. One match is ticked, several are not.
   */
  async function specimensByName(systemPart: string | null): Promise<LoincSpecimenHint[]> {
    if (systemPart === null) return [];
    const part = systemPart.toLowerCase();
    const pieces = part.split('/').map((p) => p.trim()).filter((p) => p !== '');
    const abbreviates = (piece: string, name: string): boolean => {
      if (name[0] !== piece[0]) return false;
      let i = 0;
      for (const ch of name) if (ch === piece[i]) i += 1;
      return i === piece.length;
    };
    const types = await expandEntries(SPECIMEN_TYPE_VALUE_SET);
    const out: LoincSpecimenHint[] = [];
    for (const t of types) {
      const name = (t.display ?? '').trim().toLowerCase();
      if (name === '') continue;
      if (part === name || part.includes(name) || pieces.some((p) => abbreviates(p, name))) {
        out.push({ snomed: null, display: null, equivalence: null, specimenType: t, tick: false, via: 'system-name' });
      }
    }
    if (out.length === 1) out[0]!.tick = true;
    return out;
  }

  async function specimenHints(systemId: string, code: string, systemPart: string | null): Promise<LoincSpecimenHint[]> {
    const maps = await deps.ontology.specimenCodes(systemId, code);
    if (maps.length === 0) return specimensByName(systemPart);
    const types = await expandEntries(SPECIMEN_TYPE_VALUE_SET);
    // Each specimen type's SNOMED codes through the lab's local map ($translate). The list is short.
    const translated = await Promise.all(types.map(async (t) => {
      const res = await deps.ops.translate({ mapUrl: LOCAL_MAP_URL, system: t.system, code: t.code, targetSystem: SNOMED_SYSTEM });
      const exact = new Set<string>();
      const any = new Set<string>();
      for (const m of res.matches) {
        any.add(m.targetCode);
        if (SAME_EQUIVALENCES.has((m.equivalence ?? '').toLowerCase())) exact.add(m.targetCode);
      }
      return { exact, any };
    }));
    // A type whose own code is the SNOMED code, or whose local map says it is the same, is an exact match.
    const exactMatches = new Set<LoincSpecimenHint>();
    const out: LoincSpecimenHint[] = [];
    for (const m of maps) {
      const display = (await deps.ops.lookup(SNOMED_SYSTEM, m.snomedCode)).display;
      let any = false;
      types.forEach((t, i) => {
        const own = t.code === m.snomedCode;
        if (!own && !translated[i]!.any.has(m.snomedCode)) return;
        any = true;
        const hint: LoincSpecimenHint = { snomed: m.snomedCode, display, equivalence: m.equivalence, specimenType: t, tick: false, via: 'snomed' };
        if (own || translated[i]!.exact.has(m.snomedCode)) exactMatches.add(hint);
        out.push(hint);
      });
      if (!any) out.push({ snomed: m.snomedCode, display, equivalence: m.equivalence, specimenType: null, tick: false, via: 'snomed' });
    }
    // Ticked by itself only when exactly one specimen type matched, LOINC's map is equivalent, and the lab's
    // match is exact. Several matches are suggested and none is ticked (spec call 4).
    const matches = out.filter((s) => s.specimenType !== null);
    if (matches.length === 1 && matches[0]!.equivalence === 'equivalent' && exactMatches.has(matches[0]!)) matches[0]!.tick = true;
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
    const systemPart = systemPartOf(c.props);
    const [answers, members, specimens, categories] = await Promise.all([
      deps.ontology.answerOptions(systemId, code),
      deps.ontology.panelMembers(systemId, code),
      specimenHints(systemId, code, systemPart),
      expandEntries(TEST_CATEGORY_VALUE_SET),
    ]);
    const cls = classOf(c.props);
    const category = cls === null ? undefined : categories.find((o) => same(o.code, cls) || same(o.display, cls));
    const panelMembers: LoincPanelMemberHint[] = [];
    for (const m of members) {
      panelMembers.push({ code: m.memberLoinc, display: m.displayName, required: m.required, ...(await fieldHint(systemId, m.memberLoinc, m.displayName)) });
    }
    // A panel is not a result field itself. Its members are.
    const own = members.length > 0 ? { field: null, fieldProblem: null } : await fieldHint(systemId, code, null);
    return {
      code,
      display: c.display,
      shortName: shortNameOf(c.props),
      component: componentOf(c.props),
      systemPart,
      class: cls,
      categorySuggestion: category ? { code: category.code, display: category.display } : null,
      unit: unitOf(c.props),
      resultType: resultTypeOf(c.props, answers),
      specimens,
      answers: answers.map((a) => ({ code: a.value, display: a.label })),
      panelMembers,
      ...own,
    };
  }

  /** A field plan for a hint. An unusable existing field gives no plan and its refusal, never a throw. */
  async function fieldHint(systemId: string, loinc: string, fallbackName: string | null): Promise<{ field: LoincFieldPlan | null; fieldProblem: string | null }> {
    try {
      return { field: (await planField(systemId, loinc, fallbackName)).plan, fieldProblem: null };
    } catch (err) {
      if (err instanceof TestCatalogError && err.kind === 'invalid') return { field: null, fieldProblem: err.message };
      throw err;
    }
  }

  /** The code's active LOINC link, or null. */
  async function loincLinkOf(code: string): Promise<string | null> {
    const row = await db.selectFrom('term_mappings').select('to_code')
      .where('from_system', '=', RESULT_PARAM_SYSTEM).where('from_code', '=', code).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', 'SAME-AS').where('is_active', '=', true).executeTakeFirst();
    return row?.to_code ?? null;
  }

  /**
   * The result field already standing for a LOINC code: one with that code, else one linked to it. A
   * field of another kind, or a retired one, is refused, since a test could not name it (the picker and
   * the save check offer only active fields whose result_role is result).
   */
  async function existingField(loinc: string): Promise<{ code: string; needsLink: boolean } | null> {
    let row = await db.selectFrom('terminology_concepts').select(['code', 'status', 'properties'])
      .where('system', '=', RESULT_PARAM_SYSTEM).where('code', '=', loinc).executeTakeFirst();
    let needsLink = false;
    if (row) {
      // A field made by an earlier call that stopped before its link was saved: link it now.
      needsLink = (await loincLinkOf(row.code)) === null;
    } else {
      const linked = await db.selectFrom('term_mappings').select('from_code')
        .where('from_system', '=', RESULT_PARAM_SYSTEM).where('to_system', '=', LOINC_SYSTEM).where('to_code', '=', loinc)
        .where('map_type', '=', 'SAME-AS').where('is_active', '=', true)
        .orderBy('from_code').executeTakeFirst();
      if (!linked) return null;
      row = await db.selectFrom('terminology_concepts').select(['code', 'status', 'properties'])
        .where('system', '=', RESULT_PARAM_SYSTEM).where('code', '=', linked.from_code).executeTakeFirst();
      if (!row) return null;
    }
    const role = text(propsOf(row.properties).result_role);
    if (role !== 'result') {
      throw invalid(`result field ${row.code} stands for LOINC ${loinc} but its role is ${role ?? 'not set'}, not result. Change its role or pick another code.`);
    }
    if (row.status !== null && RETIRED_STATUSES.has(row.status)) {
      throw invalid(`result field ${row.code} stands for LOINC ${loinc} but is retired (${row.status}). Make it active again first.`);
    }
    return { code: row.code, needsLink };
  }

  /**
   * The one place a LOINC code's result field is worked out, so the hint, the sheet's draft and the
   * saved field agree on name and type. `fallbackName` names a code missing from the loaded LOINC.
   * Throws when the code is missing and has no name, or when the field standing for it is unusable.
   */
  async function planField(systemId: string, loinc: string, fallbackName: string | null) {
    const c = await concept(loinc);
    if (!c && fallbackName === null) throw new TestCatalogError(`LOINC code ${loinc} is not in the LOINC loaded on this install.`, 'not-found');
    const props = c?.props ?? {};
    const answers = await deps.ontology.answerOptions(systemId, loinc);
    const existing = await existingField(loinc);
    const resultType = resultTypeOf(props, answers);
    const plan: LoincFieldPlan = {
      loinc,
      code: existing?.code ?? loinc,
      display: componentOf(props) ?? c?.display ?? fallbackName ?? loinc,
      resultType,
      unit: resultType === 'numeric' ? unitOf(props) : null,
      valueSetUrl: resultType === 'coded' ? `${LOINC_ANSWERS_VALUE_SET_PREFIX}${loinc}` : null,
      exists: existing !== null,
    };
    return { plan, answers, inLoinc: c !== null, needsLink: existing?.needsLink ?? false };
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
  async function resultFieldsFromLoinc(rawCodes: string[], opts: { panel?: boolean; names?: Record<string, string> } = {}): Promise<ResultFieldsFromLoincAnswer> {
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
      if (!opts.panel) { wanted.push({ code: c, name: text(opts.names?.[c]) }); continue; }
      const members = await deps.ontology.panelMembers(systemId, c);
      if (members.length === 0) throw invalid(`LOINC code ${c} is not a panel, so it has no member tests.`);
      for (const m of members) wanted.push({ code: m.memberLoinc, name: m.displayName });
    }

    const answer: ResultFieldsFromLoincAnswer = { params: [], created: [], reused: [], valueSetsCreated: [] };
    const seen = new Set<string>();
    const newRows: Array<{ code: string; display: string; units: string | null; inLoinc: boolean }> = [];
    const planned: Array<{ plan: LoincFieldPlan; answers: Array<{ value: string; label: string }> }> = [];
    const repairLinks: string[] = [];
    for (const w of wanted) {
      if (seen.has(w.code)) continue;
      seen.add(w.code);
      const p = await planField(systemId, w.code, w.name);
      if (p.needsLink && p.inLoinc) repairLinks.push(p.plan.code);
      if (!p.plan.exists) newRows.push({ code: w.code, display: p.plan.display, units: p.plan.unit, inLoinc: p.inLoinc });
      planned.push({ plan: p.plan, answers: p.answers });
    }

    // The stores here take no shared transaction, so the writes are ordered to be safe to re-run: the
    // checks above refuse before anything is written, and a call that stops part way leaves fields a
    // re-run finds, links and completes. Answer sets are made whenever missing, below.
    if (newRows.length > 0) {
      await deps.admin.terms.importRows(newRows.map((r) => ({
        system: RESULT_PARAM_SYSTEM, code: r.code, display: r.display, status: 'ACTIVE',
        properties: { result_role: 'result', ...(r.units ? { parm_units: r.units } : {}) },
      })));
    }
    if (newRows.length > 0 || repairLinks.length > 0) {
      // The test sheet's picker and the save check read the reportable-result set, built on this system.
      await reexpandValueSetsForSystem(deps.admin, RESULT_PARAM_SYSTEM);
    }
    // The same link the Result fields page saves, so test mapping carries the LOINC code. A panel member
    // missing from the loaded LOINC cannot be linked (result-fields.ts refuses it), so it is not.
    for (const r of newRows) if (r.inLoinc) await deps.resultFields.link(r.code, r.code);
    for (const code of repairLinks) await deps.resultFields.link(code, code);

    for (const { plan, answers } of planned) {
      if (plan.exists) answer.reused.push(plan.code); else answer.created.push(plan.code);
      if (plan.resultType === 'coded') {
        const vs = await ensureAnswers(plan.loinc, answers);
        if (vs.created) answer.valueSetsCreated.push(vs.url);
      }
      answer.params.push({ system: RESULT_PARAM_SYSTEM, code: plan.code, resultType: plan.resultType, valueSetUrl: plan.valueSetUrl, bands: [] });
    }
    return answer;
  }

  return { hints, resultFieldsFromLoinc };
}

export type LoincHintsService = ReturnType<typeof createLoincHints>;
