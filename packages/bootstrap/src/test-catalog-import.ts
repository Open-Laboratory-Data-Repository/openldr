import { z } from 'zod';
import type { TableFile } from './table-file';
import type { CatalogCategoryOption, CatalogSpecimenOption, CatalogTest, SpecimenCoding } from './test-catalog';

// The pure half of the test catalog import (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.4):
// which column feeds which field, reading rows, and matching file text to the category and specimen
// lists. The service in ./test-catalog.ts does everything that reads or writes the database.

/** A national list is hundreds of rows, a few thousand at most (spec 4.4). */
export const CATALOG_IMPORT_MAX_ROWS = 5000;
/** Far above 5,000 rows of CSV. It bounds what reading an Excel file can cost. */
export const CATALOG_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type CatalogImportField = 'code' | 'name' | 'shortName' | 'loinc' | 'category' | 'specimenTypes';
export const CATALOG_IMPORT_FIELDS: readonly CatalogImportField[] = ['code', 'name', 'shortName', 'loinc', 'category', 'specimenTypes'];

/** Which file column feeds each field, by header text. A field left out is not read, so the import leaves it alone. */
export type CatalogColumnMap = Partial<Record<CatalogImportField, string>>;

/** The operator's answer for a category text that matched nothing: an existing category, or a new one. */
export type CategoryAnswer =
  | { text: string; kind: 'existing'; code: string }
  | { text: string; kind: 'new'; code: string; display: string };

/** The operator's answer for a specimen text that matched nothing. */
export interface SpecimenAnswer {
  text: string;
  system: string;
  code: string;
}

/** Answers travel as lists, not as an object keyed by the file's text: a key like __proto__ would reach the prototype. */
export interface CatalogValueMap {
  categories: CategoryAnswer[];
  specimens: SpecimenAnswer[];
}

export interface CatalogImportRow {
  /** The row number in the spreadsheet. The header is row 1. */
  line: number;
  /** Each mapped column's trimmed text. A field missing here was not mapped. */
  values: Partial<Record<CatalogImportField, string>>;
}

/** The header names each field answers to, lower case with everything but letters and digits removed. */
const HEADER_NAMES: Record<CatalogImportField, readonly string[]> = {
  code: ['code', 'nationalcode', 'testcode'],
  name: ['name', 'testname', 'display'],
  shortName: ['shortname', 'abbreviation'],
  loinc: ['loinc', 'loinccode'],
  category: ['category', 'testcategory'],
  specimenTypes: ['specimentypes', 'specimentype', 'specimens', 'specimen'],
};

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Case and spacing do not count when file text is matched to a list (spec 4.4). */
export function valueKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** CE's guess at the column map. The operator confirms it on the Columns step. */
export function suggestCatalogColumns(headers: string[]): CatalogColumnMap {
  const map: CatalogColumnMap = {};
  const used = new Set<string>();
  for (const field of CATALOG_IMPORT_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && HEADER_NAMES[field].includes(headerKey(h)));
    if (hit !== undefined) {
      map[field] = hit;
      used.add(hit);
    }
  }
  return map;
}

/** What is wrong with a column map, or null. The first problem only. */
export function checkColumnMap(map: CatalogColumnMap, headers: string[]): string | null {
  if (!map.name) return 'Choose the column that holds the test name. It is required.';
  const used = new Set<string>();
  for (const field of CATALOG_IMPORT_FIELDS) {
    const header = map[field];
    if (header === undefined) continue;
    if (!headers.includes(header)) return `The file has no column "${header}".`;
    if (used.has(header)) return `Column "${header}" is chosen for two fields.`;
    used.add(header);
  }
  return null;
}

/**
 * Read the mapped columns of every row. Cells are trimmed again here, because the table comes back
 * from the studio with each step. Two columns with the same header read as the first of them.
 */
export function readCatalogRows(table: Pick<TableFile, 'headers' | 'rows'>, map: CatalogColumnMap): CatalogImportRow[] {
  const columns: Array<[CatalogImportField, number]> = [];
  for (const field of CATALOG_IMPORT_FIELDS) {
    const header = map[field];
    if (header !== undefined) columns.push([field, table.headers.indexOf(header)]);
  }
  return table.rows.map((cells, i) => {
    const values: Partial<Record<CatalogImportField, string>> = {};
    for (const [field, col] of columns) values[field] = (cells[col] ?? '').trim();
    return { line: i + 2, values };
  });
}

/** A cell may hold several specimens, split on ";" (spec 4.4). */
export function splitSpecimens(text: string): string[] {
  return text.split(';').map((s) => s.trim()).filter((s) => s !== '');
}

/** The one category the text names, by code or by name. Null when none does, or when two do. */
export function matchCategory(text: string, options: CatalogCategoryOption[]): string | null {
  const key = valueKey(text);
  const hits = new Set(options
    .filter((o) => valueKey(o.code) === key || (o.display !== null && valueKey(o.display) === key))
    .map((o) => o.code));
  return hits.size === 1 ? [...hits][0] : null;
}

/** The one specimen the text names, by code or by name. Null when none does, or when two do. */
export function matchSpecimen(text: string, options: CatalogSpecimenOption[]): SpecimenCoding | null {
  const key = valueKey(text);
  const hits = new Map<string, SpecimenCoding>();
  for (const o of options) {
    if (valueKey(o.code) === key || (o.display !== null && valueKey(o.display) === key)) {
      hits.set(`${o.system}|${o.code}`, { system: o.system, code: o.code });
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/** The export's columns. suggestCatalogColumns maps every one, so an export imports back as it is. */
export const CATALOG_EXPORT_HEADERS = ['code', 'name', 'short_name', 'loinc', 'category', 'specimen_types'] as const;
export const CATALOG_EXPORT_COLUMNS = CATALOG_EXPORT_HEADERS.map((h) => ({ key: h, label: h }));

export function catalogExportRow(t: CatalogTest): Record<string, string> {
  return {
    code: t.code,
    name: t.display,
    short_name: t.shortName ?? '',
    loinc: t.loinc ?? '',
    category: t.category ?? '',
    specimen_types: t.specimenTypes.map((s) => s.code).join(';'),
  };
}

// The shapes an import step accepts. The route checks request bodies with these and the CLI checks its
// --column-map and --value-map files with them, so the two doors refuse the same things.
const headerText = z.string().min(1);
export const catalogColumnMapSchema = z.object({
  code: headerText.optional(),
  name: headerText.optional(),
  shortName: headerText.optional(),
  loinc: headerText.optional(),
  category: headerText.optional(),
  specimenTypes: headerText.optional(),
}).strict();

export const catalogValueMapSchema = z.object({
  categories: z.array(z.discriminatedUnion('kind', [
    z.object({ text: z.string(), kind: z.literal('existing'), code: z.string().min(1) }),
    z.object({ text: z.string(), kind: z.literal('new'), code: z.string(), display: z.string() }),
  ])),
  specimens: z.array(z.object({ text: z.string(), system: z.string().min(1), code: z.string().min(1) })),
});

export const catalogImportInputSchema = z.object({
  table: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  columnMap: catalogColumnMapSchema,
  valueMap: catalogValueMapSchema.optional(),
});
