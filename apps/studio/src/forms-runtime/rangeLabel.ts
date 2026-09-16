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
}

export const RANGE_EN: Required<RangeCopy> = {
  language: 'en',
  range: 'Range',
  chooseRange: 'Choose a range',
  misfit: 'This range is for {label}',
  anyone: 'Default',
  ageFrom: '{from}+',
  ageTo: 'up to {to}',
  ageBetween: '{from} to {to}',
};

/** The server's label in this language, then its base language, then English, then the code. */
export function sexLabel(option: CatalogSexOption, language: string): string {
  return option.labels[language] ?? option.labels[language.split('-')[0]] ?? option.labels.en ?? option.code;
}

/** Who a range is for, from its sex and age, such as "Female 15+". Ignores the name. */
export function criteriaLabel(band: CatalogResultBand, sexes: CatalogSexOption[], copy: RangeCopy): string {
  const c = { ...RANGE_EN, ...copy };
  const option = band.sex ? sexes.find((s) => s.code === band.sex) : undefined;
  const sex = band.sex ? (option ? sexLabel(option, c.language) : band.sex) : null;
  const age = band.ageLow !== null && band.ageHigh !== null
    ? c.ageBetween.replace('{from}', String(band.ageLow)).replace('{to}', String(band.ageHigh))
    : band.ageLow !== null ? c.ageFrom.replace('{from}', String(band.ageLow))
      : band.ageHigh !== null ? c.ageTo.replace('{to}', String(band.ageHigh)) : null;
  return [sex, age].filter(Boolean).join(' ') || c.anyone;
}

/** What the picker shows: the range's name, or who it is for when it has none. */
export function rangeLabel(band: CatalogResultBand, sexes: CatalogSexOption[], copy: RangeCopy): string {
  return band.name ?? criteriaLabel(band, sexes, copy);
}
