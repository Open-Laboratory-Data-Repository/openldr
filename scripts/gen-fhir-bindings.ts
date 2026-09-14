// Generates packages/fhir/src/paths/r4-bindings.generated.ts: FHIR R4's own ValueSet binding for
// each path in r4-paths.generated.ts.
//
// Maintainer-only, and not run at build time. By default it downloads hl7.org's
// profiles-resources.json (about 35 MB). Offline routes:
//   --from <file>        a local copy of that Bundle, .json or .json.gz
//   --from-table <file>  corlix's committed extraction (R4.bindings.json.gz), made from the same file

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  bindingsFromTable, extractBindings, renderBindingsTable, type FhirBinding,
} from '../packages/fhir/src/paths/bindings';
import { R4_PATHS } from '../packages/fhir/src/paths/r4-paths.generated';

const SOURCE = 'https://hl7.org/fhir/R4/profiles-resources.json';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(repoRoot, 'packages/fhir/src/paths/r4-bindings.generated.ts');

function readJson(file: string): unknown {
  const buf = readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8'));
}

function argAfter(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function main(): Promise<void> {
  const keep = new Set(R4_PATHS.map(([path]) => path));
  const fromTable = argAfter('--from-table');
  const from = argAfter('--from');
  let table: Record<string, FhirBinding>;
  if (fromTable) {
    table = bindingsFromTable(readJson(fromTable), keep);
  } else if (from) {
    table = extractBindings(readJson(from), keep);
  } else {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
    table = extractBindings(await res.json(), keep);
  }
  writeFileSync(OUT, renderBindingsTable(table), 'utf8');
  console.log(`wrote ${Object.keys(table).length} bindings to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
