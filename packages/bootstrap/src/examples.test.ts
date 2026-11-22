import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seededStarterPacks } from '@openldr/forms';
import { validateBatch } from '@openldr/fhir';
import { fhirValueSetToInput, type CustomQueryParam } from '@openldr/db';
import { prepareSelect } from '@openldr/dashboards';
import { parseFacilityCsv, parseTerminologyTerms } from '@openldr/terminology';
import { checkCustomQueryFile } from './custom-query-transfer';
import { readCatalogImportFile } from './test-catalog';
import { checkColumnMap, readCatalogRows } from './test-catalog-import';
import { createMapToFhirApi } from './map-to-fhir-api';
import { createMapToFhirService } from './map-to-fhir-service';

/**
 * Every file in `examples/` that this package can check goes through the same code its import runs.
 * Studio checks the dashboards, forms and workflow files with its own reshaping code.
 */

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url));

// The subfolders of `examples/`.
const EXAMPLE_FOLDERS = ['dashboards', 'facilities', 'forms', 'queries', 'terminology', 'test-catalog', 'workflows'];

// The folders whose files this test checks, and the files it checks in each.
const CHECKED: Record<string, string[]> = {
  queries: ['queries.json'],
  facilities: ['facilities.csv'],
  terminology: ['value-set.json', 'terms.csv'],
  'test-catalog': ['test-catalog.csv'],
};

const read = (path: string): string => readFileSync(`${EXAMPLES}${path}`, 'utf8');
const readJson = (path: string): unknown => JSON.parse(read(path));

describe('the examples folder', () => {
  it('has exactly the expected subfolders', () => {
    const dirs = readdirSync(EXAMPLES).filter((n) => statSync(`${EXAMPLES}${n}`).isDirectory()).sort();
    expect(dirs).toEqual(EXAMPLE_FOLDERS);
  });

  it('has a README at the top and in each folder this test owns', () => {
    for (const folder of ['', ...Object.keys(CHECKED).map((f) => `${f}/`)]) {
      expect(() => statSync(`${EXAMPLES}${folder}README.md`), `${folder}README.md`).not.toThrow();
    }
  });

  it('checks every file in queries, facilities, terminology and test-catalog', () => {
    for (const [folder, files] of Object.entries(CHECKED)) {
      const present = readdirSync(`${EXAMPLES}${folder}`).filter((n) => n !== 'README.md').sort();
      expect(present, folder).toEqual([...files].sort());
    }
  });
});

describe('queries', () => {
  it('queries.json passes the checks the query import runs', () => {
    const file = readJson('queries/queries.json') as { queries: unknown[] };
    expect(() => checkCustomQueryFile(file)).not.toThrow();
    expect(file.queries.length).toBeGreaterThanOrEqual(1);
  });

  it('each query fills its parameters the way the Query page runs it', () => {
    const file = readJson('queries/queries.json') as { queries: { sql: string; params: CustomQueryParam[] }[] };
    for (const q of file.queries) {
      const values = Object.fromEntries(q.params.map((p) => [p.id, p.type === 'daterange' ? { from: '2026-01-01', to: '2026-01-31' } : 'X']));
      expect(() => prepareSelect(q.sql, q.params, values, 'postgres')).not.toThrow();
    }
  });
});

describe('facilities', () => {
  it('facilities.csv imports with no problems', () => {
    const res = parseFacilityCsv(read('facilities/facilities.csv'), { nationalSystem: 'urn:example:facility-register' });
    expect(res.unknownColumns).toEqual([]);
    expect(res.duplicateColumns).toEqual([]);
    expect(res.columnMapErrors).toEqual([]);
    expect(res.quarantined).toEqual([]);
    expect(res.invalid).toEqual([]);
    expect(res.records.length).toBeGreaterThanOrEqual(3);
  });
});

describe('terminology', () => {
  it('terms.csv parses into concepts', () => {
    const records = parseTerminologyTerms(read('terminology/terms.csv'), 'urn:example:cs', 'EXAMPLE');
    expect(records.length).toBeGreaterThanOrEqual(3);
  });

  it('value-set.json is a FHIR ValueSet the importer reads', () => {
    const input = fhirValueSetToInput(readJson('terminology/value-set.json'));
    expect(input.url).toBeTruthy();
    expect(input.compose.include?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('test catalog', () => {
  it('test-catalog.csv maps with the suggested columns', () => {
    const text = read('test-catalog/test-catalog.csv');
    const file = readCatalogImportFile(new TextEncoder().encode(text), 'csv');
    expect(checkColumnMap(file.suggested, file.headers)).toBeNull();
    const dataRows = text.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
    const rows = readCatalogRows(file, file.suggested);
    expect(rows).toHaveLength(dataRows);
    expect(rows.every((r) => r.values.name)).toBe(true);
  });
});

describe('workflow payload', () => {
  const PACKS = seededStarterPacks().map((p) => ({ id: p.id, resourceType: p.resourceType, entries: p.entries }));
  type Mapping = { rows: { targetPath: string; from: { field?: string } }[] };
  type Config = { sourcePath?: string; targetId: string; formIds: string[]; mappings: Mapping[] };
  type Workflow = { enabled: boolean; definition: { nodes: { data: { action?: string; config?: Config } }[] } };
  const workflow = (): Workflow => readJson('workflows/ingest-lab-rows.workflow.json') as Workflow;
  const payload = (): Record<string, unknown>[] => readJson('workflows/payload.json') as Record<string, unknown>[];
  const mapConfig = (): Config => workflow().definition.nodes.find((n) => n.data.action === 'map-to-fhir')!.data.config!;

  it('payload.json maps through the example workflow\'s own mapping, nothing held', async () => {
    const config = mapConfig();
    expect(config.sourcePath).toBe('body');
    expect(config.formIds).toEqual([]);
    const service = createMapToFhirService({
      forms: { get: async () => null },
      validateForm: async () => {
        throw new Error('the example has no form');
      },
      packs: async () => PACKS,
      translateCode: async () => null,
      validate: (resources, known) => validateBatch(resources, { level: 'high', resolveServiceRequest: async (id) => known.has(id) }),
    });
    const api = createMapToFhirApi({ mapToFhir: service, packs: async () => PACKS, conceptMaps: async () => [], localSourceSystems: async () => [] });
    const items = payload();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(3);
    const res = await api.test({ config: { targetId: config.targetId, formIds: config.formIds, mappings: config.mappings }, items });
    expect(res).toHaveLength(items.length);
    for (const r of res) expect(r).toMatchObject({ ok: true, kind: 'mapped' });
  });

  it('the example workflow is switched off and has no webhook secret', () => {
    const wf = workflow();
    expect(wf.enabled).toBe(false);
    expect(JSON.stringify(wf)).not.toMatch(/"secret"/);
  });

  it('payload.json uses only made-up patients', () => {
    const rows = mapConfig().mappings.flatMap((m) => m.rows);
    const column = (path: string): string => rows.find((r) => r.targetPath.startsWith(path))!.from.field!;
    const id = column('Patient.identifier.value');
    const family = column('Patient.name.family');
    for (const row of payload()) {
      expect(String(row[id])).toMatch(/^EXAMPLE-/);
      expect(row[family]).toBe('Example');
    }
  });
});
