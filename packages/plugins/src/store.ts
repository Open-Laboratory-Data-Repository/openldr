import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { PermissionGroupTakenError, permissionGroups } from './stored-permissions';

export interface PluginRow {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  status: string;
  enabled: boolean;
  active: boolean;
  approvedBy: string | null;
}

export interface PluginInstallInput {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  approvedBy: string | null;
}

export interface PluginStore {
  install(input: PluginInstallInput): Promise<void>;
  get(id: string, version?: string): Promise<PluginRow | undefined>;
  list(): Promise<PluginRow[]>;
  rollback(id: string, version: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string, version?: string): Promise<void>;
  /** The owner of each named permission group that has one. Optional so a fake store may skip it. */
  groupOwners?(groups: string[]): Promise<Map<string, string>>;
}

const COLUMNS = ['id', 'version', 'sha256', 'manifest', 'status', 'enabled', 'active', 'approved_by'] as const;

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
  };
}

/** Claim every permission group a manifest uses for plugin `id`, or throw if another plugin owns
 *  one (plan 2026-11-23-plugin-host-2b, ruling 1 as amended). Runs inside the caller's transaction.
 *  The owners are read first and nothing is written when one belongs to another plugin. Then each
 *  group is inserted with on conflict do nothing and read back, so of two installs at once only one
 *  owns the group; the other throws and its transaction rolls back. A claim is never released. */
async function claimGroups(trx: Kysely<InternalSchema>, id: string, manifest: Record<string, unknown>): Promise<void> {
  const groups = permissionGroups(manifest);
  if (groups.length === 0) return;
  const owners = async () =>
    new Map((await trx.selectFrom('plugin_permission_groups').select(['group', 'plugin_id']).where('group', 'in', groups).execute())
      .map((r) => [r.group, r.plugin_id] as const));
  const check = (m: Map<string, string>) => {
    for (const g of groups) {
      const owner = m.get(g);
      if (owner !== undefined && owner !== id) throw new PermissionGroupTakenError(g, owner, id);
    }
  };
  check(await owners());
  await trx
    .insertInto('plugin_permission_groups')
    .values(groups.map((group) => ({ group, plugin_id: id })))
    .onConflict((oc) => oc.column('group').doNothing())
    .execute();
  check(await owners());
}

export function createPluginStore(db: Kysely<InternalSchema>): PluginStore {
  return {
    async groupOwners(groups) {
      if (groups.length === 0) return new Map();
      const rows = await db.selectFrom('plugin_permission_groups').select(['group', 'plugin_id']).where('group', 'in', groups).execute();
      return new Map(rows.map((r) => [r.group, r.plugin_id]));
    },

    async install({ id, version, sha256, manifest, approvedBy }) {
      // Wrap in a transaction so there is never a window with zero active rows.
      await db.transaction().execute(async (trx) => {
        await claimGroups(trx, id, manifest);
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
          .select(['version', 'manifest'])
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (!exists) {
          throw new Error(`cannot roll back ${id}: version ${version} is not installed`);
        }
        // The version made active must keep to the group rule too.
        await claimGroups(trx, id, exists.manifest as Record<string, unknown>);
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
          const active = await trx.selectFrom('plugins').select('manifest').where('id', '=', id).where('active', '=', true).executeTakeFirst();
          if (active) await claimGroups(trx, id, active.manifest as Record<string, unknown>);
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
