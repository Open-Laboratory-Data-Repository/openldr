import type { BoundColumn, ReportDesign } from '@openldr/report-designer/pure';
import { paperSizePt } from '@openldr/report-designer';

/** Spec for a one-page report design bound to a single custom query: a letterhead, a scope panel
 *  describing the parameters the run was computed over, and one table projecting the query's
 *  result columns. Used by S4 to turn each migrated hardcoded report into a design a `reports`
 *  record can point at. */
export interface SimpleDesignSpec {
  id: string;
  name: string;
  queryId: string;
  columns: BoundColumn[];
  parameters: ReportDesign['parameters'];
  paper?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  /** Flip the result so the query's COLUMNS are the rows. For a matrix with a fixed, large column
   *  count and a small data-driven row count, the natural orientation cannot fit a page at ANY font
   *  because the cells set the floor: the antibiogram's 30 columns of `100% (12)` need ~840pt where
   *  landscape Letter has 696pt. `transposeLabel` heads the first column, which now holds the
   *  original column labels. A transposed design emits NO `boundColumns` — the headers come from
   *  the data (the organisms that cleared the isolate threshold), which a static design cannot know. */
  transpose?: boolean;
  transposeLabel?: string;
  /** One line stating what the table's numbers measure, e.g. "Percent resistant (%R)." Rendered as
   *  the last scope pair before `Generated`, because the metric IS part of the scope a run was
   *  computed under — and because the panel already sizes itself from its pair count, so this costs
   *  no layout arithmetic. Authored design DATA: a lab can edit it in the Report Designer. */
  metric?: string;
  /** One line explaining the table's notation — blanks, codes, abbreviations. Rendered directly
   *  under the table, next to the cells it explains. Authored design DATA, same as `metric`. */
  legend?: string;
}

/** `pairRects`'s KV_PAD_Y/KV_INLINE_H, raw POINTS (not px@96) — see the height comment below. */
const KV_INLINE_H_PT = 14;
const KV_PAD_Y_PT = 4;

/** The legend band's height, px@96 like every rect here — deliberately NOT a point constant.
 *  See the KV_*_PT comment below: mixing the two scales is what clipped a row once already. */
const LEGEND_H_PX = 18;

/**
 * The scope panel's pairs, generated from the spec's own declared parameters so each report
 * describes its own scope with no per-report authoring. `daterange` becomes a single
 * "Reporting period" pair from the FLAT `from`/`to` tokens (never `{{param.dateRange}}` — a
 * daterange's run values are flat, not nested under its own key); a `facility` parameter becomes
 * "Facility"; every other declared text/select parameter is keyed by its own label; and
 * "Generated" is always last.
 */
function scopePairs(spec: SimpleDesignSpec): [string, string][] {
  const pairs: [string, string][] = spec.parameters.map((p) => {
    if (p.type === 'daterange') return ['Reporting period', '{{param.from}} – {{param.to}}'];
    if (p.key === 'facility') return ['Facility', '{{param.facility}}'];
    return [p.label, `{{param.${p.key}}}`];
  });
  if (spec.metric) pairs.push(['Metric', spec.metric]);
  pairs.push(['Generated', '{{date}}']);
  return pairs;
}

/** Builds a one-page A4/Letter `ReportDesign` bound to `spec.queryId`, with the query's result
 *  columns projected onto the table via `boundColumns`. Deterministic element ids (derived from
 *  `spec.id`) so re-seeding never produces drift.
 *
 *  Every aggregate report shares one letterhead + scope-panel layout, mirroring `rt-clinical-micro`
 *  (which is authored as a literal because it is not one table on a page). Without this they read
 *  as unbranded printouts: a title, a "Generated" line and a table, with no logo, no laboratory
 *  name, no footer, and nothing recording the scope the numbers were computed over. */
