import type { Kysely } from 'kysely';

/**
 * A version number on each workflow, raised by every update.
 *
 * A save is based on the version it read. The store writes it only if that version is still the
 * stored one, so two saves of one workflow that started from the same version cannot both land, and
 * neither can a save from an editor tab opened before another save. That is what lets a save drop
 * the secrets of the version it replaced: no stored or later version can still name them.
 * Existing rows start at 0.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflows')
    .addColumn('version', 'integer', c => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflows').dropColumn('version').execute();
}
