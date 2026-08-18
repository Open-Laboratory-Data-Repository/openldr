import type { FilterCombine, FilterOperator, FilterRule, SortRule } from "./types";
import type { TableColumnMap, TableColumnSpec } from "./columns";

export type ParsedFilter = Omit<FilterRule, "id">;
export type ParsedSort = Omit<SortRule, "id">;
export interface ParsedTableQuery { filters: ParsedFilter[]; sorts: ParsedSort[] }
export type ParseResult =
  | { ok: true; query: ParsedTableQuery }
  | { ok: false; error: string };

export const MAX_QUERY_CHARS = 4096;
export const MAX_FILTER_RULES = 25;
export const MAX_SORT_RULES = 5;

const NO_VALUE: FilterOperator[] = ["is_null", "is_not_null"];

function fail(error: string): ParseResult { return { ok: false, error }; }

/** Looks up a column spec without falling through the prototype chain (`__proto__`, `constructor`, ...). */
function getColumn(columns: TableColumnMap, name: string): TableColumnSpec | undefined {
  if (!Object.prototype.hasOwnProperty.call(columns, name)) return undefined;
  return columns[name];
}

/** A filter/sort rule entry must be a plain, non-null, non-array object before any field is read off it. */
function isRuleObject(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry);
}

function decode(raw: string | undefined, what: string): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (raw === undefined || raw === "") return { ok: true, value: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: `${what} is not valid JSON` }; }
  if (!Array.isArray(parsed)) return { ok: false, error: `${what} must be a JSON array` };
  return { ok: true, value: parsed };
}

export function parseTableQuery(
  raw: { filters?: string; sorts?: string },
  columns: TableColumnMap,
): ParseResult {
  const filtersRaw = raw.filters ?? "";
  const sortsRaw = raw.sorts ?? "";
  const totalChars = filtersRaw.length + sortsRaw.length;
  if (totalChars > MAX_QUERY_CHARS) {
    return fail(`filters and sorts together are too large (${totalChars} chars, max ${MAX_QUERY_CHARS})`);
  }

  const f = decode(raw.filters, "filters");
  if (!f.ok) return fail(f.error);
  const s = decode(raw.sorts, "sorts");
  if (!s.ok) return fail(s.error);

  if (f.value.length > MAX_FILTER_RULES) {
    return fail(`too many filter rules (${f.value.length}, max ${MAX_FILTER_RULES})`);
  }
  if (s.value.length > MAX_SORT_RULES) {
    return fail(`too many sort rules (${s.value.length}, max ${MAX_SORT_RULES})`);
  }

  const filters: ParsedFilter[] = [];
  for (const entry of f.value) {
    if (!isRuleObject(entry)) return fail("a filter rule must be an object");
    const r = entry as Partial<FilterRule>;
    if (typeof r.column !== "string") return fail("a filter rule is missing its column");
    const spec = getColumn(columns, r.column);
    if (!spec) return fail(`unknown filter column "${r.column}"`);
    if (typeof r.operator !== "string" || !spec.operators.includes(r.operator as FilterOperator)) {
      return fail(`operator "${String(r.operator)}" is not allowed on column "${r.column}"`);
    }
    const operator = r.operator as FilterOperator;
    let combine: FilterCombine;
    if (r.combine === undefined) {
      combine = "and";
    } else if (r.combine === "and" || r.combine === "or") {
      combine = r.combine;
    } else {
      return fail(`combine "${String(r.combine)}" on column "${r.column}" must be "and" or "or"`);
    }

    if (NO_VALUE.includes(operator)) {
      filters.push({ column: r.column, operator, value: "", combine });
      continue;
    }
    if (operator === "between") {
      if (!Array.isArray(r.value) || r.value.length !== 2) {
        return fail(`operator "between" on column "${r.column}" needs exactly two values`);
      }
      filters.push({ column: r.column, operator, value: [String(r.value[0]), String(r.value[1])], combine });
      continue;
    }
    if (operator === "in") {
      const list = Array.isArray(r.value) ? r.value.map(String) : String(r.value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      filters.push({ column: r.column, operator, value: list, combine });
      continue;
    }
    if (Array.isArray(r.value)) return fail(`operator "${operator}" on column "${r.column}" takes a single value`);
    filters.push({ column: r.column, operator, value: String(r.value ?? ""), combine });
  }

  const sorts: ParsedSort[] = [];
  for (const entry of s.value) {
    if (!isRuleObject(entry)) return fail("a sort rule must be an object");
    const r = entry as Partial<SortRule>;
    if (typeof r.column !== "string") return fail("a sort rule is missing its column");
    const spec = getColumn(columns, r.column);
    if (!spec) return fail(`unknown sort column "${r.column}"`);
    if (!spec.sortable) return fail(`column "${r.column}" is not sortable`);
    sorts.push({ column: r.column, ascending: r.ascending !== false });
  }

  return { ok: true, query: { filters, sorts } };
}
