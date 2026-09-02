import type { ReportDesign, DesignElement } from './schema';

/**
 * Printed translations: the authored text of a design, in the language a run asks for.
 *
 * ⛔ An OVERRIDE MAP, never a change to `text` itself. Replacing `text` with a per-language object
 * would rewrite every stored design and break every reader of the field; a side map means an
 * existing design keeps working untouched and a design with no map is byte-identical to before.
 *
 * ⛔ Resolved ONCE, before anything draws — the same shape `resolveGroups` uses. Downstream the
 * renderer sees an ordinary design whose text happens to be French, so no drawing code knows
 * languages exist and none of them can disagree about a fallback.
 *
 * ⛔ Fallback is the authored text, never blank. A partial translation must print a readable page
 * in mixed languages rather than a page with holes in it: a missing word is a nuisance, a missing
 * heading is a defect.
 *
 * ⛔ DATA is never translated. Only text an author typed into the design. Query results, lab
 * identity and parameter values pass through untouched — a translated result would be a lie about
 * what the laboratory recorded.
 */

/** Element kinds whose `text` is PROSE and may be translated.
 *
 *  ⛔ `barcode` and `qrcode` are deliberately absent. Their `text` is the value that gets encoded,
 *  so "translating" one produces a symbol that scans to the wrong identifier — worse than an
 *  untranslated label, because it is wrong silently and only at a bench. */
const TRANSLATABLE_KINDS = new Set<DesignElement['kind']>(['text', 'datetime', 'keyvalue']);

/** The i18n key for one bound column's label. Element ids are unique per design and column keys
 *  are unique per element, so this addresses exactly one label. */
export function i18nKeyForColumn(elementId: string, columnKey: string): string {
  return `${elementId}.col.${columnKey}`;
}

/** The i18n key for one half of one STATIC keyvalue pair, addressed by position.
 *
 *  Static rows carry the scope panel on every seeded design, and they are not a legacy shape: a
 *  BOUND panel's value is deliberately never interpolated, so an unbound pair is the only pair
 *  that can hold `{{param.*}}` or `{{date}}` (see `interpolatedPairValues` in render/draw.ts, and
 *  `simple-design.ts:124`). They cannot be rewritten as bound columns, so they get keys of their
 *  own.
 *
 *  Positional because a static row has no key of its own, and nothing in the studio reorders one.
 *  A row that later moves takes its neighbour's translation, the same way a renamed column key
 *  orphans a `.col.` entry — recoverable by retyping, and never a wrong-language mix, because the
 *  authored text is what shows when an entry is missing.
 *
 *  Both halves are translatable. A value holding a token is NOT special-cased: interpolation runs
 *  after resolution, so a French override can keep the tokens and reorder the words around them
 *  ("du {{param.from}} au {{param.to}}"), exactly as an authored text element already can. */
export function i18nKeyForPair(elementId: string, index: number, part: 'label' | 'value'): string {
  return `${elementId}.kv.${index}.${part}`;
}

/** The design as it should PRINT in `lang`. Returns the input untouched when there is nothing to
 *  apply, so the common single-language case allocates nothing. */
export function resolveI18n(design: ReportDesign, lang: string | undefined): ReportDesign {
  const dict = lang ? design.i18n?.[lang] : undefined;
  if (!dict || Object.keys(dict).length === 0) return design;

  let changed = false;
  const pages = design.pages.map((page) => {
    let pageChanged = false;
    const elements = page.elements.map((el) => {
      const text = TRANSLATABLE_KINDS.has(el.kind) ? dict[el.id] : undefined;
      const cols = el.boundColumns?.map((c) => {
        const label = dict[i18nKeyForColumn(el.id, c.key)];
        return label === undefined ? c : { ...c, label };
      });
      const colsChanged = Boolean(cols && el.boundColumns && cols.some((c, i) => c !== el.boundColumns![i]));
      // Static pairs, on a keyvalue panel only. A `rows` array on any other kind is sample data the
      // renderer replaces with the query's own rows, so translating it would put authored text
      // where data belongs.
      const rows = el.kind === 'keyvalue'
        ? el.rows?.map((r, i) => {
          const label = dict[i18nKeyForPair(el.id, i, 'label')];
          const value = dict[i18nKeyForPair(el.id, i, 'value')];
          if (label === undefined && value === undefined) return r;
          return [label ?? r[0], value ?? r[1]] as typeof r;
        })
        : undefined;
      const rowsChanged = Boolean(rows && el.rows && rows.some((r, i) => r !== el.rows![i]));
      if (text === undefined && !colsChanged && !rowsChanged) return el;
      pageChanged = true;
      return {
        ...el,
        ...(text === undefined ? {} : { text }),
        ...(colsChanged ? { boundColumns: cols } : {}),
        ...(rowsChanged ? { rows } : {}),
      };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? { ...design, pages } : design;
}
