import { z } from 'zod';

/** What registering a facility register (an import source) takes. The studio route and
 *  `openldr facilities register-source` validate with this one schema, then call the same
 *  `createFacilityRegisterSourceStore(...).create`. */
export const facilityRegisterSourceInputSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1),
  code: z.string().min(1),
  version: z.string().optional().nullable(),
  jurisdiction: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  publisherId: z.string().optional().nullable(),
});
export type FacilityRegisterSourceInput = z.infer<typeof facilityRegisterSourceInputSchema>;
