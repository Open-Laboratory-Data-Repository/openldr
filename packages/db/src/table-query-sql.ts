import { sql, type ExpressionBuilder, type Expression, type SqlBool, type OrderByItemBuilder } from "kysely";
import { getColumn, type ParsedFilter, type ParsedSort, type TableColumnMap } from "@openldr/table-query";

/** Escape the LIKE metacharacters so a user's `%` or `_` matches a literal character. */
function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

function ruleExpression(
  eb: ExpressionBuilder<any, any>,
  rule: ParsedFilter,
  columns: TableColumnMap,
): Expression<SqlBool> {
  // getColumn — not a plain `columns[rule.column]` index — so this backstop actually catches a
  // caller that builds a ParsedFilter by hand with a prototype-chain name like "constructor":
  // `columns["constructor"]` returns `Object` (truthy), which would sail past a plain `!spec`
  // check and hand `undefined` `spec.sql` to sql.ref below. Unreachable via parseTableQuery,
  // which rejects unknown columns first (including those); this is the backstop for anyone else.
  const spec = getColumn(columns, rule.column);
  if (!spec) throw new Error(`unknown column "${rule.column}"`);
  const col = sql.ref(spec.sql);
  const asText = sql<string>`coalesce(${col}::text, '')`;

  switch (rule.operator) {
    case "eq":
      return sql<SqlBool>`${asText} = ${String(rule.value)}`;
    case "ne":
      // Coalesce-to-'' matches the client's `String(value ?? "") !== target`, which counts a
      // NULL row as a mismatch (and therefore included by `ne`). A plain `<> value` would drop it.
      return sql<SqlBool>`${asText} <> ${String(rule.value)}`;
    case "like": {
      const needle = String(rule.value ?? "");
      if (needle === "") return sql<SqlBool>`true`;
      const escaped = escapeLike(needle);
      const pattern = "%" + escaped + "%";
      // Only declare an ESCAPE character when the needle actually contained one of the LIKE
      // metacharacters — an unconditional `escape '\'` on every query is needless noise, and
      // pg-mem's parser (unlike Postgres) cannot parse the ESCAPE clause at all, so this also
      // keeps the common no-metacharacter case testable under pg-mem.
      return escaped === needle
        ? sql<SqlBool>`${col}::text ilike ${pattern}`
        : sql<SqlBool>`${col}::text ilike ${pattern} escape '\\'`;
    }
    case "gt":
      return sql<SqlBool>`${col} > ${rule.value}`;
    case "gte":
      return sql<SqlBool>`${col} >= ${rule.value}`;
    case "lt":
      // compareValues (applyTableState.ts:17-27) treats a null column value as sorting before
      // any non-null target, so the client's matchesRule counts a NULL row as matching "lt".
      // A plain `col < value` evaluates NULL (excluded) instead — add the null case explicitly.
      // gt/gte need no such fix: compareValues(null, target) is always -1, which is never > 0
      // or >= 0, so both sides already agree those are false for a null row.
      return sql<SqlBool>`(${col} is null or ${col} < ${rule.value})`;
    case "lte":
      // Same null-handling gap as "lt" above.
      return sql<SqlBool>`(${col} is null or ${col} <= ${rule.value})`;
    case "between": {
      const [lo, hi] = rule.value as [string, string];
      // Parenthesized so this stays atomic if a later fold step ORs it with something else —
      // AND happens to be associative with OR's precedence here, but don't rely on that holding
      // for every future operator that reuses this shape.
      return sql<SqlBool>`(${col} >= ${lo} and ${col} <= ${hi})`;
    }
    case "in": {
      // `value` is typed as an array for "in", but that's compile-time only — a caller building
      // a ParsedFilter by hand (or a future parser bug) could still hand this a bare string. Wrap
      // it into a single-element list rather than let `.length`/`any(...)` misbehave on a string.
      const list = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value)];
      if (list.length === 0) return sql<SqlBool>`false`;
      return sql<SqlBool>`${asText} = any(${list})`;
    }
    case "is_null":
      // Parenthesized: this is an internal OR. Kysely's eb.and/eb.or parenthesize the OUTER
      // combination they build, not each operand's own internals, so an unparenthesized OR here
      // would silently regroup with whatever AND/OR the fold attaches next. See the
      // "is_null's internal OR stays correctly grouped" test.
      return sql<SqlBool>`(${col} is null or ${col}::text = '')`;
    case "is_not_null":
      return sql<SqlBool>`(${col} is not null and ${col}::text <> '')`;
  }
}

