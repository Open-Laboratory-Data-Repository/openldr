import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { InternalSchema } from '@openldr/db';

// Per-user studio preferences: theme, sidebar state and first page. Shared by the
// /api/me/preferences route and the `openldr user preferences` CLI, so both read and write the
// same way.

export interface UserPreferences {
  theme?: 'light' | 'dark';
  sidebarCollapsed?: boolean;
  /** A studio path such as `/reports`. Studio decides whether the user may open it. */
  startPage?: string;
}

// A path inside studio only: one leading slash, never `//host` or a scheme.
const startPage = z.string().max(200).regex(/^\/(?!\/)[A-Za-z0-9/_.:-]*$/);
const theme = z.enum(['light', 'dark']);

/** A change to apply. A missing key is left alone; null clears it. */
export const userPreferencesPatchSchema = z.object({
  theme: theme.nullable().optional(),
  sidebarCollapsed: z.boolean().nullable().optional(),
  startPage: startPage.nullable().optional(),
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
