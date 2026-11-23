import type { CatalogResultBand, CatalogSexOption } from '@/api';

/** Words for a range. The form runtime has no i18n, so the capture page fills these (see TestDetailsField). */
export interface RangeCopy {
  /** The page language, such as "fr". Picks the server's sex label. */
  language?: string;
  range?: string;
  chooseRange?: string;
  /** "{label}" is replaced with who the range is for. */
  misfit?: string;
  anyone?: string;
  ageFrom?: string;
  ageTo?: string;
  ageBetween?: string;
  ageFromDays?: string;
  ageToDays?: string;
  ageBetweenDays?: string;
  ageFromMonths?: string;
  ageToMonths?: string;
  ageBetweenMonths?: string;
}

export const RANGE_EN: Required<RangeCopy> = {
  language: 'en',
  range: 'Range',
  chooseRange: 'Choose a range',
  misfit: 'This range is for {label}',
  anyone: 'Default',
  ageFrom: '{from}+ years',
  ageTo: 'up to {to} years',
  ageBetween: '{from} to {to} years',
  ageFromDays: '{from}+ days',
  ageToDays: 'up to {to} days',
  ageBetweenDays: '{from} to {to} days',
  ageFromMonths: '{from}+ months',
  ageToMonths: 'up to {to} months',
  ageBetweenMonths: '{from} to {to} months',
};

/** The age words for a band's unit. A band with no unit is in years. */
function ageWords(c: Required<RangeCopy>, unit: CatalogResultBand['ageUnit']): { from: string; to: string; between: string } {
  if (unit === 'd') return { from: c.ageFromDays, to: c.ageToDays, between: c.ageBetweenDays };
  if (unit === 'mo') return { from: c.ageFromMonths, to: c.ageToMonths, between: c.ageBetweenMonths };
  return { from: c.ageFrom, to: c.ageTo, between: c.ageBetween };
}

/** The server's label in this language, then its base language, then English, then the code. */
export function sexLabel(option: CatalogSexOption, language: string): string {
  return option.labels[language] ?? option.labels[language.split('-')[0]] ?? option.labels.en ?? option.code;
}

/** Who a range is for, from its sex and age in its unit, such as "Female 15+" or "up to 28 days". Ignores the name. */
export function criteriaLabel(band: CatalogResultBand, sexes: CatalogSexOption[], copy: RangeCopy): string {
  const c = { ...RANGE_EN, ...copy };
  const option = band.sex ? sexes.find((s) => s.code === band.sex) : undefined;
  const sex = band.sex ? (option ? sexLabel(option, c.language) : band.sex) : null;
  const w = ageWords(c, band.ageUnit);
  const age = band.ageLow !== null && band.ageHigh !== null
    ? w.between.replace('{from}', String(band.ageLow)).replace('{to}', String(band.ageHigh))
    : band.ageLow !== null ? w.from.replace('{from}', String(band.ageLow))
      : band.ageHigh !== null ? w.to.replace('{to}', String(band.ageHigh)) : null;
  return [sex, age].filter(Boolean).join(' ') || c.anyone;
}

/** What the picker shows: the range's name, or who it is for when it has none. */
export function rangeLabel(band: CatalogResultBand, sexes: CatalogSexOption[], copy: RangeCopy): string {
  return band.name ?? criteriaLabel(band, sexes, copy);
}
