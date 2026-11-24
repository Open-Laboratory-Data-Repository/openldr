import type { AppSettingStore } from '@openldr/db';
import type { Operations } from '@openldr/terminology';
import { CONTROLLED_VALUE_SETS } from './facility-controlled-fields';
import {
  LAB_IDENTITY_FIELDS, LAB_IDENTITY_KEYS, toIdentityTokens, validateLabIdentityValue,
  type LabIdentity, type LabIdentityValidationError,
} from '@openldr/config';

export interface LabIdentityService {
  /** Raw stored values, namespaced (`lab.name` → value). Missing keys are absent. */
  all(): Promise<Record<string, string>>;
  /**
   * The identity as the RENDERER wants it — bare keys (`name`, `address`, …), empty values dropped.
   * This is what `renderReportDesignPdf`'s `identity` option takes.
   */
  tokens(): Promise<LabIdentity>;
  /** Writes only the supplied keys; `''` clears one. Returns validation errors WITHOUT writing. */
  set(patch: Record<string, string>, actor: string | null): Promise<LabIdentityValidationError[]>;
}

/**
 * The lab's time zone (`lab.timezone`), or undefined when none is set or the settings cannot be read.
 * It is read from `tokens()`, which strips the `lab.` prefix, so the key there is `timezone`.
 */
export async function labTimeZone(identity: Pick<LabIdentityService, 'tokens'> | null | undefined): Promise<string | undefined> {
  try {
    return (await identity?.tokens())?.timezone?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The lab's country (ISO 3166-1 alpha-3), or null when none is set or the settings cannot be read.
 * Read from `tokens()`, so the key is `country`. A reference range naming a country fits only this one
 * (test catalog plan B, call 2).
 */
export async function labCountry(identity: Pick<LabIdentityService, 'tokens'> | null | undefined): Promise<string | null> {
  try {
    return (await identity?.tokens())?.country?.trim() || null;
  } catch {
    return null;
  }
}

/** The codes in CE's country value set (migration 073), for `createLabIdentity`'s `countries`. */
export async function countryCodes(ops: Pick<Operations, 'expand'>): Promise<Set<string>> {
  const vs = await ops.expand(CONTROLLED_VALUE_SETS.country, { count: 100_000 });
  return new Set((vs.expansion?.contains ?? []).map((c) => c.code ?? '').filter((c) => c !== ''));
}

export interface LabIdentityOptions {
  /**
   * The codes `lab.country` may hold. When given, a country not in it is refused, and so is any
   * country while the list cannot be read. Without it only the shape (three capital letters) is
   * checked. Bootstrap always gives it.
   */
  countries?: () => Promise<Iterable<string>>;
}

export function createLabIdentity(store: AppSettingStore, opts: LabIdentityOptions = {}): LabIdentityService {
  async function all(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of LAB_IDENTITY_KEYS) {
      const row = await store.get(key);
      if (typeof row?.value === 'string' && row.value !== '') out[key] = row.value;
    }
    return out;
  }

  return {
    all,
    async tokens() { return toIdentityTokens(await all()); },
    async set(patch, actor) {
      // Validate the WHOLE patch before writing any of it: a half-applied letterhead (new name,
      // rejected logo) is worse than a rejected one, because the operator sees a success for the
      // part that landed and has to work out which half is live.
      const errors: LabIdentityValidationError[] = [];
      for (const [key, value] of Object.entries(patch)) {
        const err = validateLabIdentityValue(key, value);
        if (err) errors.push(err);
      }
      const country = patch['lab.country'];
      if (country && opts.countries && !errors.some((e) => e.key === 'lab.country')) {
        const known = await opts.countries().then((c) => new Set(c)).catch(() => new Set<string>());
        if (!known.has(country)) errors.push({ key: 'lab.country', reason: 'invalid-country' });
      }
      if (errors.length) return errors;

      for (const [key, value] of Object.entries(patch)) await store.set(key, value, actor);
      return [];
    },
  };
}

export { LAB_IDENTITY_FIELDS, LAB_IDENTITY_KEYS };
