import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildPathTable, type FhirPathRow } from './build-table';

/**
 * Resource types a form field can bind to.
 *
 * NOT derived from `registerResource` in packages/fhir/src/resources. That registry exists to
 * validate what CE writes, and it both misses `Practitioner` (which a shipped sample form
 * targets, see packages/forms/src/samples/forms.ts:143) and includes infrastructure resources
 * such as Bundle, ValueSet, and ConceptMap that no form field ever binds to. Extending this list
 * is a one-line change followed by `pnpm gen:fhir-paths`.
 */
export const ROOT_RESOURCE_TYPES = [
  'DiagnosticReport',
  'Encounter',
  'Location',
  'Observation',
  'Organization',
  'Patient',
  'Practitioner',
  'ServiceRequest',
  'Specimen',
] as const;

/**
 * Emitted as paths, never recursed into.
 *
 * A `Reference` is a pointer, so its internals are not a binding target. `Extension` and
 * `Narrative` are structural noise. `Resource` and `Meta` would drag every resource's envelope
 * into every path.
 */
export const STOP_TYPES = ['Reference', 'Extension', 'Narrative', 'Resource', 'Meta'] as const;

/** Segments after the root. Covers Location.address.period.start, which is as deep as forms go. */
export const MAX_DEPTH = 3;

/**
 * Locate r4.d.ts.
 *
 * `@types/fhir` publishes no `exports` map, so a deep resolve works. Resolving `package.json`
 * rather than `r4.d.ts` directly, because the package sets `"main": ""` and a bare specifier
 * resolve is not worth relying on.
 */
export function resolveR4Dts(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@types/fhir/package.json')), 'r4.d.ts');
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function renderTable(rows: FhirPathRow[]): string {
  const roots = [...new Set(rows.map((r) => r.path.slice(0, r.path.indexOf('.'))))].sort();
  const lines = rows.map(
    (r) => `  [${quote(r.path)}, ${quote(r.leafType)}, ${r.isArray ? 1 : 0}, ${quote(r.label)}],`,
  );
  return `// GENERATED FILE. Do not edit by hand.
// Regenerate with: pnpm gen:fhir-paths
//
// Source: @types/fhir r4.d.ts. Each row is one bindable path on a FHIR R4 resource.
// Tuples rather than objects, and the JSDoc first line rather than the full comment, because
// the object-with-full-docs encoding measures 487 KB against this one's 146 KB.

/** [path, leafType, isArray, label]. isArray is 1 when ANY segment on the path is an array. */
export type R4PathTuple = readonly [path: string, leafType: string, isArray: 0 | 1, label: string];

export const R4_PATH_RESOURCE_TYPES: readonly string[] = ${JSON.stringify(roots)};

export const R4_PATHS: readonly R4PathTuple[] = [
${lines.join('\n')}
];
`;
}

/** Read the type definitions and render the table. The single source of truth for both the CLI and the staleness test. */
export function generateTableSource(): { source: string; count: number } {
  const rows = buildPathTable(readFileSync(resolveR4Dts(), 'utf8'), {
    roots: ROOT_RESOURCE_TYPES,
    maxDepth: MAX_DEPTH,
    stopTypes: STOP_TYPES,
  });
  return { source: renderTable(rows), count: rows.length };
}
