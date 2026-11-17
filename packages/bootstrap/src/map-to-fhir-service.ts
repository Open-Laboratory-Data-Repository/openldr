import { createHash } from 'node:crypto';
import {
  applyMapping,
  classify,
  mapTargetById,
  SavedMappingSchema,
  type Classification,
  type ClassifyForm,
  type FormSchema,
  type MapTarget,
  type MapTargetPack,
  type RuleDeps,
  type SavedMapping,
} from '@openldr/forms';
import { getResourceSchema, validateResource, type OperationOutcomeIssue, type ValidateBatchResult } from '@openldr/fhir';
import { lookupFhirPath } from '@openldr/fhir/paths';
import {
  bundleToResources,
  type RunFormValidateInput,
  type RunFormValidateOutput,
  type RunMapToFhirInput,
  type RunMapToFhirOutput,
  type WorkflowItem,
} from '@openldr/workflows';
import { LOCAL_MAP_URL } from '@openldr/db';

/**
 * The Map to FHIR node's service. Each item is FHIR already, a known form's answers, a row a saved
 * mapping knows, or none of these. Records that pass CE's checks go to `out`; the rest are held with
 * a reason. No reason, log line or thrown message holds a value from an item: a reason is built only
 * from text this file controls.
 */

type Coding = Exclude<Awaited<ReturnType<RuleDeps['translateCode']>>, null | 'several'>;

export interface MapToFhirServiceDeps {
  forms: { get(id: string): Promise<{ schema: FormSchema } | null> };
  /** The form-validate service, called with one item at a time. */
  validateForm(input: RunFormValidateInput): Promise<RunFormValidateOutput>;
  /** The stored starter packs with their entries, to build the target from. */
  packs(): Promise<MapTargetPack[]>;
  translateCode: RuleDeps['translateCode'];
  /**
   * The batch check persist runs, at the configured level, on one item's records. It stores nothing.
   * A ServiceRequest id in `knownOrderIds` came in this run and counts as found.
   */
  validate(resources: unknown[], knownOrderIds: ReadonlySet<string>): Promise<ValidateBatchResult>;
}

/**
 * FHIR ConceptMap equivalence codes that count as a match, plus `SAME-AS`, which CE writes for the
 * lab's own map (`terminology-admin-store.ts`, `equivalence: input.mapType`). A row with no
 * equivalence counts too. These are map row codes, not clinical codes.
 */
const MATCH_EQUIVALENCES = new Set(['equivalent', 'equal', 'SAME-AS']);

/** The one coding a code list gives; null for none, `'several'` for more than one distinct target. */
export function codingFromMapRows(rows: { targetSystem: string; targetCode: string; equivalence: string | null }[]): Coding | null | 'several' {
  const targets = new Map<string, Coding>();
  for (const r of rows) {
    if (r.equivalence !== null && !MATCH_EQUIVALENCES.has(r.equivalence)) continue;
    targets.set(JSON.stringify([r.targetSystem, r.targetCode]), { system: r.targetSystem, code: r.targetCode });
  }
  if (targets.size > 1) return 'several';
  return targets.size === 1 ? [...targets.values()][0] : null;
}

/** The stored pack for each id. A pack the store lacks is a config fault. */
export async function loadStoredPacks(
  store: { get(id: string): Promise<MapTargetPack | null> },
  ids: readonly string[],
): Promise<MapTargetPack[]> {
  const packs: MapTargetPack[] = [];
  for (const id of ids) {
    const pack = await store.get(id);
    if (!pack) throw new Error(`Map to FHIR: starter pack ${id} is not stored`);
    packs.push({ id: pack.id, resourceType: pack.resourceType, entries: pack.entries });
  }
  return packs;
}

