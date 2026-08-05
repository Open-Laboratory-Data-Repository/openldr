// Re-export new-model types from the browser-safe forms package entry.
export type { FormSchema, FormField, FormSection, VisibilityRule, VisibilityCondition, FormFieldOption } from '@openldr/forms/pure';

/** Answers keyed by field id. */
export type RuntimeAnswers = Record<string, unknown>;

/**
 * The suggestion list for one `suggest` field, as it stands right now. A `fetch` (Task 3/5) will
 * eventually populate these; FormRuntime itself never fetches — it only renders whatever state a
 * caller hands it, which is why `status` is a real tri-state and not a boolean `loading` flag:
 * "still fetching" and "fetched, and there are none" must not read the same way to the user.
 */
export interface SuggestionState {
  status: 'loading' | 'ready' | 'error';
  options: string[];
  error?: string;
}

/** Per-field suggestion state, keyed by field id — the seam a later async caller fills in. */
export type FieldSuggestions = Record<string, SuggestionState>;
