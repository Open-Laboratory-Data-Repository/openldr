import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta, Annotation } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Task = z
  .object({
    resourceType: z.literal('Task'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    status: z.enum([
      'draft', 'requested', 'received', 'accepted', 'rejected', 'ready', 'cancelled',
      'in-progress', 'on-hold', 'failed', 'completed', 'entered-in-error',
    ]),
    intent: z.enum([
      'unknown', 'proposal', 'plan', 'order', 'original-order', 'reflex-order',
      'filler-order', 'instance-order', 'option',
    ]),
    code: CodeableConcept.optional(),
    focus: Reference.optional(),
    for: Reference.optional(),
    owner: Reference.optional(),
    requester: Reference.optional(),
    statusReason: CodeableConcept.optional(),
    businessStatus: CodeableConcept.optional(),
    authoredOn: fhirDateTime.optional(),
    lastModified: fhirDateTime.optional(),
    note: z.array(Annotation).optional(),
  })
  .passthrough();
export type Task = z.infer<typeof Task>;

registerResource('Task', Task);
