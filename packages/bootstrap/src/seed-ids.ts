// What seedDatabase labels as its own, so the lab data check can tell the seed from real data.
// Its own file: sample-data.ts reads these, and its tests replace './seed' with a fake.

/** The source label seedDatabase writes on its FHIR resources and warehouse rows. */
export const SEED_SOURCE = 'seed';

/** The ids of the Organization, Location and Patient that seedDatabase writes. */
export const SEED_RESOURCE_IDS = { organization: 'seed-org', location: 'seed-loc', patient: 'seed-pat' } as const;
