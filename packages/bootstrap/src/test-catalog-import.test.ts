import { describe, expect, it } from 'vitest';
import {
  suggestCatalogColumns, checkColumnMap, readCatalogRows, splitSpecimens, valueKey,
  matchCategory, matchSpecimen, catalogExportRow, CATALOG_EXPORT_HEADERS,
  catalogColumnMapSchema, catalogValueMapSchema,
} from './test-catalog-import';
import type { CatalogTest } from './test-catalog';

const LOCAL = 'urn:openldr:cs:local';
const CATEGORIES = [{ code: 'MOL', display: 'Molecular' }, { code: 'HAEM', display: 'Haematology' }];
const SPECIMENS = [
  { system: LOCAL, code: 'BLD', display: 'Blood' },
  { system: LOCAL, code: 'UR', display: 'Urine' },
  // The same code in a second list, so "UR" alone names two specimens.
  { system: 'urn:example:other', code: 'UR', display: 'Urine sample' },
];

describe('suggestCatalogColumns', () => {
  it('matches common header spellings, ignoring case, spaces and punctuation', () => {
    expect(suggestCatalogColumns(['Test Code', 'Test name', 'Abbreviation', 'LOINC code', 'Category', 'Specimen types', 'Notes']))
      .toEqual({
        code: 'Test Code', name: 'Test name', shortName: 'Abbreviation', loinc: 'LOINC code',
        category: 'Category', specimenTypes: 'Specimen types',
      });
  });

  it('suggests every column of an export, so an export imports back with no mapping', () => {
    expect(suggestCatalogColumns([...CATALOG_EXPORT_HEADERS])).toEqual({
      code: 'code', name: 'name', shortName: 'short_name', loinc: 'loinc', category: 'category', specimenTypes: 'specimen_types',
    });
  });

  it('leaves a field out when no header fits it', () => {
    expect(suggestCatalogColumns(['Name', 'Description'])).toEqual({ name: 'Name' });
  });
});

describe('checkColumnMap', () => {
  it('needs the name, and each column it names must exist and be used once', () => {
    const headers = ['code', 'name'];
    expect(checkColumnMap({ code: 'code', name: 'name' }, headers)).toBeNull();
    expect(checkColumnMap({ code: 'code' }, headers)).toBe('Choose the column that holds the test name. It is required.');
    expect(checkColumnMap({ name: 'title' }, headers)).toBe('The file has no column "title".');
    expect(checkColumnMap({ name: 'name', shortName: 'name' }, headers)).toBe('Column "name" is chosen for two fields.');
  });
});

describe('readCatalogRows', () => {
  it('reads each mapped column, numbers rows as the spreadsheet does, and leaves unmapped fields out', () => {
    const table = { headers: ['code', 'name', 'notes'], rows: [[' A1 ', 'Alpha', 'x'], ['', 'Beta', '']] };
    expect(readCatalogRows(table, { code: 'code', name: 'name' })).toEqual([
      { line: 2, values: { code: 'A1', name: 'Alpha' } },
      { line: 3, values: { code: '', name: 'Beta' } },
    ]);
  });
});

describe('matching file text to the lists', () => {
  it('ignores case and spacing', () => {
    expect(valueKey('  Whole   Blood ')).toBe('whole blood');
    expect(splitSpecimens('Blood; urine ;;')).toEqual(['Blood', 'urine']);
  });

  it('matches a category by its code or its name', () => {
    expect(matchCategory('molecular', CATEGORIES)).toBe('MOL');
    expect(matchCategory(' mol ', CATEGORIES)).toBe('MOL');
    expect(matchCategory('Virology', CATEGORIES)).toBeNull();
  });

  it('matches a specimen by code or name, and not when the text names two', () => {
    expect(matchSpecimen('blood', SPECIMENS)).toEqual({ system: LOCAL, code: 'BLD' });
    expect(matchSpecimen('BLD', SPECIMENS)).toEqual({ system: LOCAL, code: 'BLD' });
    expect(matchSpecimen('Urine', SPECIMENS)).toEqual({ system: LOCAL, code: 'UR' });
    expect(matchSpecimen('UR', SPECIMENS)).toBeNull();
    expect(matchSpecimen('Stool', SPECIMENS)).toBeNull();
  });
});

describe('catalogExportRow', () => {
  it('writes a test in the import layout, codes for category and specimens', () => {
    const test: CatalogTest = {
      code: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL',
      specimenTypes: [{ system: LOCAL, code: 'BLD' }, { system: LOCAL, code: 'UR' }], loinc: '25836-8', active: true,
      lab: { enabled: true, specimenTypes: null, localDisplay: 'VL' },
    };
    expect(catalogExportRow(test)).toEqual({
      code: 'HIVVL', name: 'HIV viral load', short_name: '', loinc: '25836-8', category: 'MOL', specimen_types: 'BLD;UR',
    });
  });
});

describe('the shapes the route and the CLI accept', () => {
  it('takes a column map of known fields only', () => {
    expect(catalogColumnMapSchema.safeParse({ name: 'Test name', loinc: 'LOINC' }).success).toBe(true);
    expect(catalogColumnMapSchema.safeParse({ name: 'Test name', notes: 'Notes' }).success).toBe(false);
  });

  it('takes a value map whose new categories carry a name', () => {
    const ok = {
      categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }, { text: 'Mol', kind: 'existing', code: 'MOL' }],
      specimens: [{ text: 'Plasma', system: LOCAL, code: 'BLD' }],
    };
    expect(catalogValueMapSchema.safeParse(ok).success).toBe(true);
    expect(catalogValueMapSchema.safeParse({ categories: [{ text: 'Virology', kind: 'new', code: 'VIRO' }], specimens: [] }).success)
      .toBe(false);
  });
});
