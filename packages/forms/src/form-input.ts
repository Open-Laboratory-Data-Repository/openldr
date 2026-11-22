import { z } from 'zod';

// Publish and the questionnaire export walk `fields` and `sections`, so a schema without both
// lists answered 500 later (demo.4 item 2). Only the lists are checked, not each field: the
// studio fills a field's missing keys when it loads a form (builderModel.ts), and older stored
// forms rely on that.
const formSchemaInput = z
  .object({
    fields: z.array(z.record(z.unknown())),
    sections: z.array(z.record(z.unknown())),
  })
  .passthrough();

/** The body the server accepts to create or update a form. */
export const FormCreateInputSchema = z.object({
  name: z.string().min(1),
  versionLabel: z.string().nullish(),
  fhirResourceType: z.string().nullish(),
  fhirVersion: z.string().nullish(),
  fhirProfileUrl: z.string().nullish(),
  facilityId: z.string().nullish(),
  status: z.string().optional(),
  active: z.boolean().optional(),
  schema: formSchemaInput,
  targetPages: z.array(z.string()).nullish(),
});
