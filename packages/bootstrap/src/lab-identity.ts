import type { AppSettingStore } from '@openldr/db';
import {
  LAB_ALLOW_SELF_AUTHORISE_KEY, LAB_IDENTITY_FIELDS, LAB_IDENTITY_KEYS, parseAllowSelfAuthorise, toIdentityTokens,
  validateLabIdentityValue, type LabIdentity, type LabIdentityValidationError,
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
  /** Whether the person who entered a result may also authorise it. False when nothing is stored. */
  allowSelfAuthorise(): Promise<boolean>;
  /** Store the switch as 'true' or 'false'. The caller checks lab.settings and audits. */
  setAllowSelfAuthorise(value: boolean, actor: string | null): Promise<void>;
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
    async allowSelfAuthorise() {
      return parseAllowSelfAuthorise((await store.get(LAB_ALLOW_SELF_AUTHORISE_KEY))?.value);
    },
    async setAllowSelfAuthorise(value, actor) {
      await store.set(LAB_ALLOW_SELF_AUTHORISE_KEY, value ? 'true' : 'false', actor);
    },
  };
}

export { LAB_IDENTITY_FIELDS, LAB_IDENTITY_KEYS };
