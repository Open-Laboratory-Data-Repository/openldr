import { z } from 'zod';
import { fhirId, fhirDateTime, fhirInstant, fhirString } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Quantity, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

/**
 * FHIR's value[x]: an Observation, and each component, holds at most one result value. Two, such as
 * valueString beside valueQuantity, contradict each other. The message names the fields, never a value.
 */
function oneValue(o: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const values = Object.keys(o).filter((k) => /^value[A-Z]/.test(k) && o[k] !== undefined).sort();
  if (values.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [values[1]], message: `holds more than one result value: ${values.join(', ')}. FHIR allows one.` });
  }
}

const ObservationComponent = z
  .object({
    code: CodeableConcept,
    valueQuantity: Quantity.optional(),
    valueCodeableConcept: CodeableConcept.optional(),
    valueString: fhirString.optional(),
    interpretation: z.array(CodeableConcept).optional(),
  })
  .passthrough()
  .superRefine(oneValue);

export const Observation = z
  .object({
    resourceType: z.literal('Observation'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    basedOn: z.array(Reference).optional(),
    status: z.enum(['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown']),
    category: z.array(CodeableConcept).optional(),
    code: CodeableConcept,
    subject: Reference.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    issued: fhirInstant.optional(),
    valueQuantity: Quantity.optional(),
    valueCodeableConcept: CodeableConcept.optional(),
    valueString: fhirString.optional(),
    interpretation: z.array(CodeableConcept).optional(),
    method: CodeableConcept.optional(),
    specimen: Reference.optional(),
    component: z.array(ObservationComponent).optional(),
  })
  .passthrough()
  .superRefine(oneValue);
export type Observation = z.infer<typeof Observation>;

registerResource('Observation', Observation);
