import { sql, type ExpressionBuilder, type Expression, type SqlBool } from "kysely";
import type { ParsedFilter, ParsedSort, TableColumnMap } from "@openldr/table-query";

/** Escape the LIKE metacharacters so a user's `%` or `_` matches a literal character. */
function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

function ruleExpression(
  eb: ExpressionBuilder<any, any>,
  rule: ParsedFilter,
  columns: TableColumnMap,
): Expression<SqlBool> {
  const spec = columns[rule.column];
  // Unreachable via parseTableQuery, which rejects unknown columns first. Kept as a
  // defensive backstop for any other caller that builds a ParsedFilter directly.
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
      return sql<SqlBool>`${col} < ${rule.value}`;
    case "lte":
      return sql<SqlBool>`${col} <= ${rule.value}`;
    case "between": {
      const [lo, hi] = rule.value as [string, string];
      // Parenthesized so this stays atomic if a later fold step ORs it with something else —
      // AND happens to be associative with OR's precedence here, but don't rely on that holding
      // for every future operator that reuses this shape.
      return sql<SqlBool>`(${col} >= ${lo} and ${col} <= ${hi})`;
    }
    case "in": {
      const list = rule.value as string[];
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
 */
export function applySorts<QB extends { orderBy: (c: any, d: "asc" | "desc") => QB }>(
  qb: QB,
  sorts: ParsedSort[],
  columns: TableColumnMap,
  tiebreaker: string,
): QB {
  let out = qb;
  for (const s of sorts) {
    const spec = columns[s.column];
    if (!spec) continue;
    out = out.orderBy(sql.ref(spec.sql), s.ascending ? "asc" : "desc");
  }
  const tb = columns[tiebreaker];
  if (tb) out = out.orderBy(sql.ref(tb.sql), "asc");
  return out;
}
