// Generates packages/fhir/src/paths/r4-paths.generated.ts from @types/fhir's r4.d.ts.
//
// The output is committed. Nothing regenerates it at build time, and a stale file fails the
// staleness test in packages/fhir/src/paths/index.test.ts.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTableSource } from '../packages/fhir/src/paths/generate';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(repoRoot, 'packages/fhir/src/paths/r4-paths.generated.ts');

const { source, count } = generateTableSource();
writeFileSync(OUT, source, 'utf8');
console.log(`wrote ${count} paths to ${OUT}`);
