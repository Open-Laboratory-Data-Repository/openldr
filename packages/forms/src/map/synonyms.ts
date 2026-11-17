import synonymsEn from './synonyms.en.json';
import synonymsFr from './synonyms.fr.json';
import synonymsPt from './synonyms.pt.json';

/**
 * Column names a lab's file might use for each target field, keyed by target path key. Content,
 * not code: column names only, never a clinical code. `suggest` reads them.
 */

const LISTS: Record<string, Record<string, string[]>> = { en: synonymsEn, fr: synonymsFr, pt: synonymsPt };

/**
 * The locale's list, then the English names. A French or Portuguese lab's file often has English
 * headers. An unknown locale gives English. Each call returns new lists.
 */
export function mapSynonyms(locale: string): Record<string, string[]> {
  const en = LISTS.en;
  const own = locale === 'en' ? {} : (LISTS[locale] ?? {});
  const out: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(own), ...Object.keys(en)])) {
    out[key] = [...new Set([...(own[key] ?? []), ...(en[key] ?? [])])];
  }
  return out;
}
