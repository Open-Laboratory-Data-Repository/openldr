import type { CatalogFieldSettings } from '@/api';

/**
 * Words for the bench's result entry beyond ranges (plan B, Task 3). The form runtime has no i18n, so
 * the capture page fills these (see TestDetailsField). "{min}", "{max}" and "{n}" are numbers.
 */
export interface EntryCopy {
  optional?: string;
  limitBetween?: string;
  limitMin?: string;
  limitMax?: string;
  decimals?: string;
  lengthBetween?: string;
  lengthMin?: string;
  lengthMax?: string;
  pastOnly?: string;
  futureOnly?: string;
  yes?: string;
  no?: string;
  notAnswered?: string;
  chooseDate?: string;
  chooseResult?: string;
  addAnswer?: string;
  /** "{label}" is the answer's name. */
  removeAnswer?: string;
}

export const ENTRY_EN: Required<EntryCopy> = {
  optional: 'Optional',
  limitBetween: 'Allowed {min} to {max}',
  limitMin: 'Allowed {min} or more',
  limitMax: 'Allowed up to {max}',
  decimals: 'decimal places: {n}',
  lengthBetween: '{min} to {max} characters',
  lengthMin: 'At least {min} characters',
  lengthMax: 'Up to {max} characters',
  pastOnly: 'Past dates only',
  futureOnly: 'Future dates only',
  yes: 'Yes',
  no: 'No',
  notAnswered: 'Not answered',
  chooseDate: 'Pick a date',
  chooseResult: 'Choose a result',
  addAnswer: 'Add a result',
  removeAnswer: 'Remove {label}',
};

const has = (n: number | null | undefined): n is number => typeof n === 'number';

/**
 * What the bench shows under a field: "Optional" when it is not required, then its entry limits.
 * The bench never refuses a value outside them (plan B, call 5); the lab plugin does.
 */
export function fieldHint(param: CatalogFieldSettings & { resultType: string }, copy: Required<EntryCopy>): string | null {
  const parts: string[] = [];
  if (param.required === false) parts.push(copy.optional);
  if (param.resultType === 'numeric') {
    const limit = has(param.min) && has(param.max)
      ? copy.limitBetween.replace('{min}', String(param.min)).replace('{max}', String(param.max))
      : has(param.min) ? copy.limitMin.replace('{min}', String(param.min))
        : has(param.max) ? copy.limitMax.replace('{max}', String(param.max)) : null;
    const decimals = has(param.decimals) ? copy.decimals.replace('{n}', String(param.decimals)) : null;
    const both = [limit, decimals].filter(Boolean).join(', ');
    if (both) parts.push(both);
  }
  if (param.resultType === 'text') {
    const { minLength: lo, maxLength: hi } = param;
    const length = has(lo) && has(hi)
      ? copy.lengthBetween.replace('{min}', String(lo)).replace('{max}', String(hi))
      : has(lo) ? copy.lengthMin.replace('{min}', String(lo))
        : has(hi) ? copy.lengthMax.replace('{max}', String(hi)) : null;
    if (length) parts.push(length);
  }
  if (param.resultType === 'date') {
    if (param.dateLimit === 'past') parts.push(copy.pastOnly);
    if (param.dateLimit === 'future') parts.push(copy.futureOnly);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