export function simpleTableDesign(spec: SimpleDesignSpec): ReportDesign {
  const pairs = scopePairs(spec);
  // The panel's height is COMPUTED from its pair count, not fixed — this is what makes the
  // clipped-row trap impossible: `pairRects` flows pairs across then down at KV_INLINE_H from the
  // box top + KV_PAD_Y, and those constants are POINTS while `drawElement` converts the design
  // rect with `toPt` (×0.75) before calling it — so the height must be computed in points and
  // converted back to px@96, not computed in px@96 directly. A previous slice shipped a silently
  // clipped row by mixing the two scales while every (unit-blind) test stayed green.
  const rows = Math.ceil(pairs.length / 2);
  const panelHpx = Math.ceil((KV_PAD_Y_PT * 2 + rows * KV_INLINE_H_PT) / 0.75);
  const tableY = 138 + panelHpx + 12;

  // The page's own height in px@96. Two of the seeded designs are Letter/landscape (816px tall),
  // where an A4-portrait-hardcoded footer renders ~180px below the page edge and the table overruns
  // it. `paperSizePt` swaps the axes for landscape; PX_TO_PT is 0.75.
  const [pageWpt, pageHpt] = paperSizePt(spec.paper ?? 'A4', spec.orientation ?? 'portrait');
  const pageHpx = pageHpt / 0.75;
  // Body width follows the page. `Math.max(700, ...)` deliberately floors it at the historical
  // A4-portrait 700 so that layout is byte-identical (A4 portrait is 794px, i.e. 698 usable -- two
  // pixels narrower, which would churn every design for nothing). A landscape Letter sheet is
  // 1056px, so this recovers ~260px the body was leaving empty -- which is what gives a transposed
  // antibiogram room for organism columns as more of them clear the isolate threshold.
  const contentW = Math.max(700, Math.round(pageWpt / 0.75) - 96);
  // Keeps the same visual proportions the A4-portrait layout already had: its footer rule sat
  // 122.5px above the page bottom (1122.52 - 1000 = 122.52, rounded).
  const footRuleY = pageHpx - 122.5;
  const footTextY = footRuleY + 12;
  // The legend sits in the band immediately above the footer rule, and the table gives up exactly
  // that band. Both terms are px@96.
  const legendH = spec.legend ? LEGEND_H_PX : 0;
  const legendY = footRuleY - legendH;

  return {
    id: spec.id,
    name: spec.name,
    // Every built-in ships published — the seed loop stamps this explicitly on both the create
    // and update path anyway (capture is gated on published status), but the literal here should
    // say what these designs actually are rather than default to 'draft' and rely on the seed to
    // override it silently.
    status: 'published',
    paper: spec.paper ?? 'A4',
    orientation: spec.orientation ?? 'portrait',
    parameters: spec.parameters,
    pages: [
      {
        id: `${spec.id}-p1`,
        elements: [
          // Band 1 — the letterhead. Every value comes from Settings ▸ Laboratory via `{{lab.*}}`;
          // an install that has not configured its identity renders these BLANK rather than
          // printing the token, so the design stays valid out of the box.
          { id: `${spec.id}-logo`, kind: 'image', name: 'Lab logo', rect: { x: 48, y: 28, w: 54, h: 54 }, src: '{{lab.logo}}' },
          { id: `${spec.id}-labname`, kind: 'text', name: 'Lab name', rect: { x: 112, y: 30, w: 430, h: 18 }, text: '{{lab.name}}', style: { fontSize: 13, bold: true, color: '#0f172a' } },
          { id: `${spec.id}-labaddr`, kind: 'text', name: 'Lab address', rect: { x: 112, y: 48, w: 430, h: 22 }, text: '{{lab.address}}', style: { fontSize: 7.5, color: '#64748b' } },
          { id: `${spec.id}-labcontact`, kind: 'text', name: 'Lab contact', rect: { x: 112, y: 71, w: 430, h: 13 }, text: '{{lab.contact}}', style: { fontSize: 7.5, color: '#64748b' } },
          { id: `${spec.id}-rule1`, kind: 'line', name: 'rule1', rect: { x: 48, y: 92, w: contentW, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
          { id: `${spec.id}-title`, kind: 'text', name: 'Title', rect: { x: 48, y: 102, w: 600, h: 28 }, text: spec.name, style: { fontSize: 18, bold: true } },
          // Band 2 — the scope panel: what this run's numbers were computed over, and when they
          // were generated. UNBOUND (`rows`, not `dataSource`) — a bound keyvalue value is
          // deliberately NOT interpolated, so only an unbound pair can carry `{{param.*}}`/`{{date}}`.
          {
            id: `${spec.id}-meta`, kind: 'keyvalue', name: 'Scope', rect: { x: 48, y: 138, w: contentW, h: panelHpx },
            layout: 'inline', panelColumns: 2, rows: pairs,
          },
          {
            id: `${spec.id}-table`, kind: 'table', name: 'Data', rect: { x: 48, y: tableY, w: contentW, h: footRuleY - tableY - 8 - legendH },
            dataSource: { kind: 'custom-query', queryId: spec.queryId },
            // ⛔ A transposed table emits NO boundColumns: its headers are the organisms that
            // cleared the isolate threshold, which a static design cannot enumerate. The renderer
            // falls back to the resolved columns, which `transpose` has already flipped.
            ...(spec.transpose
              ? { transpose: true, transposeLabel: spec.transposeLabel ?? '' }
              : { boundColumns: spec.columns }),
          },
          ...(spec.legend
            ? [{
                id: `${spec.id}-legend`, kind: 'text' as const, name: 'Legend',
                rect: { x: 48, y: legendY, w: contentW, h: LEGEND_H_PX },
                text: spec.legend, style: { fontSize: 8, color: '#475569' },
              }]
            : []),
          { id: `${spec.id}-rule2`, kind: 'line', name: 'rule2', rect: { x: 48, y: footRuleY, w: contentW, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
          { id: `${spec.id}-foot`, kind: 'text', name: 'Footer', rect: { x: 48, y: footTextY, w: 500, h: 16 }, text: 'Generated by OpenLDR — figures reflect data available at time of generation.', style: { fontSize: 7, color: '#94a3b8' } },
        ],
      },
    ],
    pageNumbers: true,
  };
}