/** A record id from its identity parts: sha256 hex of the JSON list, so parts cannot run together. */
function hashId(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** The keys `validateAnswers` reads answers by: every field id but disabled fields and groups. */
function classifyForm(id: string, schema: FormSchema): ClassifyForm {
  const fields = schema.fields.filter((f) => f.enabled !== false && f.fieldType !== 'group');
  return { id, fieldIds: fields.map((f) => f.id), requiredIds: fields.filter((f) => f.required).map((f) => f.id) };
}

// The reasons `validateAnswers` writes. The numbers come from the form's own constraints.
const FORM_REASONS = [/^required$/, /^must be selected from the list$/, /^must be [<>]= -?\d+(\.\d+)?$/, /^exceeds max length \d+$/];
// Two reasons quote the answer first; only the text after the quote is kept.
const FORM_QUOTED_REASON = /^'.*' (is not an allowed option|is not a number)$/s;

/** A form reason this file knows, with any answer cut; null for any other, and the field is named alone. */
function formReason(reason: string): string | null {
  const quoted = FORM_QUOTED_REASON.exec(reason);
  if (quoted) return quoted[1];
  return FORM_REASONS.some((re) => re.test(reason)) ? reason : null;
}

/**
 * Issue texts kept in a reason. `prefix` texts are followed by `: <values>` in the message, and only
 * the part before the colon is kept. Every other text becomes "failed the <code> check".
 * The first two are `result-requires-request`'s; a test pins them to the rule. The rest are
 * `validateResource`'s and zod's fixed text; a test pins the date texts to the validator.
 */
export const KNOWN_ISSUE_TEXTS: readonly { text: string; prefix?: boolean }[] = [
  { text: 'laboratory result must reference a ServiceRequest (basedOn)' },
  { text: 'basedOn ServiceRequest not found in batch or store', prefix: true },
  { text: 'Required' },
  { text: 'missing resourceType' },
  { text: 'resource must be a JSON object' },
  { text: 'unsupported resourceType', prefix: true },
  // The FHIR date, dateTime and instant patterns' fixed texts (`datatypes/primitives.ts`).
  { text: 'invalid FHIR date' },
  { text: 'invalid FHIR dateTime' },
  { text: 'invalid FHIR instant' },
];

function issueText(issue: OperationOutcomeIssue): string {
  const d = issue.diagnostics ?? '';
  const known = KNOWN_ISSUE_TEXTS.find((k) => (k.prefix ? d.startsWith(`${k.text}:`) : d === k.text));
  if (known) return known.text;
  return `failed the ${/^[a-z][a-z-]*$/.test(issue.code) ? issue.code : 'validation'} check`;
}

// Top-level keys every resource has that the path table does not list.
const RESOURCE_KEYS = new Set(['resourceType']);

/**
 * A field path keeping only what CE's FHIR path table knows for this resource type at that place,
 * and list indexes. Every other segment, and every segment after it, becomes `*`, so a key a sender
 * chose never shows. With no known type, only indexes and `resourceType` stay.
 */
function safePath(type: string | null, path: string): string {
  if (path === '' || path === '(root)') return '';
  let at: string | null = type;
  return path
    .split('.')
    .map((seg, i) => {
      if (/^\d+$/.test(seg)) return seg;
      if (i === 0 && RESOURCE_KEYS.has(seg)) return seg;
      if (at !== null && lookupFhirPath(`${at}.${seg}`)) {
        at = `${at}.${seg}`;
        return seg;
      }
      at = null;
      return '*';
    })
    .join('.');
}

type Res = Record<string, unknown>;

/** A resource type only when CE knows it, so a sender's own type name never shows. */
function knownType(type: unknown): string | null {
  return typeof type === 'string' && getResourceSchema(type) ? type : null;
}

/**
 * The record a rule's expression names, by the exact `<Type>/<id>` of each record in the item (an id
 * may hold dots, so it is never parsed out). The longest match wins. Null when no record matches.
 */
function ruleTarget(expression: string, records: Res[]): { index: number; rest: string } | null {
  let best: { index: number; rest: string } | null = null;
  let bestLength = -1;
  for (let index = 0; index < records.length; index++) {
    const r = records[index];
    if (typeof r.resourceType !== 'string' || typeof r.id !== 'string') continue;
    const ref = `${r.resourceType}/${r.id}`;
    const rest = expression === ref ? '' : expression.startsWith(`${ref}.`) ? expression.slice(ref.length + 1) : null;
    if (rest !== null && ref.length > bestLength) {
      best = { index, rest };
      bestLength = ref.length;
    }
  }
  return best;
}

/**
 * One issue as `record <n> (<Type>) <path>: <text>`. A structural issue has its record's position.
 * A rule issue is placed by `ruleTarget`; when no record matches, only the text is given.
 */
function describeIssue(issue: OperationOutcomeIssue, records: Res[], position: number | null): string {
  const text = issueText(issue);
  const expression = issue.expression?.[0] ?? '';
  let at: number;
  let path: string;
  if (position !== null) {
    at = position;
    path = expression;
  } else {
    const target = ruleTarget(expression, records);
    if (!target) return text;
    at = target.index;
    path = target.rest;
  }
  const type = knownType(records[at]?.resourceType);
  const where = [`record ${at + 1}`, type ? `(${type})` : null, safePath(type, path) || null].filter(Boolean).join(' ');
  return `${where}: ${text}`;
}

/** The structural failures of one item's records, each placed by its record. Null when all pass. */
function structuralReason(records: Res[]): string | null {
  const parts: string[] = [];
  records.forEach((r, i) => {
    const res = validateResource(r);
    if (!res.ok) for (const issue of res.outcome.issue) parts.push(describeIssue(issue, records, i));
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function heldJson(original: unknown, reason: string, extra: { shape?: unknown; field?: string } = {}): Res {
  return { item: structuredClone(original), reason, ...(extra.shape ? { shape: extra.shape } : {}), ...(extra.field ? { field: extra.field } : {}) };
}

function isBundle(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (v as Res).resourceType === 'Bundle';
}

/** Unwrap as the unwrap-bundle node does. A single resource that is not a Bundle is a list of one. */
function unwrap(json: unknown): Res[] | null {
  const copy = structuredClone(json);
  if (!isBundle(copy) && !Array.isArray(copy)) return [copy as Res];
  try {
    return bundleToResources(copy);
  } catch {
    return null;
  }
}

function parseMappings(raw: unknown[], targetId: string): SavedMapping[] {
  return raw.map((m, i) => {
    const parsed = SavedMappingSchema.safeParse(m);
    if (!parsed.success) throw new Error(`Map to FHIR node config: mapping ${i} is not a saved mapping`);
    if (parsed.data.targetId !== targetId) throw new Error(`Map to FHIR node config: mapping ${i} is for target ${parsed.data.targetId}, not ${targetId}`);
    return parsed.data;
  });
}

const MAX_HELD_REASONS = 20;

export const RESULT_CLASH_REASON = 'this row gives a result that an earlier row of this run already gave, with other values';

function isPlainObject(v: unknown): v is Res {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** JSON with object keys sorted, so two records with the same content compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Fill what `base` lacks from `extra`. A non-empty value in `base` wins. Objects merge key by key,
 * lists index by index.
 */
function fillMissing(base: Res | unknown[], extra: Res | unknown[]): void {
  const keys = Array.isArray(extra) ? extra.map((_, i) => i) : Object.keys(extra);
  for (const k of keys) {
    const b = (base as Record<string | number, unknown>)[k];
    const e = (extra as Record<string | number, unknown>)[k];
    if (isBlank(e)) continue;
    if (isBlank(b)) (base as Record<string | number, unknown>)[k] = structuredClone(e);
    else if (isPlainObject(b) && isPlainObject(e)) fillMissing(b, e);
    else if (Array.isArray(b) && Array.isArray(e)) fillMissing(b, e);
  }
}

interface Entry {
  original: Record<string, unknown>;
  kind: Exclude<Classification['kind'], 'unknown'> | 'unknown';
  records: Res[] | null;
  held: Res | null;
}

/**
 * Store reads kept for one caller's series of calls, such as a Test of many rows sent one row per
 * call. A run passes none and reads the store once per call.
 */
export interface MapToFhirCallCache {
  packs?: Promise<MapTargetPack[]>;
  forms: Map<string, Promise<{ schema: FormSchema } | null>>;
}

export function createMapToFhirCallCache(): MapToFhirCallCache {
  return { forms: new Map() };
}

export type MapToFhirService = (input: RunMapToFhirInput, cache?: MapToFhirCallCache) => Promise<RunMapToFhirOutput>;

export function createMapToFhirService(deps: MapToFhirServiceDeps): MapToFhirService {
  // The lab's own map holds rows of every source system, so a code looked up there without one
  // could come from another domain. With no source system it gives no match.
  const translateCode: RuleDeps['translateCode'] = async (url, value, sourceSystem) =>
    url === LOCAL_MAP_URL && !sourceSystem ? null : deps.translateCode(url, value, sourceSystem);

  return async ({ items, config }, cache) => {
    const readPacks = () => (cache ? (cache.packs ??= deps.packs()) : deps.packs());
    const readForm = (id: string) => {
      if (!cache) return deps.forms.get(id);
      let got = cache.forms.get(id);
      if (!got) {
        got = deps.forms.get(id);
        cache.forms.set(id, got);
      }
      return got;
    };
    const targetId = config.targetId.trim();
    if (config.mappings.length > 0 && !targetId) throw new Error('Map to FHIR node config: targetId is required when the node has mappings');
    const mappings = parseMappings(config.mappings, targetId);

    // Only a mapping needs the target. With none, FHIR and form items map without the packs, so a
    // node like the default Ingest one does not depend on the pack seed.
    let target: MapTarget | null = null;
    if (mappings.length > 0) {
      target = mapTargetById(await readPacks(), targetId);
      if (!target) throw new Error(`Map to FHIR node config: no map target ${targetId}`);
    }

    const forms: ClassifyForm[] = [];
    for (const id of config.formIds) {
      const def = await readForm(id);
      if (!def) throw new Error(`Map to FHIR node config: form ${id} not found`);
      forms.push(classifyForm(id, def.schema));
    }

    // 1. Every item's records, or the reason it is held, before any order is checked.
    const entries: Entry[] = [];
    for (const item of items) {
      const original = item.json;
      const kind = classify(original, forms, mappings);
      const entry: Entry = { original, kind: kind.kind, records: null, held: null };
      entries.push(entry);

      if (kind.kind === 'fhir') {
        entry.records = unwrap(original);
        if (!entry.records) entry.held = heldJson(original, 'not a FHIR Bundle this node can unwrap');
      } else if (kind.kind === 'form') {
        const res = await deps.validateForm({ formId: kind.formId, items: [{ json: structuredClone(original) }] });
        const errors = res.meta.invalid.flatMap((inv) => inv.errors);
        if (errors.length > 0) {
          const parts = errors.map((e) => {
            const reason = formReason(e.reason);
            return reason === null ? e.fieldId : `${e.fieldId} ${reason}`;
          });
          entry.held = heldJson(original, `form ${kind.formId}: ${parts.join('; ')}`);
        } else entry.records = res.items.map((i) => i.json);
      } else if (kind.kind === 'mapped') {
        // A mapping exists only with a target; the checks above make sure of it.
        const res = await applyMapping(kind.mapping, target as MapTarget, original, { translateCode, hashId });
        if (res.ok) entry.records = res.resources as unknown as Res[];
        else entry.held = heldJson(original, res.reason, { field: res.field });
      } else if (kind.kind === 'ambiguous') {
        entry.held = heldJson(original, 'more than one saved mapping fits this row', { shape: kind.shape });
      } else {
        entry.held = heldJson(original, 'no mapping for this shape', { shape: kind.shape });
      }

      if (entry.records) {
        const structural = structuralReason(entry.records);
        if (structural) {
          entry.held = heldJson(original, structural);
          entry.records = null;
        }
      }
    }

    // 2. Within this call, a result id that an earlier mapped item already gave with other content
    // is a clash: the later item is held. The same content is no clash; its copy is dropped in 3.
    if (target) {
      const repeats = new Set(target.records.filter((r) => r.repeats).map((r) => r.type));
      const firstResult = new Map<string, string>();
      for (const e of entries) {
        if (e.kind !== 'mapped' || !e.records || e.held) continue;
        const mine = e.records.filter((r) => repeats.has(String(r.resourceType)));
        const clash = mine.some((r) => {
          const seen = firstResult.get(`${String(r.resourceType)}/${String(r.id)}`);
          return seen !== undefined && seen !== canonical(r);
        });
        if (clash) {
          e.held = heldJson(e.original, RESULT_CLASH_REASON);
          continue;
        }
        for (const r of mine) {
          const key = `${String(r.resourceType)}/${String(r.id)}`;
          if (!firstResult.has(key)) firstResult.set(key, canonical(r));
        }
      }
    }

    // 3. The rule check, per item, with every order of the items still standing. A held item's
    // orders stop counting, so check again until no further item is held.
    for (let pass = 0; pass <= entries.length; pass++) {
      const standing = entries.filter((e) => e.records && !e.held);
      const known = new Set<string>();
      for (const e of standing) for (const r of e.records as Res[]) if (r.resourceType === 'ServiceRequest' && typeof r.id === 'string') known.add(r.id);
      let heldThisPass = false;
      for (const e of standing) {
        const records = e.records as Res[];
        const check = await deps.validate(records, known);
        if (!check.ok) {
          e.held = heldJson(e.original, check.outcome.issue.map((i) => describeIssue(i, records, null)).join('; '));
          heldThisPass = true;
        }
      }
      if (!heldThisPass) break;
    }

    // 4. Out and held, in input order. A mapped record id goes out once. A record that does not
    // repeat (Patient, Specimen, order) is merged from every item that gives it and goes out at the
    // first; a held item adds nothing.
    const out: WorkflowItem[] = [];
    const emitted = new Map<string, Res>();
    const held: WorkflowItem[] = [];
    const heldIndexes: number[] = [];
    const meta = { fhir: 0, form: 0, mapped: 0, held: 0, heldReasons: [] as string[] };
    entries.forEach((e, index) => {
      if (e.held) {
        held.push({ json: e.held });
        heldIndexes.push(index);
        meta.held += 1;
        if (meta.heldReasons.length < MAX_HELD_REASONS) meta.heldReasons.push(String(e.held.reason));
        return;
      }
      // The records go on as made; Persist Store runs the same check again before it stores them.
      for (const r of e.records as Res[]) {
        if (e.kind !== 'mapped') {
          out.push({ json: r });
          continue;
        }
        const key = `${String(r.resourceType)}/${String(r.id)}`;
        const first = emitted.get(key);
        if (first) {
          fillMissing(first, r);
          continue;
        }
        const copy = structuredClone(r);
        emitted.set(key, copy);
        out.push({ json: copy });
      }
      // An unknown or ambiguous item is always held, so only these three reach here.
      if (e.kind === 'fhir' || e.kind === 'form' || e.kind === 'mapped') meta[e.kind] += 1;
    });

    return { out, held, heldIndexes, meta };
  };
}
