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

// Postgres needs at least YYYY-MM-DD. Date.parse is far looser — it accepts "2026" and
// "2026-08", which then fail as `invalid input syntax for type timestamp with time zone`
// and surface as a 500. Measured: '2026'::timestamptz and '2026-08'::timestamptz both error;
// '2026-08-18', '2026-08-18T12:00:00Z' and '2026-08-18 12:00:00+03' all parse.
const PG_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

function fail(error: string): ParseResult { return { ok: false, error }; }

/**
 * Reject a value that would reach Postgres and throw a type error instead of a clean 400 —
 * verified live: `gte "abc"` against a timestamptz column throws "invalid input syntax for
 * type timestamp with time zone", and a `between` pair with one empty box throws the same for
 * `""`. Validation belongs here, at the parse boundary, not in the SQL translator.
 *
 * A no-op for "text"/"enum" columns — an empty string there is legitimate (e.g. `like` with an
 * empty needle deliberately matches everything, per matchesRule in applyTableState.ts).
 */
function typedValueError(type: "text" | "number" | "date" | "enum", column: string, value: string): string | undefined {
  if (type === "number") {
    if (value.trim() === "" || !Number.isFinite(Number(value))) {
      return `value "${value}" for column "${column}" is not a valid number`;
    }
  }
  if (type === "date") {
    if (value.trim() === "" || !PG_DATE.test(value.trim()) || Number.isNaN(Date.parse(value))) {
      return `value "${value}" for column "${column}" is not a valid date`;
    }
  }
  return undefined;
}

/** Looks up a column spec without falling through the prototype chain (`__proto__`, `constructor`, ...). */
export function getColumn(columns: TableColumnMap, name: string): TableColumnSpec | undefined {
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
      const lo = String(r.value[0]);
      const hi = String(r.value[1]);
      const loError = typedValueError(spec.type, r.column, lo);
      if (loError) return fail(loError);
      const hiError = typedValueError(spec.type, r.column, hi);
      if (hiError) return fail(hiError);
      filters.push({ column: r.column, operator, value: [lo, hi], combine });
      continue;
    }
    if (operator === "in") {
      const list = Array.isArray(r.value) ? r.value.map(String) : String(r.value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      for (const item of list) {
        const itemError = typedValueError(spec.type, r.column, item);
        if (itemError) return fail(itemError);
      }
      filters.push({ column: r.column, operator, value: list, combine });
      continue;
    }
    if (Array.isArray(r.value)) return fail(`operator "${operator}" on column "${r.column}" takes a single value`);
    const single = String(r.value ?? "");
    // "like" deliberately allows an empty needle (matches everything), and is never permitted on
    // a number/date column's operator list — so this validation never fires for it in practice.
    const singleError = operator === "like" ? undefined : typedValueError(spec.type, r.column, single);
    if (singleError) return fail(singleError);
    filters.push({ column: r.column, operator, value: single, combine });
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
