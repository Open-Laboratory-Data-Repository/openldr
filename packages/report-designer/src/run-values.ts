import type { ReportDesign } from './schema';

/**
 * A design's authored parameter values, shaped the way `substituteParams` reads them.
 *
 * ⛔ A `daterange` parameter is the whole reason this function exists. The design stores ONE
 * parameter (`dateRange`) whose value is `{from,to}`, but the seeded queries declare TWO plain
 * required text params, `from` and `to`, and `substituteParams`
 * (`packages/dashboards/src/custom-query-run.ts`) reads `values[p.id]` off the QUERY's params. Copy
 * the design's parameters under their own keys alone and `values.from` is never set, so every
 * preview of a date-range report threw `required parameter: from` and rendered the red per-table
 * placeholder instead of rows. The renderer's `paramMap` already flattens this way for
 * `{{param.from}}` text interpolation; this is the same contract for the QUERY side.
 *
 * ⚠ NOT the same job as bootstrap's `designDefaults`, and the two must not be "harmonised". That
 * one backfills an untouched optional filter during a RUN, where the `/reports` filter bar has
 * already supplied flat `from`/`to`, so it deliberately skips dateranges. This one serves the
 * PREVIEW/authoring path, where there is no filter bar and the authored default is the only value
 * there is.
 *
 * The nested value is kept as well as the flat keys: a query that declares its own `daterange`
 * param (what the Query workbench's RunParamsSheet builds) reads the nested shape, and the preview
 * route's contract already says extra unmapped values are harmless — `substituteParams` iterates
 * the QUERY's declared params and ignores every other key.
 *
 * Takes only `{ parameters }` so a caller holding the bare list (the Data tab's Load columns) uses
 * the same function as one holding a whole design.
 */
export function designRunValues(design: Pick<ReportDesign, 'parameters'>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of design.parameters) if (p.value != null) values[p.key] = p.value;

  // A parameter the author declared LITERALLY as `from`/`to` wins: it is the more specific
  // statement of intent, and clobbering it would silently ignore what they typed.
  const declared = new Set(design.parameters.map((p) => p.key));
  for (const p of design.parameters) {
    if (p.type !== 'daterange' || p.value == null || typeof p.value !== 'object') continue;
    const { from, to } = p.value as { from?: unknown; to?: unknown };
    // Empty strings are skipped rather than passed on: `substituteParams` reports a missing
    // required range as `required parameter: from`, which names the problem, where an empty string
    // reaches `assertDate` and reports `invalid date:` with nothing after the colon.
    if (from != null && from !== '' && !declared.has('from')) values.from = from;
    if (to != null && to !== '' && !declared.has('to')) values.to = to;
  }
  return values;
}