/**
 * Fold the rules exactly as the client does — flat, left to right, so
 * `A AND B OR C` is `(A AND B) OR C`. See applyTableState.ts:80-92. A different
 * association here makes the same filter set select different rows on a
 * server-paginated page than on a client-side one.
 */
export function buildFilterExpression(
  eb: ExpressionBuilder<any, any>,
  filters: ParsedFilter[],
  columns: TableColumnMap,
): Expression<SqlBool> | undefined {
  if (filters.length === 0) return undefined;
  let acc = ruleExpression(eb, filters[0]!, columns);
  for (let i = 1; i < filters.length; i++) {
    const next = ruleExpression(eb, filters[i]!, columns);
    acc = filters[i]!.combine === "or" ? eb.or([acc, next]) : eb.and([acc, next]);
  }
  return acc;
}

/**
 * Apply sorts, always appending the resource's unique tiebreaker. Without it,
 * ORDER BY + OFFSET can repeat or skip rows between pages when the sort key
 * has duplicates — and pg-mem's stable scan order can never demonstrate that.
 *
 * `defaultSorts` is used only when the caller sends no sort at all (`sorts.length === 0`).
 * A caller that supplies any sort of its own overrides the defaults entirely — the two never
 * merge. Without a default, an unsorted request would fall through to "tiebreaker only", which
 * silently replaces a resource's normal order (e.g. audit's newest-first) with UUID order.
 */
export function applySorts<QB extends { orderBy: (c: any, d: any) => QB }>(
  qb: QB,
  sorts: ParsedSort[],
  columns: TableColumnMap,
  tiebreaker: string,
  defaultSorts: ParsedSort[] = [],
): QB {
  let out = qb;
  const effective = sorts.length > 0 ? sorts : defaultSorts;
  for (const s of effective) {
    const spec = getColumn(columns, s.column);
    // Unreachable via parseTableQuery, which rejects unknown/non-sortable columns first. Kept as
    // a defensive backstop: silently dropping a sort here would look like the query succeeded
    // while quietly ignoring part of what the caller asked for.
    if (!spec) throw new Error(`unknown column "${s.column}"`);
    // Nulls placement must mirror applyTableState.ts's comparator (apps/studio/src/components/
    // data-table/applyTableState.ts:17-27): a null value always compares as "less than" any
    // non-null value, and descending negates that comparison — so ascending keeps null first,
    // descending pushes it last. Postgres defaults to the opposite in both directions
    // (ASC -> NULLS LAST, DESC -> NULLS FIRST), so it must be overridden explicitly here.
    out = out.orderBy(sql.ref(spec.sql), (ob: OrderByItemBuilder) =>
      s.ascending ? ob.asc().nullsFirst() : ob.desc().nullsLast(),
    );
  }
  const tb = getColumn(columns, tiebreaker);
  // A silently-skipped tiebreaker is worse than a missing sort: it reintroduces the exact
  // ORDER BY + OFFSET instability this function exists to prevent, without any visible symptom
  // until pages start repeating or skipping rows. Fail loud instead.
  if (!tb) throw new Error(`unknown tiebreaker column "${tiebreaker}"`);
  out = out.orderBy(sql.ref(tb.sql), "asc");
  return out;
}
