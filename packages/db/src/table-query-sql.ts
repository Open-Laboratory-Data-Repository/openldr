import { sql, type ExpressionBuilder, type Expression, type SqlBool, type OrderByItemBuilder } from "kysely";
import { DATE_ONLY, getColumn, type ParsedFilter, type ParsedSort, type TableColumnMap } from "@openldr/table-query";

/** Escape the LIKE metacharacters so a user's `%` or `_` matches a literal character. */
function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

/** True when `value` is a bare calendar date (`YYYY-MM-DD`) rather than a full timestamp. */
function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value.trim());
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
    case "eq": {
      // A date column's "eq 2026-08-06" means the whole day, not the single midnight instant a
      // literal comparison would match — the value renders as `2026-08-06 01:18:19.491521+00`,
      // which is never equal to the bare date the DatePicker sends (0 rows, measured live). Only
      // expand when the value itself is date-only.
      const value = String(rule.value);
      if (spec.type === "date") {
        if (isDateOnly(value)) {
          const day = value.trim();
          // ASSUMPTION, not enforced here: `day::timestamptz` resolves midnight in the database
          // connection's `TimeZone`, which createInternalDb leaves unset (session default). The
          // client's dayBoundsMs (applyTableState.ts) resolves the same boundary in UTC, always.
          // The two agree only because the shipped compose sets no TZ — an externally provisioned
          // Postgres with a non-UTC default shifts this whole-day window, and the client and SQL
          // would then select different rows for the same filter. pg-mem has no timezone support,
          // so no test catches that. See applyTableState.ts's dayBoundsMs for the matching note.
          return sql<SqlBool>`(${col} >= ${day}::timestamptz and ${col} < (${day}::timestamptz + interval '1 day'))`;
        }
        // A full-timestamp value on a date column: parseTableQuery already validated it against
        // PG_DATE, so this is reachable — the CLI's `--where col:eq:<ISO timestamp>` passes one
        // straight through (packages/cli/src/table-query-flags.ts), it's not studio-DatePicker-only.
        // Cast to timestamptz and compare directly rather than falling through to `asText`:
        // `timestamptz::text` renders as `2026-08-06 01:18:19.491+00` (space, `+00`, no `Z`), which
        // an ISO string can never equal — measured live, 0 rows with no error. Comparing as
        // timestamptz instead makes both sides parse the same instant.
        return sql<SqlBool>`${col} = ${value}::timestamptz`;
      }
      return sql<SqlBool>`${asText} = ${value}`;
    }
    case "ne": {
      // Coalesce-to-'' matches the client's `String(value ?? "") !== target`, which counts a
      // NULL row as a mismatch (and therefore included by `ne`). A plain `<> value` would drop it.
      const value = String(rule.value);
      if (spec.type === "date") {
        if (isDateOnly(value)) {
          const day = value.trim();
          // Negation of the eq day-range above, with the same NULL-is-a-mismatch rule.
          return sql<SqlBool>`(${col} is null or ${col} < ${day}::timestamptz or ${col} >= (${day}::timestamptz + interval '1 day'))`;
        }
        // Same full-timestamp reasoning as "eq" above, negated with the NULL-is-a-mismatch rule.
        return sql<SqlBool>`(${col} is null or ${col} <> ${value}::timestamptz)`;
      }
      return sql<SqlBool>`${asText} <> ${value}`;
    }
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
      //
      // Date columns: the lower bound already works unmodified — a date-only `lo` compared with
      // `>=` already means "from the start of that day". Only the upper bound needs adjusting:
      // a plain `<= hi` on a date-only `hi` stops at that day's midnight, excluding almost all of
      // the end day. Expand a date-only `hi` to "less than the start of the following day" so the
      // end day is included in full. A full-timestamp `hi` is honoured exactly, unchanged.
      //
      // Same TimeZone-resolution ASSUMPTION as "eq"'s day-range branch above: `hiDay::timestamptz`
      // resolves in the connection's TimeZone, not necessarily UTC. See that comment.
      if (spec.type === "date" && isDateOnly(hi)) {
        const hiDay = hi.trim();
        return sql<SqlBool>`(${col} >= ${lo} and ${col} < (${hiDay}::timestamptz + interval '1 day'))`;
      }
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
    //
    // Text ordering must not depend on the database's default collation. postgres:16-alpine is
    // musl-based, so `en_US.utf8` silently falls back to byte order and 'BETA' sorts before
    // 'alpha'; a glibc or managed-cloud Postgres would order it differently again. An explicit
    // ICU collation makes the order a property of the query, and matches applyTableState's
    // String.localeCompare. Only text-ish columns are collatable — COLLATE on an integer or
    // timestamp is a Postgres error.
    const collatable = spec.type === "text" || spec.type === "enum";
    const target = collatable ? sql`${sql.ref(spec.sql)} collate "en-US-x-icu"` : sql.ref(spec.sql);
    out = out.orderBy(target, (ob: OrderByItemBuilder) =>
      s.ascending ? ob.asc().nullsFirst() : ob.desc().nullsLast(),
    );
  }
  const tb = getColumn(columns, tiebreaker);
  // A silently-skipped tiebreaker is worse than a missing sort: it reintroduces the exact
  // ORDER BY + OFFSET instability this function exists to prevent, without any visible symptom
  // until pages start repeating or skipping rows. Fail loud instead.
  if (!tb) throw new Error(`unknown tiebreaker column "${tiebreaker}"`);
  // Deliberately no COLLATE here, unlike the user-facing sort columns above. The tiebreaker only
  // exists to make row order deterministic across pages — nobody reads its order, so a
  // locale-aware order buys nothing. Collating it would cost something real: it forces
  // COLLATE onto every text-typed tiebreaker (id columns are almost always text), which pg-mem's
  // parser cannot parse at all (hard syntax error, not a semantic gap), breaking offline coverage
  // for every current and future consumer. Plain byte order is enough for determinism.
  out = out.orderBy(sql.ref(tb.sql), "asc");
  return out;
}
