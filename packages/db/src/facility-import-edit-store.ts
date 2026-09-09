import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** One operator repair on the Data grid. Either `line` is set (one cell) or `fromValue` is set
 *  (every cell in that column holding that value), never both and never neither. */
export interface FacilityImportEdit {
  id: string;
  nationalSystem: string;
  fileHash: string;
  /** The SOURCE header, spelled as the file spells it. Never a contract field: decision 6 of the
   *  design makes every column editable, including one carried through as extra data. */
  header: string;
  line: number | null;
  fromValue: string | null;
  toValue: string;
  createdBy: string | null;
  createdAt: string;
}

export interface FacilityImportEditStore {
  /** Every edit for one file, oldest first with a unique id tiebreaker so the order is stable. */
  list(nationalSystem: string, fileHash: string): Promise<FacilityImportEdit[]>;
  /** Writes or replaces one edit. Replacing is the point: editing the same cell twice must leave
   *  one row, not two, or the overlay would have to pick between them. */
  put(input: {
    nationalSystem: string; fileHash: string; header: string;
    line?: number | null; fromValue?: string | null; toValue: string;
    createdBy?: string | null;
  }): Promise<FacilityImportEdit>;
  /** The undo. `false` means there was nothing there, which is not an error. */
  remove(nationalSystem: string, fileHash: string, key:
    { header: string; line: number } | { header: string; fromValue: string }): Promise<boolean>;
  /** Every edit for one file, gone. Returns how many went. */
  clear(nationalSystem: string, fileHash: string): Promise<number>;
}

/** The uniqueness key the plain unique index in migration 091 sits on. The `line:`/`value:`
 *  discriminator is what keeps a line-scoped and a value-scoped edit on the same header apart,
 *  and what lets one index cover both shapes without a partial predicate pg-mem cannot plan. */
function editKey(
  nationalSystem: string, fileHash: string, header: string,
  scope: { line: number } | { fromValue: string },
): string {
  const tail = 'line' in scope ? `line:${scope.line}` : `value:${scope.fromValue}`;
  return `${nationalSystem}|${fileHash}|${header}|${tail}`;
}

export function createFacilityImportEditStore(db: Kysely<InternalSchema>): FacilityImportEditStore {
  const row = (r: {
    id: string; national_system: string; file_hash: string; header: string;
    line: number | null; from_value: string | null; to_value: string;
    created_by: string | null; created_at: Date;
  }): FacilityImportEdit => ({
    id: r.id,
    nationalSystem: r.national_system,
    fileHash: r.file_hash,
    header: r.header,
    line: r.line === null ? null : Number(r.line),
    fromValue: r.from_value,
    toValue: r.to_value,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  });

  return {
    async list(nationalSystem, fileHash) {
      const rows = await db.selectFrom('facility_import_edits')
        .selectAll()
        .where('national_system', '=', nationalSystem)
        .where('file_hash', '=', fileHash)
        // `id` is the tiebreaker AGENTS.md section 7 requires beside any ordered read. pg-mem's
        // scan order is stable, so it can never show a tie behaving non-deterministically.
        .orderBy('created_at', 'asc').orderBy('id', 'asc')
        .execute();
      return rows.map(row);
    },

    async put(input) {
      const hasLine = input.line !== undefined && input.line !== null;
      const hasValue = input.fromValue !== undefined && input.fromValue !== null;
      // Refused here rather than left to the index, because the index cannot tell "neither" from
      // "both": one produces a key with no scope and the other a key with two.
      if (hasLine === hasValue) {
        throw new Error('a facility import edit names a line or a value, never both and never neither');
      }
      const scope = hasLine ? { line: input.line as number } : { fromValue: input.fromValue as string };
      const key = editKey(input.nationalSystem, input.fileHash, input.header, scope);
      const values = {
        id: `fie_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        national_system: input.nationalSystem,
        file_hash: input.fileHash,
        header: input.header,
        line: hasLine ? (input.line as number) : null,
        from_value: hasValue ? (input.fromValue as string) : null,
        to_value: input.toValue,
        edit_key: key,
        created_by: input.createdBy ?? null,
      };
      const saved = await db.insertInto('facility_import_edits')
        .values(values)
        .onConflict((oc) => oc.column('edit_key').doUpdateSet({
          to_value: input.toValue,
          created_by: input.createdBy ?? null,
        }))
        .returningAll()
        .executeTakeFirstOrThrow();
      return row(saved);
    },

    async remove(nationalSystem, fileHash, key) {
      const scope = 'line' in key ? { line: key.line } : { fromValue: key.fromValue };
      const res = await db.deleteFrom('facility_import_edits')
        .where('edit_key', '=', editKey(nationalSystem, fileHash, key.header, scope))
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0) > 0;
    },

    async clear(nationalSystem, fileHash) {
      const res = await db.deleteFrom('facility_import_edits')
        .where('national_system', '=', nationalSystem)
        .where('file_hash', '=', fileHash)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },
  };
}
