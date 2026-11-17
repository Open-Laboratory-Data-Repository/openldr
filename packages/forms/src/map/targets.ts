import type { StarterPackEntry } from '../starter-pack';
import { buildTarget, type MapTarget } from './target';
import labelsFr from './labels.fr.json';
import labelsPt from './labels.pt.json';

/**
 * The targets OpenLDR ships, built from starter packs. Today there is one: Lab result.
 * Labels come from the packs in English, and from `labels.{fr,pt}.json` for French and Portuguese.
 */

/** A seeded pack, or one read back from the store. */
export interface MapTargetPack {
  id: string;
  resourceType: string;
  entries: StarterPackEntry[];
}

const LABELS: Record<string, Record<string, string>> = { fr: labelsFr, pt: labelsPt };

const LAB_RESULT_PACKS: { id: string; repeats: boolean }[] = [
  { id: 'pack-patient', repeats: false },
  { id: 'pack-specimen', repeats: false },
  { id: 'pack-service-request', repeats: false },
  { id: 'pack-observation', repeats: true },
];

// CE ties an order to its specimens through ServiceRequest.specimen (`link-to-order.ts`).
// Nothing in CE reads Specimen.request.
const LAB_RESULT_LINKS: MapTarget['links'] = [
  { from: 'Specimen', path: 'Specimen.subject', to: 'Patient' },
  { from: 'ServiceRequest', path: 'ServiceRequest.subject', to: 'Patient' },
  { from: 'ServiceRequest', path: 'ServiceRequest.specimen', to: 'Specimen' },
  { from: 'Observation', path: 'Observation.subject', to: 'Patient' },
  { from: 'Observation', path: 'Observation.specimen', to: 'Specimen' },
  { from: 'Observation', path: 'Observation.basedOn', to: 'ServiceRequest' },
];

// The status values form extraction writes (`extract/extract.ts`). FHIR requires them.
const LAB_RESULT_DEFAULTS: MapTarget['defaults'] = [
  { path: 'ServiceRequest.status', value: 'active' },
  { path: 'ServiceRequest.intent', value: 'order' },
  { path: 'Observation.status', value: 'final' },
];

// The patient's identifier. No pack holds it, and a results file nearly always does.
const LAB_RESULT_EXTRA: MapTarget['fields'] = [
  { path: 'Patient.identifier.value', label: 'Patient ID', required: false, repeats: false, valueSet: null },
];

function localise(target: MapTarget, locale: string): MapTarget {
  const labels = LABELS[locale];
  if (!labels) return target;
  return { ...target, fields: target.fields.map((f) => ({ ...f, label: labels[f.path] ?? f.label })) };
}

export function labResultTarget(packs: readonly MapTargetPack[], locale = 'en'): MapTarget {
  const parts = LAB_RESULT_PACKS.map(({ id, repeats }) => {
    const pack = packs.find((p) => p.id === id);
    if (!pack) throw new Error(`map target lab-result: no starter pack ${id}`);
    return { pack: { id: pack.id, resourceType: pack.resourceType }, entries: pack.entries, repeats };
  });
  const target = buildTarget('lab-result', 'Lab result', parts, {
    links: LAB_RESULT_LINKS,
    defaults: LAB_RESULT_DEFAULTS,
    extra: LAB_RESULT_EXTRA,
  });
  return localise(target, locale);
}

export function listMapTargets(packs: readonly MapTargetPack[], locale = 'en'): MapTarget[] {
  return [labResultTarget(packs, locale)];
}

export function mapTargetById(packs: readonly MapTargetPack[], id: string, locale = 'en'): MapTarget | null {
  return listMapTargets(packs, locale).find((t) => t.id === id) ?? null;
}
