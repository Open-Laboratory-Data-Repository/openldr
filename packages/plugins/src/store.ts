import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { groupRefusal, permissionGroups, type GroupOwner } from './stored-permissions';

export interface PluginRow {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  status: string;
  enabled: boolean;
  active: boolean;
  approvedBy: string | null;
  /** The verified publisher key fingerprint the version was installed with; null when unsigned. */
  publisher?: string | null;
}

export interface PluginInstallInput {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  approvedBy: string | null;
  /** The publisher key fingerprint the runtime's signature check verified. Null or absent when the
   *  install was not verified. Never a value read from the manifest. */
  publisher?: string | null;
}

export interface PluginStore {
  install(input: PluginInstallInput): Promise<void>;
  get(id: string, version?: string): Promise<PluginRow | undefined>;
  list(): Promise<PluginRow[]>;
  rollback(id: string, version: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string, version?: string): Promise<void>;
  /** The owner of each named permission group that has one. Optional so a fake store may skip it. */
  groupOwners?(groups: string[]): Promise<Map<string, GroupOwner>>;
}

const COLUMNS = ['id', 'version', 'sha256', 'manifest', 'status', 'enabled', 'active', 'approved_by', 'publisher'] as const;

function toRow(r: Record<string, unknown>): PluginRow {
  return {
    id: r.id as string,
    version: r.version as string,
    sha256: r.sha256 as string,
    manifest: r.manifest as Record<string, unknown>,
    status: r.status as string,
    enabled: r.enabled as boolean,
    active: r.active as boolean,
    approvedBy: (r.approved_by as string | null) ?? null,
    publisher: (r.publisher as string | null) ?? null,
  };
}

async function readOwners(db: Kysely<InternalSchema>, groups: string[]): Promise<Map<string, GroupOwner>> {
  if (groups.length === 0) return new Map();
  const rows = await db.selectFrom('plugin_permission_groups').select(['group', 'plugin_id', 'publisher']).where('group', 'in', groups).execute();
  return new Map(rows.map((r) => [r.group, { pluginId: r.plugin_id, publisher: r.publisher ?? null }] as const));
}

/** Claim every permission group a manifest uses for plugin `id` from `publisher`, or throw if the
 *  group is owned by another plugin, or by this id from another publisher (plan
 *  2026-11-23-plugin-host-2b, ruling 1 as amended). `publisher` is the verified key fingerprint, or
 *  null for an unsigned install; null matches only null. Runs inside the caller's transaction. The
 *  owners are read first and nothing is written when one does not match. Then each group is
 *  inserted with on conflict do nothing and read back, so of two installs at once only one owns the
 *  group; the other throws and its transaction rolls back. A claim is never released. */
async function claimGroups(
  trx: Kysely<InternalSchema>,
  id: string,
  publisher: string | null,
  manifest: Record<string, unknown>,
): Promise<void> {
  const groups = permissionGroups(manifest);
  if (groups.length === 0) return;
  const check = async () => {
    const refused = groupRefusal(groups, await readOwners(trx, groups), id, publisher);
    if (refused) throw refused;
  };
  await check();
  await trx
    .insertInto('plugin_permission_groups')
    .values(groups.map((group) => ({ group, plugin_id: id, publisher })))
    .onConflict((oc) => oc.column('group').doNothing())
    .execute();
  await check();
}

export function createPluginStore(db: Kysely<InternalSchema>): PluginStore {
  return {
    groupOwners: (groups) => readOwners(db, groups),

    async install({ id, version, sha256, manifest, approvedBy, publisher: verified }) {
      const publisher = verified ?? null;
      // Wrap in a transaction so there is never a window with zero active rows.
      await db.transaction().execute(async (trx) => {
        await claimGroups(trx, id, publisher, manifest);
        // The newly installed version becomes the sole active one; deactivate all existing rows for this id.
        await trx.updateTable('plugins').set({ active: false }).where('id', '=', id).execute();
        await trx
          .insertInto('plugins')
          .values({
            id,
            version,
            sha256,
            manifest: manifest as never,
            status: 'installed',
            enabled: true,
            active: true,
            approved_by: approvedBy,
            granted_at: sql`now()`,
            publisher,
          })
          .onConflict((oc) =>
            oc.columns(['id', 'version']).doUpdateSet({
              sha256,
              manifest: manifest as never,
              status: 'installed',
              active: true,
              enabled: true,
              approved_by: approvedBy,
              granted_at: sql`now()`,
              publisher,
            }),
          )
          .execute();
      });
    },

    async get(id, version) {
      let q = db.selectFrom('plugins').select(COLUMNS).where('id', '=', id);
      if (version) {
        q = q.where('version', '=', version).where('enabled', '=', true);
      } else {
        q = q.where('active', '=', true).where('enabled', '=', true);
      }
      const r = await q.executeTakeFirst();
      return r ? toRow(r as Record<string, unknown>) : undefined;
    },

    async list() {
      const rows = await db
        .selectFrom('plugins')
        .select(COLUMNS)
        .orderBy('id')
        .orderBy('version', 'desc')
        .execute();
      return rows.map((r) => toRow(r as Record<string, unknown>));
    },

    async rollback(id, version) {
      await db.transaction().execute(async (trx) => {
        const exists = await trx
          .selectFrom('plugins')
          .select(['version', 'manifest', 'publisher'])
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (!exists) {
          throw new Error(`cannot roll back ${id}: version ${version} is not installed`);
        }
        // The version made active must keep to the group rule too.
        await claimGroups(trx, id, exists.publisher ?? null, exists.manifest as Record<string, unknown>);
        await trx.updateTable('plugins').set({ active: false }).where('id', '=', id).execute();
        await trx
          .updateTable('plugins')
          .set({ active: true })
          .where('id', '=', id)
          .where('version', '=', version)
          .execute();
      });
    },

    async setEnabled(id, enabled) {
      await db.transaction().execute(async (trx) => {
        if (enabled) {
          const active = await trx.selectFrom('plugins').select(['manifest', 'publisher']).where('id', '=', id).where('active', '=', true).executeTakeFirst();
          if (active) await claimGroups(trx, id, active.publisher ?? null, active.manifest as Record<string, unknown>);
        }
        await trx.updateTable('plugins').set({ enabled }).where('id', '=', id).execute();
      });
    },

    async remove(id, version) {
      let q = db.deleteFrom('plugins').where('id', '=', id);
      if (version) q = q.where('version', '=', version);
      await q.execute();
    },
  };
}
