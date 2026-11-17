import {
  MapRuleSchema,
  SavedMappingSchema,
  shapeOf,
  type FieldMapping,
  type MapRule,
  type MapTarget,
  type SavedMapping,
} from '@openldr/forms/pure';

/**
 * Pure helpers for the Map to FHIR sheet: sample rows, shapes, and the row drafts the person edits.
 * Sample values live only in the sheet's React state. Nothing here writes them anywhere, and
 * `buildMapping` takes no sample, so a saved mapping cannot carry one.
 */

/** The Test route's limit, and so the most sample rows the sheet keeps. */
export const MAX_SAMPLE_ROWS = 20;

/** How many characters of a sample value the Example column shows. */
export const EXAMPLE_MAX = 40;

export type SampleRow = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isResource(v: unknown): boolean {
  return isObject(v) && typeof v.resourceType === 'string';
}

/** The engine's own `readPath`: a dotted path, a leading dot ignored, blank for the value itself. */
export function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const seg of path.replace(/^\./, '').split('.').filter(Boolean)) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Items as the editor holds them (a list of `{ json }`), or a bare value, as a list of jsons. */
function itemJsons(raw: unknown): unknown[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return list.map((i) => (isObject(i) && 'json' in i ? i.json : i));
}

/**
 * Turn raw items into sample rows the way the node does: apply `sourcePath`, an object is one row,
 * a list of plain objects is one row each. FHIR (an object or a list with `resourceType`) and
 * scalars are not rows. At most `MAX_SAMPLE_ROWS`.
 */
export function rowsFromItems(raw: unknown, sourcePath: string): SampleRow[] {
  const rows: SampleRow[] = [];
  for (const json of itemJsons(raw)) {
    const v = readPath(json, sourcePath.trim());
    if (isObject(v)) {
      if (!isResource(v)) rows.push(v);
    } else if (Array.isArray(v) && !(v.length > 0 && v.every(isResource))) {
      for (const el of v) if (isObject(el) && !isResource(el)) rows.push(el);
    }
  }
  return rows.slice(0, MAX_SAMPLE_ROWS);
}

export interface ShapeGroup {
  hash: string;
  fieldNames: string[];
  rows: SampleRow[];
}

/** Rows grouped by `shapeOf(row).hash`, in first-seen order. */
export function groupByShape(rows: SampleRow[]): ShapeGroup[] {
  const groups = new Map<string, ShapeGroup>();
  for (const row of rows) {
    const shape = shapeOf(row);
    const g = groups.get(shape.hash);
    if (g) g.rows.push(row);
    else groups.set(shape.hash, { hash: shape.hash, fieldNames: shape.fields.map((f) => f.name), rows: [row] });
  }
  return [...groups.values()];
}

/** A sample value as text for the Example column, cut to `EXAMPLE_MAX` characters. */
export function exampleText(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > EXAMPLE_MAX ? `${text.slice(0, EXAMPLE_MAX - 1)}…` : text;
}

export type SourceDraft =
  | { kind: 'none' }
  | { kind: 'field'; fields: string[] }
  | { kind: 'fixed'; value: string };

export type SplitTake = 'first' | 'last' | 'part';

export type RuleDraft =
  | { kind: 'none' }
  | { kind: 'date'; format: string }
  | { kind: 'values'; pairs: { from: string; to: string }[] }
  | { kind: 'codeList'; conceptMapUrl: string; sourceSystem: string }
  | { kind: 'split'; by: string; take: SplitTake; part: string }
  | { kind: 'trim' }
  | { kind: 'number'; decimal: ',' | '.' };

export type RuleKind = RuleDraft['kind'];
export const RULE_KINDS: RuleKind[] = ['none', 'date', 'values', 'codeList', 'split', 'trim', 'number'];

export interface RowDraft {
  targetPath: string;
  /** The target's label for this field, or the FHIR path for a row the person added. */
  label: string;
  required: boolean;
  repeats: boolean;
  valueSet: string | null;
  /** True for a row from "Add a FHIR path". */
  added: boolean;
  source: SourceDraft;
  rule: RuleDraft;
}

export function emptyRule(kind: RuleKind): RuleDraft {
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'date':
      return { kind: 'date', format: '' };
    case 'values':
      return { kind: 'values', pairs: [{ from: '', to: '' }] };
    case 'codeList':
      return { kind: 'codeList', conceptMapUrl: '', sourceSystem: '' };
    case 'split':
      return { kind: 'split', by: ' ', take: 'first', part: '1' };
    case 'trim':
      return { kind: 'trim' };
    case 'number':
      return { kind: 'number', decimal: '.' };
  }
}

function ruleDraftOf(rule: MapRule | undefined): RuleDraft {
  if (!rule) return { kind: 'none' };
  switch (rule.kind) {
    case 'date':
      return { kind: 'date', format: rule.format };
    case 'values':
      return { kind: 'values', pairs: Object.entries(rule.map).map(([from, to]) => ({ from, to })) };
    case 'codeList':
      return { kind: 'codeList', conceptMapUrl: rule.conceptMapUrl, sourceSystem: rule.sourceSystem ?? '' };
    case 'split':
      return typeof rule.take === 'number'
        ? { kind: 'split', by: rule.by, take: 'part', part: String(rule.take + 1) }
        : { kind: 'split', by: rule.by, take: rule.take, part: '1' };
    case 'trim':
      return { kind: 'trim' };
    case 'number':
      return { kind: 'number', decimal: rule.decimal };
  }
}

