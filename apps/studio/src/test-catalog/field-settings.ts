import type { CatalogFieldSettings, CatalogResultBand, CatalogResultType, CatalogTestResultParam } from '@/api';

// The pure rules for a result field's settings, its place in the list and a range's plan B fields
// (plan B calls 8 and 9). Each setting is written only when set, so a test saved before them reads
// back unchanged. The same lists as TYPE_SETTINGS in @openldr/bootstrap's result-params.ts.

export type TypeSetting = 'min' | 'max' | 'decimals' | 'minLength' | 'maxLength' | 'dateLimit';
const ALL_SETTINGS: readonly TypeSetting[] = ['min', 'max', 'decimals', 'minLength', 'maxLength', 'dateLimit'];
const SETTINGS_OF: Partial<Record<CatalogResultType, readonly TypeSetting[]>> = {
  numeric: ['min', 'max', 'decimals'],
  text: ['minLength', 'maxLength'],
  date: ['dateLimit'],
};

/** The settings a type may carry. The server refuses any other. */
export function settingsOf(type: CatalogResultType): readonly TypeSetting[] {
  return SETTINGS_OF[type] ?? [];
}

/** A new type for the param. Ranges stay only on a numeric field, and settings of another type go. */
export function changeType(param: CatalogTestResultParam, type: CatalogResultType): CatalogTestResultParam {
  const next: CatalogTestResultParam = { ...param, resultType: type, bands: type === 'numeric' ? param.bands : [] };
  const own = settingsOf(type);
  for (const key of ALL_SETTINGS) if (!own.includes(key)) delete next[key];
  return next;
}

/** Write the type's settings. A blank one, and the date limit "any", are left out. */
export function withSettings(param: CatalogTestResultParam, values: CatalogFieldSettings): CatalogTestResultParam {
  const next: CatalogTestResultParam = { ...param };
  for (const key of settingsOf(param.resultType)) {
    const v = values[key];
    if (v === null || v === undefined || (key === 'dateLimit' && v === 'any')) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = v;
  }
  return next;
}

/** Required is stored only when false, so a saved test keeps today's behaviour. */
export function setRequired(param: CatalogTestResultParam, on: boolean): CatalogTestResultParam {
  const next: CatalogTestResultParam = { ...param };
  if (on) delete next.required; else next.required = false;
  return next;
}

/** Move one ticked param up (-1) or down (1). At an end it stays. */
export function moveParam(list: CatalogTestResultParam[], code: string, by: -1 | 1): CatalogTestResultParam[] {
  const i = list.findIndex((p) => p.code === code);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** The fields as drawn (call 8): the ticked ones in the test's order, then the unticked ones. */
export function fieldsInOrder<T extends { code: string }>(options: T[], params: CatalogTestResultParam[]): T[] {
  const ticked = params.flatMap((p) => options.filter((o) => o.code === p.code).slice(0, 1));
  return [...ticked, ...options.filter((o) => !params.some((p) => p.code === o.code))];
}

type BandExtra = 'pregnancy' | 'country' | 'validFrom' | 'validTo' | 'source' | 'scope';

/** Set or clear one of a range's plan B fields. Cleared means the key is left out. */
export function withBandField<K extends BandExtra>(band: CatalogResultBand, key: K, value: CatalogResultBand[K] | null): CatalogResultBand {
  const next: CatalogResultBand = { ...band };
  if (value === null || value === undefined || value === '') delete next[key];
  else next[key] = value;
  return next;
}
