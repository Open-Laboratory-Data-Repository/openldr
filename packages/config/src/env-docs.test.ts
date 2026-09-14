import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConfigSchema } from './schema';

// Every env var the server reads must be listed on each environment docs page. A var added
// to ConfigSchema without a docs row fails here, so the gap shows up before merge instead of
// when an operator compares two .env files.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Read with process.env directly instead of through ConfigSchema, so the schema cannot list them.
const READ_OUTSIDE_SCHEMA = [
  'SYNC_ALLOW_INSECURE_TRANSPORT', // packages/config/src/sync.ts
  'OPENLDR_SITE_ID', // packages/db/src/fhir-store.ts
];

const DOC_PAGES = [
  'apps/studio/src/docs/0.1.8/en/environment.md',
  'apps/studio/src/docs/0.1.8/fr/environment.md',
  'apps/studio/src/docs/0.1.8/pt/environment.md',
  'apps/web/src/docs/0.1.8/environment.md',
  'docs/CONFIGURATION.md',
];

function schemaKeys(): string[] {
  let schema: z.ZodTypeAny = ConfigSchema;
  // superRefine and transform each wrap the object in a ZodEffects.
  while (schema instanceof z.ZodEffects) schema = schema.innerType();
  if (!(schema instanceof z.ZodObject)) throw new Error('ConfigSchema is no longer a z.object');
  return Object.keys(schema.shape);
}

describe('environment docs', () => {
  const vars = [...schemaKeys(), ...READ_OUTSIDE_SCHEMA];

  it('finds the schema keys', () => {
    expect(vars).toContain('MARKETPLACE_PUBLISH_TOKEN');
    expect(vars.length).toBeGreaterThan(70);
  });

  it.each(DOC_PAGES)('%s lists every env var', (page) => {
    const text = readFileSync(repoRoot + page, 'utf8');
    const missing = vars.filter((name) => !text.includes('`' + name + '`'));
    expect(missing, `${page} has no row for: ${missing.join(', ')}`).toEqual([]);
  });
});
