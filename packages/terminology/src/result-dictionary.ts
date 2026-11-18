/** The lab's own list of result codes. Result fields, the test catalog, bench result entry and test
 *  mapping all read it. A lab fills it on the Result fields page, or imports it as a FHIR CodeSystem
 *  with this url, whose concepts carry a `result_role` property. */
export const RESULT_PARAM_SYSTEM = 'urn:openldr:default_result';

/** What a result code is. `result` fills the results table, `specimen` fills the sample panel,
 *  `metadata` and `admin` appear nowhere on the report. Migration 069's ValueSets filter on it. */
export const RESULT_ROLES = ['result', 'specimen', 'metadata', 'admin'] as const;
export type ResultRole = (typeof RESULT_ROLES)[number];