function sourceDraftOf(from: FieldMapping['from']): SourceDraft {
  if ('fixed' in from) return { kind: 'fixed', value: from.fixed };
  if ('fields' in from) return { kind: 'field', fields: [...from.fields] };
  return { kind: 'field', fields: [from.field] };
}

/** One draft per target field in the target's order, filled from a saved mapping when there is one. */
export function draftsFor(target: MapTarget, saved: SavedMapping | null): RowDraft[] {
  const byPath = new Map((saved?.rows ?? []).map((r) => [r.targetPath, r]));
  const rows: RowDraft[] = target.fields.map((f) => {
    const s = byPath.get(f.path);
    return {
      targetPath: f.path,
      label: f.label,
      required: f.required,
      repeats: f.repeats,
      valueSet: f.valueSet,
      added: false,
      source: s ? sourceDraftOf(s.from) : { kind: 'none' },
      rule: ruleDraftOf(s?.rule),
    };
  });
  const known = new Set(target.fields.map((f) => f.path));
  for (const s of saved?.rows ?? []) {
    if (known.has(s.targetPath)) continue;
    rows.push({
      targetPath: s.targetPath,
      label: s.targetPath,
      required: false,
      repeats: false,
      valueSet: null,
      added: true,
      source: sourceDraftOf(s.from),
      rule: ruleDraftOf(s.rule),
    });
  }
  return rows;
}

/** Whether a draft has a source: a column, or a fixed value that is not blank. */
export function hasSource(d: RowDraft): boolean {
  if (d.source.kind === 'field') return d.source.fields.length > 0;
  if (d.source.kind === 'fixed') return d.source.value.trim() !== '';
  return false;
}

/** The rule a draft gives, null for none, or 'incomplete' when its inputs do not make a rule yet. */
export function ruleOf(rule: RuleDraft): MapRule | null | 'incomplete' {
  let candidate: unknown;
  switch (rule.kind) {
    case 'none':
      return null;
    case 'date':
      candidate = { kind: 'date', format: rule.format.trim() };
      break;
    case 'values': {
      const map: Record<string, string> = {};
      for (const p of rule.pairs) if (p.from.trim() !== '') map[p.from.trim()] = p.to;
      if (Object.keys(map).length === 0) return 'incomplete';
      candidate = { kind: 'values', map };
      break;
    }
    case 'codeList':
      candidate = {
        kind: 'codeList',
        conceptMapUrl: rule.conceptMapUrl,
        ...(rule.sourceSystem.trim() ? { sourceSystem: rule.sourceSystem.trim() } : {}),
      };
      break;
    case 'split': {
      let take: 'first' | 'last' | number = rule.take === 'part' ? NaN : rule.take;
      if (rule.take === 'part') {
        const n = Number(rule.part);
        take = Number.isInteger(n) && n >= 1 ? n - 1 : NaN;
      }
      candidate = { kind: 'split', by: rule.by, take };
      break;
    }
    case 'trim':
      candidate = { kind: 'trim' };
      break;
    case 'number':
      candidate = { kind: 'number', decimal: rule.decimal };
      break;
  }
  const parsed = MapRuleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : 'incomplete';
}

export type BuildResult =
  | { ok: true; mapping: SavedMapping }
  | { ok: false; problem: 'required' | 'rule'; label: string };

/**
 * The saved mapping for one shape from the drafts. Rows with no source are left out. With
 * `requireAll`, a required row with no source refuses. A rule whose inputs are not finished
 * always refuses. It takes no sample, so no sample value can reach it.
 */
export function buildMapping(
  drafts: RowDraft[],
  shape: { hash: string; fieldNames: string[] },
  targetId: string,
  opts: { requireAll: boolean },
): BuildResult {
  if (opts.requireAll) {
    const missing = drafts.find((d) => d.required && !hasSource(d));
    if (missing) return { ok: false, problem: 'required', label: missing.label };
  }
  const rows: FieldMapping[] = [];
  for (const d of drafts) {
    if (!hasSource(d)) continue;
    const rule = ruleOf(d.rule);
    if (rule === 'incomplete') return { ok: false, problem: 'rule', label: d.label };
    let from: FieldMapping['from'];
    if (d.source.kind === 'fixed') from = { fixed: d.source.value };
    else if (d.source.kind === 'field' && d.source.fields.length > 1) from = { fields: [...d.source.fields] };
    else if (d.source.kind === 'field') from = { field: d.source.fields[0] };
    else continue;
    rows.push(rule ? { targetPath: d.targetPath, from, rule } : { targetPath: d.targetPath, from });
  }
  const mapping = SavedMappingSchema.parse({ shapeHash: shape.hash, fieldNames: [...shape.fieldNames], targetId, rows });
  return { ok: true, mapping };
}

/** The saved mappings as a list, read from config without trusting it. */
export function savedMappingsOf(config: Record<string, unknown>): SavedMapping[] {
  const raw = Array.isArray(config.mappings) ? config.mappings : [];
  const out: SavedMapping[] = [];
  for (const m of raw) {
    const parsed = SavedMappingSchema.safeParse(m);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** The node's mappings with `mapping` put in place of any with the same shape hash. */
export function withMapping(existing: unknown[], mapping: SavedMapping): unknown[] {
  const rest = existing.filter((m) => !(isObject(m) && m.shapeHash === mapping.shapeHash));
  return [...rest, mapping];
}

/** Field names that no draft reads. */
export function unusedFields(fieldNames: string[], drafts: RowDraft[]): string[] {
  const used = new Set<string>();
  for (const d of drafts) if (d.source.kind === 'field') d.source.fields.forEach((f) => used.add(f));
  return fieldNames.filter((f) => !used.has(f));
}
