import { createHash } from 'node:crypto';
import {
  applyMapping,
  classify,
  mapTargetById,
  SavedMappingSchema,
  type ClassifyForm,
  type FormSchema,
  type MapTarget,
  type MapTargetPack,
  type RuleDeps,
  type SavedMapping,
} from '@openldr/forms';
import type { ValidateBatchResult } from '@openldr/fhir';
import {
  bundleToResources,
  type RunFormValidateInput,
  type RunFormValidateOutput,
  type RunMapToFhirInput,
  type RunMapToFhirOutput,
  type WorkflowItem,
} from '@openldr/workflows';

/**
 * The Map to FHIR node's service. Each item is FHIR already, a known form's answers, a row a saved
 * mapping knows, or none of these. Records that pass CE's checks go to `out`; the rest are held with
 * a reason. No reason, log line or thrown message holds a value from an item.
 */

type Coding = NonNullable<Awaited<ReturnType<RuleDeps['translateCode']>>>;

export interface MapToFhirServiceDeps {
  forms: { get(id: string): Promise<{ schema: FormSchema } | null> };
  /** The form-validate service, called with one item at a time. */
  validateForm(input: RunFormValidateInput): Promise<RunFormValidateOutput>;
  /** The stored starter packs with their entries, to build the target from. */
  packs(): Promise<MapTargetPack[]>;
  translateCode: RuleDeps['translateCode'];
  /** The batch check persist runs, at the configured level. It stores nothing. */
  validate(resources: unknown[]): Promise<ValidateBatchResult>;
}

/**
 * FHIR ConceptMap equivalence codes that mean "no match". They are FHIR's own codes for a map row,
 * not clinical codes.
 */
const NO_MATCH_EQUIVALENCES = new Set(['unmatched', 'disjoint']);

/** The one coding a code list gives, or null for none or more than one distinct target. */
export function codingFromMapRows(rows: { targetSystem: string; targetCode: string; equivalence: string | null }[]): Coding | null {
  const targets = new Map<string, Coding>();
  for (const r of rows) {
    if (r.equivalence !== null && NO_MATCH_EQUIVALENCES.has(r.equivalence)) continue;
    targets.set(JSON.stringify([r.targetSystem, r.targetCode]), { system: r.targetSystem, code: r.targetCode });
  }
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

/**
 * A form reason without the answer it may quote. `validateAnswers` writes `'<value>' is not ...`;
 * that prefix is dropped. Any other reason with a quote gives null, and the caller names the field alone.
 */
function formReason(reason: string): string | null {
  const quoted = /^'.*' (is not .+)$/s.exec(reason);
  if (quoted) return quoted[1].includes("'") ? null : quoted[1];
  return reason.includes("'") ? null : reason;
}

/**
 * An issue's message without the item values it may carry. Zod adds `, received '<value>'` to an
 * enum failure, and CE's messages put item values after a colon (an unknown resource type, a missing
 * reference). Both tails are cut; the path says where the fault is.
 */
function issueReason(issue: { diagnostics?: string; expression?: string[] }): string {
  const text = (issue.diagnostics ?? 'invalid').replace(/,? received .*$/is, '').replace(/:\s.*$/s, '').trim();
  const where = issue.expression?.length ? `${issue.expression.join(', ')}: ` : '';
  return `${where}${text}`;
}

function held(item: unknown, reason: string, extra: { shape?: unknown; field?: string } = {}): WorkflowItem {
  return { json: { item, reason, ...(extra.shape ? { shape: extra.shape } : {}), ...(extra.field ? { field: extra.field } : {}) } };
}

function isBundle(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>).resourceType === 'Bundle';
}

/** Unwrap as the unwrap-bundle node does. A single resource that is not a Bundle is a list of one. */
function unwrap(json: unknown): Record<string, unknown>[] | null {
  const copy = structuredClone(json);
  if (!isBundle(copy) && !Array.isArray(copy)) return [copy as Record<string, unknown>];
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

export function createMapToFhirService(deps: MapToFhirServiceDeps): (input: RunMapToFhirInput) => Promise<RunMapToFhirOutput> {
  return async ({ items, config }) => {
    const targetId = config.targetId.trim();
    if (config.mappings.length > 0 && !targetId) throw new Error('Map to FHIR node config: targetId is required when the node has mappings');
    const mappings = parseMappings(config.mappings, targetId);

    let target: MapTarget | null = null;
    if (targetId) {
      target = mapTargetById(await deps.packs(), targetId);
      if (!target) throw new Error(`Map to FHIR node config: no map target ${targetId}`);
    }

    const forms: ClassifyForm[] = [];
    for (const id of config.formIds) {
      const def = await deps.forms.get(id);
      if (!def) throw new Error(`Map to FHIR node config: form ${id} not found`);
      forms.push(classifyForm(id, def.schema));
    }

    const out: WorkflowItem[] = [];
    const heldItems: WorkflowItem[] = [];
    const meta = { fhir: 0, form: 0, mapped: 0, held: 0 };
    const hold = (item: WorkflowItem) => {
      heldItems.push(item);
      meta.held += 1;
    };

    for (const item of items) {
      const original = item.json;
      const kind = classify(original, forms, mappings);
      let records: unknown[];

      if (kind.kind === 'fhir') {
        const resources = unwrap(original);
        if (!resources) {
          hold(held(original, 'not a FHIR Bundle this node can unwrap'));
          continue;
        }
        records = resources;
      } else if (kind.kind === 'form') {
        const res = await deps.validateForm({ formId: kind.formId, items: [{ json: structuredClone(original) }] });
        const errors = res.meta.invalid.flatMap((inv) => inv.errors);
        if (errors.length > 0) {
          const parts = errors.map((e) => {
            const reason = formReason(e.reason);
            return reason === null ? e.fieldId : `${e.fieldId} ${reason}`;
          });
          hold(held(original, `form ${kind.formId}: ${parts.join('; ')}`));
          continue;
        }
        records = res.items.map((i) => i.json);
      } else if (kind.kind === 'mapped') {
        // A mapping exists only with a target; the checks above make sure of it.
        const res = await applyMapping(kind.mapping, target as MapTarget, original, { translateCode: deps.translateCode, hashId });
        if (!res.ok) {
          hold(held(original, res.reason, { field: res.field }));
          continue;
        }
        records = res.resources;
      } else {
        hold(held(original, 'no mapping for this shape', { shape: kind.shape }));
        continue;
      }

      const check = await deps.validate(records);
      if (!check.ok) {
        hold(held(original, check.outcome.issue.map(issueReason).join('; ')));
        continue;
      }
      // The records go on as made; Persist Store runs the same check again before it stores them.
      for (const r of records) out.push({ json: r as Record<string, unknown> });
      meta[kind.kind] += 1;
    }

    return { out, held: heldItems, meta };
  };
}
