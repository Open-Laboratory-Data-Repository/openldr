import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { InternalSchema } from '@openldr/db';

// Per-user studio preferences: theme, sidebar state, first page and language. Shared by the
// /api/me/preferences route and the `openldr user preferences` CLI, so both read and write the
// same way.

export interface UserPreferences {
  theme?: 'light' | 'dark';
  sidebarCollapsed?: boolean;
  /** A studio path such as `/reports`. Studio decides whether the user may open it. */
  startPage?: string;
  /** The studio interface language. One of the languages studio ships. */
  language?: 'en' | 'fr' | 'pt';
  /** The layout this user picked (layout_presets.id), or `full` for the full sidebar. Absent means
   *  their role's default layout. */
  layout?: string;
}

// A path inside studio only: one leading slash, never `//host` or a scheme.
const startPage = z.string().max(200).regex(/^\/(?!\/)[A-Za-z0-9/_.:-]*$/);
/** The same rule, for other code that stores studio paths (layout presets). */
export const studioPathSchema = startPage;
const theme = z.enum(['light', 'dark']);
// The languages studio ships (apps/studio/src/i18n/language.ts). A new one is added in both places.
const language = z.enum(['en', 'fr', 'pt']);
// A layout id or `full`. Not checked against the table: studio falls back when the id is gone.
const layout = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);

/** A change to apply. A missing key is left alone; null clears it. */
export const userPreferencesPatchSchema = z.object({
  theme: theme.nullable().optional(),
  sidebarCollapsed: z.boolean().nullable().optional(),
  startPage: startPage.nullable().optional(),
  language: language.nullable().optional(),
  layout: layout.nullable().optional(),
}).strict();
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;

/** Read a stored row. Unknown keys and bad values are dropped, never thrown on: a row written by
 *  an older or newer version must not stop the app from loading. */
export function parseStoredPreferences(raw: unknown): UserPreferences {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const out: UserPreferences = {};
  const t = theme.safeParse(row.theme);
  if (t.success) out.theme = t.data;
  if (typeof row.sidebarCollapsed === 'boolean') out.sidebarCollapsed = row.sidebarCollapsed;
  const s = startPage.safeParse(row.startPage);
  if (s.success) out.startPage = s.data;
  const l = language.safeParse(row.language);
  if (l.success) out.language = l.data;
  const lay = layout.safeParse(row.layout);
  if (lay.success) out.layout = lay.data;
  return out;
}

export async function getUserPreferences(db: Kysely<InternalSchema>, userId: string): Promise<UserPreferences> {
  const row = await db.selectFrom('user_preferences').select('prefs').where('user_id', '=', userId).executeTakeFirst();
  return parseStoredPreferences(row?.prefs);
}

/** Merge a patch into the user's row and return the result. */
export async function saveUserPreferences(db: Kysely<InternalSchema>, userId: string, patch: UserPreferencesPatch): Promise<UserPreferences> {
  const next: Record<string, unknown> = { ...await getUserPreferences(db, userId) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  const prefs = JSON.stringify(next) as never;
  await db.insertInto('user_preferences')
    .values({ user_id: userId, prefs, updated_at: new Date() })
    .onConflict((oc) => oc.column('user_id').doUpdateSet({ prefs, updated_at: new Date() }))
    .execute();
  return parseStoredPreferences(next);
}
