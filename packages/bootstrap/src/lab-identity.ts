import type { AppSettingStore } from '@openldr/db';
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

export function createLabIdentity(store: AppSettingStore): LabIdentityService {
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
      if (errors.length) return errors;

      for (const [key, value] of Object.entries(patch)) await store.set(key, value, actor);
      return [];
    },
  };
}

export { LAB_IDENTITY_FIELDS, LAB_IDENTITY_KEYS };
