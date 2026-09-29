import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { importTerminologyResource } from './loaders/generic';
import type { LoaderStore, SavedRef } from './loaders/generic';

// Reads the shipped file rather than an inline copy, so the test fails if the file drifts.
const FILE_PATH = join(__dirname, '..', 'codesystems', 'openldr-request-attribute.json');
const REQUEST_ATTRIBUTE_SYSTEM = 'urn:openldr:cs:request-attribute';

function readCodeSystem(): { url: string; concept: { code: string; display?: string }[] } {
  return JSON.parse(readFileSync(FILE_PATH, 'utf8'));
}

// Same in-memory store shape as loinc.test.ts's memoryStore: no sibling loader test in this
// package uses pg-mem, so this follows the pattern that actually exists rather than one it doesn't.
function memoryStore() {
  const concepts: unknown[][] = [];
  const marks: string[] = [];
  const store: LoaderStore = {
    async upsertConcepts(rows) {
      concepts.push(rows);
    },
    async upsertMapElements() {},
    async markSystemChanged(url) {
      marks.push(url);
    },
    async saveResource(): Promise<SavedRef> {
      return { resourceType: 'CodeSystem', id: 'res-request-attribute' };
    },
    async saveSystem() {},
  };
  return { store, concepts, marks };
}

describe('the request attribute CodeSystem file', () => {
  it('has the fixed url', () => {
    const cs = readCodeSystem();
    expect(cs.url).toBe(REQUEST_ATTRIBUTE_SYSTEM);
  });

  it('has 25 concepts, each with a lowercase-hyphen code and a display', () => {
    const cs = readCodeSystem();
    expect(cs.concept).toHaveLength(25);
    for (const c of cs.concept) {
      expect(c.code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.display).toBeTruthy();
    }
  });

  it('has unique codes', () => {
    const cs = readCodeSystem();
    const codes = cs.concept.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('imports 25 concepts through the loader openldr terminology import resource uses', async () => {
    const { store, concepts, marks } = memoryStore();
    const cs = readCodeSystem();
    const result = await importTerminologyResource(cs, store);

    expect(result.system).toBe(REQUEST_ATTRIBUTE_SYSTEM);
    expect(result.conceptsLoaded).toBe(25);
    expect(marks).toEqual([REQUEST_ATTRIBUTE_SYSTEM]);

    const rows = concepts[0] as { system: string; code: string }[];
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => r.system === REQUEST_ATTRIBUTE_SYSTEM)).toBe(true);
    expect(rows.find((r) => r.code === 'therapy')).toBeTruthy();
    expect(rows.find((r) => r.code === 'target-time-mins')).toBeTruthy();
  });
});
