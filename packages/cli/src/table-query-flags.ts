import { parseTableQuery, type ParseResult, type ParsedSort, type TableColumnMap } from "@openldr/table-query";

interface WhereFlagRule {
  column: string;
  operator: string;
  value: string;
  combine: "and";
}

/**
 * Turn CLI flags into the same validated rules the HTTP route produces.
 *
 * Both surfaces end at parseTableQuery, so an unknown column or a disallowed operator fails
 * identically whether the operator used the studio or a headless shell (AGENTS.md §6).
 *
 * `--where column:operator:value` — only the FIRST TWO colons are delimiters, so values may
 * contain colons (entityIds and URLs routinely do).
 * `--sort column` / `--sort -column` — a leading dash means descending.
 */
export function parseWhereFlags(
  where: string[],
  sort: string[],
  columns: TableColumnMap,
): ParseResult {
  const filters: WhereFlagRule[] = [];
  for (const raw of where) {
    const first = raw.indexOf(":");
    const second = raw.indexOf(":", first + 1);
    if (first < 1 || second < 0) {
      return { ok: false, error: `--where "${raw}" must be column:operator:value` };
    }
    filters.push({
      column: raw.slice(0, first),
      operator: raw.slice(first + 1, second),
      value: raw.slice(second + 1),
      combine: "and",
    });
  }
  const sorts: ParsedSort[] = sort.map((s) =>
    s.startsWith("-") ? { column: s.slice(1), ascending: false } : { column: s, ascending: true },
  );
  return parseTableQuery({ filters: JSON.stringify(filters), sorts: JSON.stringify(sorts) }, columns);
}
