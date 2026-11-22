import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const ProvenanceAgent = z
  .object({
    type: CodeableConcept.optional(),
    role: z.array(CodeableConcept).optional(),
    who: Reference,
    onBehalfOf: Reference.optional(),
  })
  .passthrough();

// R4 makes both `role` and `what` required on an entity.
const ProvenanceEntity = z
  .object({
    role: z.enum(['derivation', 'revision', 'quotation', 'source', 'removal']),
    what: Reference,
  })
  .passthrough();

export const Provenance = z
  .object({
    resourceType: z.literal('Provenance'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    target: z.array(Reference).min(1),
    recorded: fhirDateTime,
    activity: CodeableConcept.optional(),
    agent: z.array(ProvenanceAgent).optional(),
    reason: z.array(CodeableConcept).optional(),
    entity: z.array(ProvenanceEntity).optional(),
  })
  .passthrough();
export type Provenance = z.infer<typeof Provenance>;

registerResource('Provenance', Provenance);
