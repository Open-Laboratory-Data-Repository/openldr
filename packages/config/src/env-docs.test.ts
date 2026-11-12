import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseSecretKey } from '@openldr/core';
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
  'apps/web/src/docs/0.1.8/en/environment.md',
  'apps/web/src/docs/0.1.8/fr/environment.md',
  'apps/web/src/docs/0.1.8/pt/environment.md',
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

// The development guide says `cp .env.example .env`. The server must start on that copy, so the
// template's uncommented lines must pass the same check the server runs at boot.
describe('.env.example', () => {
  const env: Record<string, string> = {};
  for (const line of readFileSync(repoRoot + '.env.example', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }

  it('is accepted by the server config schema', () => {
    const parsed = ConfigSchema.safeParse(env);
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(issues).toEqual([]);
  });

  it('has a SECRETS_ENCRYPTION_KEY the server can use', () => {
    expect(() => parseSecretKey(env.SECRETS_ENCRYPTION_KEY ?? '')).not.toThrow();
  });
});
