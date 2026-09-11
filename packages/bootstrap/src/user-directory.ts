import { z } from 'zod';
import type { AppContext } from './index';
import type { DirectoryUser } from '@openldr/ports';
import type { UserProfile } from '@openldr/users';

export const directoryPageInput = z.object({
  offset: z.coerce.number().int().min(0).max(2147483647).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(256).optional(),
  enabled: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
});
export interface DirectorySummary extends DirectoryUser {
  subject?: string | null;
  extras: Record<string, string>;
  formSchemaId: string | null;
  formVersion: number | null;
}
export interface DirectoryPage {
  rows: DirectorySummary[];
  offset: number;
  limit: number;
  total: null;
  hasMore: boolean;
}

/** One provider page plus one row detects continuation without scanning the directory. */
export async function listUserDirectory(
  ctx: Pick<AppContext, 'auth' | 'users' | 'userProfiles'>,
  input: unknown = {},
): Promise<DirectoryPage> {
  const { offset, limit, search, enabled } = directoryPageInput.parse(input);
  let users: DirectoryUser[];
  let local = false;
  try {
    users = await ctx.auth.directory.list({ first: offset, max: limit + 1, search, enabled });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'IdentityAdminNotConfiguredError') throw error;
    local = true;
    const rows = await ctx.users.list({ offset, limit: limit + 1, search, enabled });
    users = rows.map((u) => ({ id: u.id, subject: u.subject, username: u.username, email: u.email, firstName: null, lastName: null, enabled: u.status !== 'disabled', roles: u.roles, createdAt: u.createdAt }));
  }
  const visible = users.slice(0, limit);
  const profiles = local ? new Map<string, UserProfile>() : await ctx.userProfiles.list(visible.map((u) => u.id));
  return {
    rows: visible.map((u) => {
      const profile = profiles.get(u.id);
      const extras: Record<string, string> = {};
      if (profile) for (const [key, value] of Object.entries(profile.extras)) extras[key] = value.value;
      return { ...u, extras, formSchemaId: profile?.formSchemaId ?? null, formVersion: profile?.formVersion ?? null };
    }),
    offset, limit, total: null, hasMore: users.length > limit,
  };
}
