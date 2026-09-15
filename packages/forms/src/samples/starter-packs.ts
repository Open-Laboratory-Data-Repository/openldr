import type { FormField, FormSchema } from '../schema/form-schema';
import type { SeededStarterPack, StarterPackEntry } from '../starter-pack';
import { resolveFhirPath } from '../fhir-path';
import { getPageTarget } from '../page-targets';
import { sampleForms } from './forms';

/**
 * The four seeded starter packs. Each is built from the form OpenLDR itself ships for that resource
 * type (`./forms.ts`), so a pack cannot drift from its form. Corlix's packs use its own code systems
 * and API property names, which CE's pages would not save (spec S5).
 *
 * A pack stores no codes (AGENTS.md §8). A coded select takes its options from the FHIR element's own
 * list when the studio turns the entry into a field.
 */

/** Bump when a pack's content changes. Boot rewrites the seeded packs either way. */
export const STARTER_PACK_VERSION = '2';

interface PackSource {
  id: string;
  name: string;
  formId: string;
  /** The live page whose required keys this pack locks. */
  page?: string;
}

const SOURCES: PackSource[] = [
  { id: 'pack-location', name: 'Facility', formId: 'sample-facility', page: 'facilities' },
  { id: 'pack-practitioner', name: 'Users', formId: 'sample-users', page: 'users' },
  { id: 'pack-patient', name: 'Patient', formId: 'sample-patient' },
  { id: 'pack-service-request', name: 'Lab order', formId: 'sample-order' },
];

/**
 * Fields no pack offers. Ward / Department's options are local codes with no FHIR list behind them,
 * and a seed may not carry codes. The Library still offers `ServiceRequest.locationCode`.
 */
const LEFT_OUT = new Set(['fld-ord-ward']);

/** One line per entry, shown in the chooser. An entry that cannot say why it is there does not belong. */
const RATIONALE: Record<string, string> = {
  'fld-fac-system': 'With the code, it identifies the facility. The Facilities page cannot save a row without it.',
  'fld-fac-code': "The facility's code in that register. The Facilities page cannot save a row without it.",
  'fld-fac-name': 'The name people search for. The Facilities page cannot save a row without it.',
  'fld-fac-country': 'Picks from the seeded country list, so every facility names its country the same way.',
  'fld-fac-zone': 'The top administrative tier. FHIR has no address slot for it, so it is saved by API property only.',
  'fld-fac-region': 'Optional, because some national registers have no tier between province and district.',
  'fld-fac-district': 'The tier most reports group facilities by.',
  'fld-fac-council': 'Optional. Like zone, FHIR has no address slot for it.',
  'fld-fac-status': 'Whether the facility is active, from the seeded status list.',
  'fld-fac-level': 'The facility type, from the seeded list. Reports filter by it.',
  'fld-usr-first-name': 'The Users page cannot create an account without it.',
  'fld-usr-last-name': 'The Users page cannot create an account without it.',
  'fld-usr-email': 'Sign-in and notices go to this address. The Users page cannot create an account without it.',
  'fld-pat-first-name': 'Needed to find the patient again at the next visit.',
  'fld-pat-last-name': 'Needed with the first name to tell patients apart.',
  'fld-pat-dob': 'Age-based reference ranges depend on it.',
  'fld-pat-sex': "Sex-based reference ranges depend on it. The options come from FHIR's own list.",
  'fld-pat-phone': 'Optional. Lets the lab reach the patient about a result.',
  patient: 'Every order is for one patient. It links the order to the Patient record.',
  tests: "What the lab is asked to run, from this lab's test list. An order can hold several.",
  'fld-ord-priority': "How fast the lab should work the order. The options come from FHIR's own list.",
  'fld-ord-clinician': 'Who to call about the result.',
  'fld-ord-ref-number': 'The requisition number on the paper form, so the two can be matched.',
  'fld-ord-notes': 'Clinical context the lab may need to choose or read a test.',
  'fld-ord-ref-facility': 'Where the order came from, so results go back there.',
  'fld-ord-specimen-type': 'What was collected, from the seeded specimen type list.',
};

function toEntry(field: FormField, ord: number, form: FormSchema, page: string | undefined): StarterPackEntry {
  const rationale = RATIONALE[field.id];
  if (!rationale) throw new Error(`starter pack: no rationale for field ${field.id}`);
  const lockedKeys = page ? (getPageTarget(page)?.requiredKeys ?? []) : [];
  const entry: StarterPackEntry = {
    ord,
    fhirPath: field.fhirPath ? (resolveFhirPath(field.fhirPath, form.fhirResourceType) ?? field.fhirPath) : null,
    label: field.displayLabel,
    apiProperty: field.apiProperty ?? null,
    fieldType: field.fieldType,
    fhirValueField: field.fhirValueField ?? null,
    required: field.required,
    locked: field.apiProperty ? lockedKeys.includes(field.apiProperty) : false,
    defaultOn: true,
    boundValueSet: field.valueSetUrl ?? null,
    referenceTarget: field.referenceTarget ?? null,
    referenceMultiple: field.referenceMultiple === true,
    rationale,
  };
  if (field.fhirDiscriminator) entry.discriminator = field.fhirDiscriminator;
  return entry;
}

export function seededStarterPacks(): SeededStarterPack[] {
  return SOURCES.map((source) => {
    const form = sampleForms.find((f) => f.id === source.formId);
    if (!form || !form.fhirResourceType) throw new Error(`starter pack: no sample form ${source.formId}`);
    const fields = [...form.fields].sort((a, b) => a.order - b.order).filter((f) => !LEFT_OUT.has(f.id));
    return {
      id: source.id,
      resourceType: form.fhirResourceType,
      name: source.name,
      version: STARTER_PACK_VERSION,
      entries: fields.map((f, i) => toEntry(f, i, form, source.page)),
    };
  });
}
