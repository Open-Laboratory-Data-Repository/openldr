import type { ControlledField } from '@/api';

// CT-3 (whole-branch review): `FacilityImportResult.unmapped`/`notValidated` are keyed by this
// fixed triple — mirrors `@openldr/bootstrap`'s `CONTROLLED_FIELDS`, not imported from it (this app
// has no dependency on that package, same "mirrored, not shared" reasoning as the rest of api.ts's
// FacilityImportResult). Each field already has a translated label under `facilities.filters.*Label`
// (the Facilities page's own filter row) — reused here rather than adding a second, driftable set of
// field-name translations.
//
// Its own module because `ImportFacilitiesSheet` and `ReconciliationSummary` both need it and the
// sheet imports the summary: leaving it in the sheet would make that import circular.
export const CONTROLLED_FIELDS: ControlledField[] = ['level', 'status', 'country'];
