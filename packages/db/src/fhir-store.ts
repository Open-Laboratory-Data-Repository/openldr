import { randomUUID, createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { validateResource, type FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { Provenance } from './provenance';
import { provenanceFromRow } from './provenance';
import { divergenceHash } from './divergence-hash';
import { recordDivergence } from './sync-divergence-store';

export interface SavedRef {
  resourceType: string;
  id: string;
  version: number;
}

export interface DeleteResult {
  deleted: boolean;
  version?: number;
}

// A change replayed from a remote origin (e.g. a lab's change_log) to be mirror-applied here.
// Unlike save()/delete(), version and siteId are taken verbatim from the origin — NOT derived
// from local history (no max+1) and NOT stamped with the local site.
export interface RemoteRecord {
  resourceType: string;
  id: string;
  version: number; // origin version (from the lab's change_log)
  op: 'upsert' | 'delete';
  siteId: string; // origin site-id (ownership stamp)
  resource?: FhirResource; // present for op:'upsert'
}

// 'diverged' (sync S7): a history row already exists at this (resource_type, id, version) but its
// content DIFFERS from the incoming record — two sides independently authored the same version. The
// incoming content is NOT applied (the local copy is kept); it is recorded in sync_divergences for an
// operator. Detect-and-surface only: there is no auto-heal, by design.
//
// Neither applyRemote call site checks this union exhaustively — both `sync-routes.ts` and
// `sync-bundle.ts` tally with if/else-if chains, not a switch — so WIDENING IT AGAIN WILL NOT PRODUCE
// A COMPILE ERROR at either one. A new variant will be silently absorbed by an existing branch (or by
// no branch at all) until you update both by hand. Correctness itself never depends on the callers:
// the row is written in applyRemote's OWN transaction, so a missed branch costs observability, not data.
export type ApplyResult = 'applied' | 'skipped' | 'diverged';

export interface AmendInput {
  resourceType: string;
  id: string;
  status: string; // e.g. 'amended' | 'corrected'
  patch?: Record<string, unknown>; // shallow-merged into the current resource body
  agent: string; // Provenance agent.who.display (who authored the amendment)
  reason?: string; // Provenance reason text
  activity?: string; // Provenance activity token (Sync S6c). Default 'amend' (result correction);
                     // an order status/metadata change passes 'update'. Mapped to the v3-DataOperation
                     // coding as { code: activity.toUpperCase(), display: activity.toLowerCase() }.
}
export interface AmendResult {
  version: number; // new version of the amended resource
  provenanceId: string; // id of the created Provenance resource
  siteId: string; // owning lab (routing key)
}
export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}
export class NotLabOwnedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotLabOwnedError';
  }
}
export class UnsupportedResourceTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedResourceTypeError';
  }
}
export class PatientNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'PatientNotFoundError'; }
}
export class CrossSiteMergeError extends Error {
  constructor(message: string) { super(message); this.name = 'CrossSiteMergeError'; }
}
export class SamePatientError extends Error {
  constructor(message: string) { super(message); this.name = 'SamePatientError'; }
}

// Sync S6b: the referencing resource types a merge re-points. All carry the patient link in `subject`,
// so the re-point patch is uniform. A ref of any other type is skipped (never graft a spurious subject).
const MERGE_REF_TYPES: ReadonlySet<string> = new Set(['Observation', 'ServiceRequest', 'DiagnosticReport', 'Specimen']);

export interface MergeInput {
  survivorId: string;
  duplicateId: string;
  agent: string; // Provenance agent.who.display
  reason?: string;
  referencingRefs: { resourceType: string; id: string }[]; // enumerated by the caller (read-model reverse index)
}
export interface MergeResult {
  survivorId: string;
  duplicateId: string;
  repointed: number; // count of referencing resources actually re-pointed (stale ones skipped)
  provenanceId: string;
  siteId: string; // owning lab
}

// Sync S6c: the resource types a central operator may amend/co-edit. Results (Observation /
// DiagnosticReport) + lab orders (ServiceRequest). Anything else is rejected — amend must not inject a
// `status`/version onto an arbitrary lab-owned resource type.
export const AMENDABLE_TYPES: ReadonlySet<string> = new Set(['Observation', 'DiagnosticReport', 'ServiceRequest']);

// Lab slice 1a: the resource types a lab may correct on its own install (spec 5.4 and 5.8).
export const CORRECTABLE_TYPES: ReadonlySet<string> = new Set(['ServiceRequest', 'Specimen', 'Observation']);
const CORRECTION_REASON_MAX = 500;

export interface CorrectInput {
  resourceType: 'ServiceRequest' | 'Specimen' | 'Observation';
  id: string;
  next: Record<string, unknown>; // the whole new resource body, same type and id
  who: string; // Provenance agent.who.display
  reason: string; // Provenance reason.text, required, trimmed, 1 to 500 characters
  activity?: 'correct' | 'amend'; // default 'correct'
}
export interface CorrectResult {
  resource: Record<string, unknown>; // the stored new version, with its meta stamps
  provenanceId: string;
  version: number;
}
/** Why `correct` refused. A refusal writes nothing. */
export class CorrectionError extends Error {
  constructor(readonly reason: 'not-found' | 'type' | 'invalid' | 'reason', message: string) {
    super(message);
    this.name = 'CorrectionError';
  }
}

/** A save that names its owner (`SaveManyOpts.ownedBy`) found a stored record some other writer
 *  holds. Nothing in the list was saved. */
export class FhirOwnershipError extends Error {
  constructor(readonly resourceType: string, readonly id: string, readonly ownedBy: string) {
    super(`${resourceType}/${id} was not written by ${ownedBy}, so it cannot change it; nothing was saved`);
    this.name = 'FhirOwnershipError';
  }
}

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  /** Saves every resource in one transaction, in order, with one projection wake-up after the
   *  commit. A failure on any resource saves none of them (item 16: a request is saved whole). */
  saveMany(resources: FhirResource[], provenance?: Provenance, opts?: SaveManyOpts): Promise<SavedRef[]>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
  /** Cheap existence check for the latest version of a resource. */
  exists(resourceType: string, id: string): Promise<boolean>;
  /** Like `get`, but also returns the row's stored provenance. The deferred projection
   *  needs it — `get` alone silently produced NULL source_system/batch_id in every
   *  projected row. Additive rather than a change to `get`, because
   *  terminology-store.ts:161 wants the bare resource. */
  getWithProvenance(resourceType: string, id: string): Promise<{ resource: FhirResource; provenance: Provenance } | null>;
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
  delete(resourceType: string, id: string): Promise<DeleteResult>;
  // Mirror-apply a remote change at its ORIGIN version/site. Idempotent on (resourceType,id,version):
  // a re-applied version is a no-op ('skipped'). Returns 'applied' when it wrote history/change_log.
  applyRemote(record: RemoteRecord): Promise<ApplyResult>;
  // Sync S6a: author a central amendment of a lab-owned resource — new version (keeping the owning
  // lab's site_id) + a Provenance resource + two sync_amendments outbox rows, all in one transaction.
  amend(input: AmendInput): Promise<AmendResult>;
  // Lab slice 1a: a lab saves a new version of its own ServiceRequest, Specimen or Observation,
  // validated, with a Provenance for who and why. Works with no sync site id and writes no
  // sync_amendments rows. Throws CorrectionError before any write when it refuses.
  correct(input: CorrectInput): Promise<CorrectResult>;
  // Sync S6b: atomically author an intra-lab patient merge — mark the duplicate Patient replaced
  // (active:false + link replaced-by survivor), re-point each referencing resource's subject to the
  // survivor, write one merge Provenance, and emit sync_amendments outbox rows. One transaction.
  mergePatients(input: MergeInput): Promise<MergeResult>;
}

/** `skipUnchanged`: do not write a record whose content is the latest stored version of it
 *  (item 16, design 2026-11-19-check-skip-unchanged). Only the import check asks for it. */
export interface SaveManyOpts {
  skipUnchanged?: boolean;
  /** A plugin id. Each record already stored must have been written by this plugin, checked inside
   *  the save's own transaction with the stored rows locked, so another writer cannot change one
   *  between the check and the write. A record held by anyone else fails the whole save with
   *  FhirOwnershipError. A record with no stored row is new and passes. */
  ownedBy?: string;
}

function contentHash(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

/** `saveMode` picks how `saveMany` writes. 'set' is one set-based statement per call, which only
 *  real PostgreSQL can run. 'rows' is a few multi-row statements, which pg-mem can run too. 'auto'
 *  (the default) asks the database once and uses 'set' where it works. The two store the same rows:
 *  fhir-store-save-set.live.test.ts runs every scenario through both and compares the tables. */
export interface FhirStoreOpts {
  saveMode?: 'auto' | 'rows' | 'set';
  /** Rows per statement in a list save. 1,000 unless set. Tests set a small one to cross a chunk
   *  boundary with a few records, since pg-mem slows down far faster than the row count grows. */
  saveChunk?: number;
}

export function createFhirStore(db: Kysely<InternalSchema>, storeOpts: FhirStoreOpts = {}): FhirStore {
  // site_id is enrollment-stable ONCE SET, so memoize it — but only when it resolves to a
  // real value. Memoizing `null` was a silent data-loss bug: a lab that ingested before an
  // operator filled in Settings -> Distributed sync cached "no site" for the life of the
  // process, so every change_log row was written with site_id = NULL. The sync worker then
  // skipped each one ("missing site_id on safe record") *and advanced the push cursor past
  // it*, permanently un-syncing that data while the UI showed "Pending push: 0". Re-reading
  // while unset costs one indexed lookup per write and stops as soon as a site is configured.
  let siteId: string | null | undefined;
  async function resolveSiteId(): Promise<string | null> {
    if (siteId != null) return siteId;
    const row = await db.selectFrom('app_settings').select('value').where('key', '=', 'sync.site_id').executeTakeFirst();
    // `||` so an empty app_settings value falls through to the env var.
    const resolved = row?.value || process.env.OPENLDR_SITE_ID || null;
    if (resolved) siteId = resolved; // only a real value is sticky
    return resolved;
  }

  async function nextVersion(trx: Kysely<InternalSchema>, resourceType: string, id: string): Promise<number> {
    const hi = await trx
      .selectFrom('fhir.resource_history')
      .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
      .where('resource_type', '=', resourceType)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(hi?.maxv ?? 0) + 1;
  }
  // PRECONDITION: the fhir_resources ON CONFLICT doUpdateSet below is UNCONDITIONAL (no monotonic
  // guard, unlike applyRemote's `WHERE version < incoming`). It is therefore only safe for callers that
  // pass a version guaranteed >= the canonical row's — amend passes nextVersion() (max+1) for the
  // amended resource and a fresh randomUUID id at v1 for the Provenance, so it can never regress a row.
  async function writeVersion(
    trx: Kysely<InternalSchema>,
    v: { resourceType: string; id: string; version: number; body: Record<string, unknown>; siteId: string },
  ): Promise<void> {
    const serialized = JSON.stringify(v.body);
    const contentHashHex = contentHash(serialized);
    // INVARIANT (projection safe-frontier): change_log must NOT be the txn's first write — history is
    // inserted FIRST here so the txn's xid is assigned before nextval(seq) is drawn for change_log.
    // Do NOT reorder these inserts. (Mirrors save()/applyRemote().)
    await trx
      .insertInto('fhir.resource_history')
      .values({ resource_type: v.resourceType, id: v.id, version: v.version, op: 'upsert', resource: serialized })
      .execute();
    await trx
      .insertInto('fhir.fhir_current')
      .values({ resource_type: v.resourceType, id: v.id, version: v.version, version_id: String(v.version) })
      .onConflict((oc) =>
        oc.columns(['resource_type', 'id']).doUpdateSet({
          version: v.version,
          version_id: String(v.version),
          updated_at: sql`now()`,
        }),
      )
      .execute();
    await trx
      .insertInto('fhir.change_log')
      .values({ resource_type: v.resourceType, resource_id: v.id, version: v.version, op: 'upsert', content_hash: contentHashHex, site_id: v.siteId })
      .execute();
  }

  // Sync S6b: the owning-lab site_id = the site on a resource's latest change_log row (same lookup amend
  // does inline). Empty string when unstamped (central-owned / unsynced).
  async function latestSite(trx: Kysely<InternalSchema>, resourceType: string, id: string): Promise<string> {
    const owner = await trx
      .selectFrom('fhir.change_log')
      .select('site_id')
      .where('resource_type', '=', resourceType)
      .where('resource_id', '=', id)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return owner?.site_id ?? '';
  }

  // Rows per statement. Nine columns at most, so 1,000 rows stay far below PostgreSQL's limit of
  // 65,535 parameters. saveMany has no size limit of its own, so every statement is split.
  const SAVE_CHUNK = storeOpts.saveChunk ?? 1000;
  function chunksOf<T>(list: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += SAVE_CHUNK) out.push(list.slice(i, i + SAVE_CHUNK));
    return out;
  }

  // Writes a list inside the caller's transaction with a few multi-row statements (item 16 slice 2a):
  // one versions lookup, then one insert each into fhir_resources, resource_history and change_log.
  // Each row is built as a single save builds it.
  async function writeMany(trx: Kysely<InternalSchema>, resources: FhirResource[], provenance: Provenance, site: string | null, skipUnchanged: boolean): Promise<{ refs: SavedRef[]; written: number }> {
    // Ids first: a resource without one gets it before keys are grouped.
    const items = resources.map((resource) => ({ resource, resourceType: resource.resourceType, id: (resource as { id?: string }).id ?? randomUUID() }));
    const keyOf = (resourceType: string, id: string): string => `${resourceType}\u0000${id}`;

    // Next version = highest ever recorded in the append-only history + 1. Deriving from
    // history (not the canonical row) keeps versions monotonic across delete→recreate, since
    // delete() removes the canonical row but history retains every version. The history PK
    // (resource_type,id,version) also serializes concurrent same-key writes: a race loser
    // hits a duplicate-key and rolls back atomically, throwing to the caller (no data
    // corruption; a caller retry then reads the new max and advances). This means truly
    // concurrent same-id writes can now fail where a plain upsert would have last-writer-won.
    // (bigint reads back as string on real pg, number on pg-mem — always coerce.)
    // One plain max() per key, joined with UNION ALL into one statement. PostgreSQL answers a plain
    // max() on (resource_type, id) from the end of the history primary key, reading one entry. A
    // single grouped lookup would instead read every stored version of each key, and a record that
    // every request saves again (an Organization) has thousands.
    const highest = new Map<string, number>();
    const distinct = [...new Map(items.map((i) => [keyOf(i.resourceType, i.id), i])).values()];
    for (const part of chunksOf(distinct)) {
      const branches = part.map((k, n) => sql`select ${sql.lit(n)} as n, coalesce(max(version), 0) as maxv from fhir.resource_history where resource_type = ${k.resourceType} and id = ${k.id}`);
      const found = await sql<{ n: number; maxv: number | string }>`${sql.join(branches, sql` union all `)}`.execute(trx);
      for (const row of found.rows) {
        const k = part[Number(row.n)];
        highest.set(keyOf(k.resourceType, k.id), Number(row.maxv));
      }
    }

    // Skip unchanged (item 16): the hash of the latest stored version of each key that has one. Only
    // an upsert with a hash counts. A tombstone, an amendment, a version from sync and a row from
    // before the hash column have none, so a record they are the latest version of is never skipped.
    const latestHash = new Map<string, string>();
    if (skipUnchanged) {
      const stored = distinct.filter((k) => (highest.get(keyOf(k.resourceType, k.id)) ?? 0) > 0);
      for (const part of chunksOf(stored)) {
        const found = await trx
          .selectFrom('fhir.resource_history')
          .select(['resource_type', 'id', 'op', 'content_hash'])
          .where((eb) => eb.or(part.map((k) => eb.and([
            eb('resource_type', '=', k.resourceType),
            eb('id', '=', k.id),
            eb('version', '=', highest.get(keyOf(k.resourceType, k.id))!),
          ]))))
          .execute();
        for (const row of found) {
          if (row.op === 'upsert' && row.content_hash) latestHash.set(keyOf(row.resource_type, row.id), row.content_hash);
        }
      }
    }

    const prov = {
      source_system: provenance.sourceSystem ?? null,
      plugin_id: provenance.pluginId ?? null,
      plugin_version: provenance.pluginVersion ?? null,
      batch_id: provenance.batchId ?? null,
    };
    // Versions are numbered in input order, so a key that comes twice gets max+1 then max+2. With
    // skipUnchanged, a record whose hash is the hash of the key's latest version, stored or from
    // earlier in this call, is not written: its ref carries that version.
    const refs: SavedRef[] = [];
    const rows: Array<{ key: string; resourceType: string; id: string; next: number; serialized: string; contentHashHex: string }> = [];
    for (const { resource, resourceType, id } of items) {
      const key = keyOf(resourceType, id);
      // Hash the pre-stamp content so identical content hashes stably (excludes the volatile
      // server-stamped meta.versionId / meta.lastUpdated we add below).
      const contentHashHex = contentHash(JSON.stringify({ ...resource, id }));
      if (skipUnchanged && latestHash.get(key) === contentHashHex) {
        refs.push({ resourceType, id, version: highest.get(key)! });
        continue;
      }
      const next = (highest.get(key) ?? 0) + 1;
      highest.set(key, next);
      latestHash.set(key, contentHashHex);
      const nowIso = new Date().toISOString();
      const meta = { ...(resource as { meta?: Record<string, unknown> }).meta, versionId: String(next), lastUpdated: nowIso };
      const serialized = JSON.stringify({ ...resource, id, meta });
      rows.push({ key, resourceType, id, next, serialized, contentHashHex });
      refs.push({ resourceType, id, version: next });
    }
    // Nothing changed: no write at all, so the transaction takes no id and adds no change row.
    if (rows.length === 0) return { refs, written: 0 };

    // The canonical row holds the latest version only. A key that comes twice sends just its last
    // row: PostgreSQL refuses an upsert that would update one row twice in a statement.
    const last = new Map<string, (typeof rows)[number]>();
    for (const row of rows) last.set(row.key, row);
    for (const part of chunksOf([...last.values()])) {
      await trx
        .insertInto('fhir.fhir_current')
        .values(part.map((r) => ({ resource_type: r.resourceType, id: r.id, version: r.next, version_id: String(r.next), ...prov })))
        .onConflict((oc) =>
          oc.columns(['resource_type', 'id']).doUpdateSet((eb) => ({
            version: eb.ref('excluded.version'),
            version_id: eb.ref('excluded.version_id'),
            source_system: eb.ref('excluded.source_system'),
            plugin_id: eb.ref('excluded.plugin_id'),
            plugin_version: eb.ref('excluded.plugin_version'),
            batch_id: eb.ref('excluded.batch_id'),
            updated_at: sql`now()`,
          })),
        )
        .execute();
    }
    // History keeps every version, in input order.
    for (const part of chunksOf(rows)) {
      await trx
        .insertInto('fhir.resource_history')
        .values(part.map((r) => ({ resource_type: r.resourceType, id: r.id, version: r.next, op: 'upsert' as const, resource: r.serialized, content_hash: r.contentHashHex })))
        .execute();
    }
    // INVARIANT (load-bearing for the projection safe-frontier): the change_log insert must NOT be
    // this transaction's first write. The fhir_resources upsert + resource_history insert above run
    // first, so the txn's xid is assigned before nextval(seq) is drawn here. The R2 projection worker
    // relies on this: a gap's txn xid < the snapshot's xmax that stamps its x0. Inserting into
    // change_log as a transaction's first statement would reopen a permanent-skip window.
    // Rows go in input order, so seq rises in input order within a call.
    for (const part of chunksOf(rows)) {
      await trx
        .insertInto('fhir.change_log')
        .values(part.map((r) => ({ resource_type: r.resourceType, resource_id: r.id, version: r.next, op: 'upsert' as const, content_hash: r.contentHashHex, site_id: site })))
        .execute();
    }
    return { refs, written: rows.length };
  }

  // The same save as `writeMany`, as ONE statement (item 16). Measured on 58,526 real records it is
  // 3.8 times faster: `writeMany` binds each value as its own parameter, in several statements per
  // 1,000 rows, and sends every document twice. Here the call goes over once, as four arrays, and
  // the server numbers the versions, applies the skip, stamps `meta` and fills the three tables.
  // Node still hashes, so a hash is the same text whichever path wrote it.
  async function writeManySet(trx: Kysely<InternalSchema>, resources: FhirResource[], provenance: Provenance, site: string | null, skipUnchanged: boolean): Promise<{ refs: SavedRef[]; written: number }> {
    const types: string[] = [];
    const ids: string[] = [];
    const bodies: string[] = [];
    const hashes: string[] = [];
    for (const resource of resources) {
      // The row path fails such a record on the not-null column. Here the statement would drop it
      // without a word, so it is refused before anything is sent.
      if (typeof resource.resourceType !== 'string' || resource.resourceType.length === 0) {
        throw new Error('cannot save a record with no resourceType');
      }
      const id = (resource as { id?: string }).id ?? randomUUID();
      // The pre-stamp content, as `writeMany` hashes it. The server adds the meta stamps.
      const body = JSON.stringify({ ...resource, id });
      types.push(resource.resourceType);
      ids.push(id);
      bodies.push(body);
      hashes.push(contentHash(body));
    }
    const nowIso = new Date().toISOString();
    // - `latest`: the newest history row of each key, read from the end of its primary key.
    // - `marked`: a row is kept unless the skip is on and its hash is the hash before it for that
    //   key: the row before it in this call, or the stored version for the first. A tombstone, an
    //   amendment, a version from sync and an older row carry no hash, so they never match.
    // - `numbered`: kept rows take max+1, max+2 in input order. A skipped row reports the version
    //   it matched.
    // - The canonical row takes the last kept row of each key.
    // INVARIANT (projection safe-frontier): a change_log row must not be this transaction's first
    // write, so the transaction has its id before a seq is drawn. The change_log insert reads the
    // history insert's RETURNING rows, so PostgreSQL writes the history rows first.
    const found = await sql<{ n: number; v: number | string; keep: boolean }>`
      with input as (
        select * from unnest(${types}::text[], ${ids}::text[], ${bodies}::text[], ${hashes}::text[]) with ordinality as k(t, i, body, hash, n)
      ), latest as (
        select k.t, k.i, coalesce(h.version, 0) as maxv, case when h.op = 'upsert' then h.content_hash end as stored_hash
        from (select distinct t, i from input) k
        left join lateral (
          select r.version, r.op, r.content_hash from fhir.resource_history r
          where r.resource_type = k.t and r.id = k.i order by r.version desc limit 1
        ) h on true
      ), marked as (
        select x.n, x.t, x.i, x.body, x.hash, l.maxv,
               (not ${skipUnchanged}::boolean)
               or (coalesce(lag(x.hash) over (partition by x.t, x.i order by x.n), l.stored_hash) is distinct from x.hash) as keep
        from input x join latest l on l.t = x.t and l.i = x.i
      ), numbered as (
        select m.*, m.maxv + sum(case when m.keep then 1 else 0 end) over (partition by m.t, m.i order by m.n) as v from marked m
      ), stamped as (
        select n, t, i, v, hash,
               body::jsonb || jsonb_build_object('meta',
                 (case when jsonb_typeof(body::jsonb -> 'meta') = 'object' then body::jsonb -> 'meta' else '{}'::jsonb end)
                 || jsonb_build_object('versionId', v::text, 'lastUpdated', ${nowIso}::text)) as doc
        from numbered where keep
      ), cur as (
        insert into fhir.fhir_current (resource_type, id, version, version_id, source_system, plugin_id, plugin_version, batch_id)
        select distinct on (t, i) t, i, v, v::text,
               ${provenance.sourceSystem ?? null}::text, ${provenance.pluginId ?? null}::text, ${provenance.pluginVersion ?? null}::text, ${provenance.batchId ?? null}::text
        from stamped order by t, i, n desc
        on conflict (resource_type, id) do update set
          version = excluded.version, version_id = excluded.version_id,
          source_system = excluded.source_system, plugin_id = excluded.plugin_id,
          plugin_version = excluded.plugin_version, batch_id = excluded.batch_id, updated_at = now()
      ), hist as (
        insert into fhir.resource_history (resource_type, id, version, op, resource, content_hash)
        select t, i, v, 'upsert', doc, hash from stamped
        returning resource_type, id, version
      ), log as (
        insert into fhir.change_log (resource_type, resource_id, version, op, content_hash, site_id)
        select s.t, s.i, s.v, 'upsert', s.hash, ${site}::text
        from stamped s join hist h on h.resource_type = s.t and h.id = s.i and h.version = s.v
        order by s.n
      )
      select n::int as n, v::bigint as v, keep from numbered order by n`.execute(trx);
    // One answer for each record sent, by its place in the call.
    if (found.rows.length !== resources.length) {
      throw new Error(`the save answered for ${found.rows.length} of ${resources.length} records`);
    }
    let written = 0;
    const refs = found.rows.map((row) => {
      if (row.keep) written += 1;
      const k = Number(row.n) - 1;
      return { resourceType: types[k], id: ids[k], version: Number(row.v) };
    });
    return { refs, written };
  }

  // Whether this database can run the set-based statement. Asked once, outside any transaction, so
  // a refusal aborts nothing. pg-mem refuses, and then every save takes the row path.
  let setBased: boolean | null = storeOpts.saveMode === 'set' ? true : storeOpts.saveMode === 'rows' ? false : null;
  async function useSetBased(): Promise<boolean> {
    if (setBased === null) {
      try {
        await sql`select k.n from unnest(array['a']::text[], array['b']::text[]) with ordinality as k(t, i, n)
          left join lateral (select 1 as one) x on true`.execute(db);
        setBased = true;
      } catch (err) {
        // Only "this database cannot run it" settles the question. Any other failure, such as a
        // dropped connection, takes the row path for this one save and asks again on the next:
        // remembering it would leave a real PostgreSQL on the slower path until the next restart.
        const text = err instanceof Error ? err.message : String(err);
        if (/unnest|ordinality|lateral|not supported|not implemented|failed to parse/i.test(text)) setBased = false;
        else return false;
      }
    }
    return setBased;
  }

  /** Locks the stored rows of the records and refuses one another writer holds (SaveManyOpts.ownedBy). */
  async function checkOwner(trx: Kysely<InternalSchema>, resources: FhirResource[], ownedBy: string, postgres: boolean): Promise<void> {
    const byType = new Map<string, Set<string>>();
    for (const r of resources) {
      if (typeof r.id !== 'string' || r.id.length === 0) continue;
      if (!byType.has(r.resourceType)) byType.set(r.resourceType, new Set());
      byType.get(r.resourceType)!.add(r.id);
    }
    // Lock in one fixed order (type, then id, across the chunks too), so two saves that touch the
    // same records cannot each hold a lock the other waits on. The order is the byte order of the
    // UTF-8 text: the ids are sorted so here, and PostgreSQL locks each chunk so (COLLATE "C"), so
    // the two agree for mixed-case ids too. pg-mem cannot parse COLLATE and keeps its plain order.
    const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    const types = [...byType.keys()].sort(byBytes);
    for (const resourceType of types) {
      const all = [...byType.get(resourceType)!].sort(byBytes);
      for (let i = 0; i < all.length; i += 1000) {
        // fhir_current, not the fhir_resources view: a view over a join cannot be locked.
        const rows = await trx
          .selectFrom('fhir.fhir_current')
          .select(['id', 'plugin_id'])
          .where('resource_type', '=', resourceType)
          .where('id', 'in', all.slice(i, i + 1000))
          .orderBy(postgres ? sql`id collate "C"` : sql`id`)
          .forUpdate()
          .execute();
        const other = rows.find((row) => row.plugin_id !== ownedBy);
        if (other) throw new FhirOwnershipError(resourceType, other.id, ownedBy);
      }
    }
  }

  async function saveMany(resources: FhirResource[], provenance: Provenance = {}, opts: SaveManyOpts = {}): Promise<SavedRef[]> {
    if (resources.length === 0) return [];
    const site = await resolveSiteId();
    const write = (await useSetBased()) ? writeManySet : writeMany;
    const { refs, written } = await db.transaction().execute(async (trx) => {
      if (opts.ownedBy !== undefined) await checkOwner(trx, resources, opts.ownedBy, write === writeManySet);
      return write(trx, resources, provenance, site, opts.skipUnchanged === true);
    });
    // A call that skipped every record changed nothing, so there is nothing to wake anyone for.
    if (written === 0) return refs;
    // Best-effort wakeup for the projection worker; interval polling is the correctness-bearing
    // path, so a notify failure (e.g. pg-mem in tests) must never affect the save.
    try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
    return refs;
  }

  return {
    save: async (resource, provenance = {}) => (await saveMany([resource], provenance))[0],
    saveMany,

    async get(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select('resource')
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? (row.resource as FhirResource) : null;
    },

    async exists(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_current')
        .select((eb) => eb.lit(1).as('one'))
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return !!row;
    },

    async getWithProvenance(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select(['resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'])
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return null;
      return { resource: row.resource as FhirResource, provenance: provenanceFromRow(row) };
    },

    async listByType(resourceType, limit = 500) {
      const rows = await db
        .selectFrom('fhir.fhir_resources')
        .select(['id', 'resource'])
        .where('resource_type', '=', resourceType)
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute();
      return rows.map((r) => ({ id: r.id, resource: r.resource as FhirResource }));
    },

    async delete(resourceType, id) {
      const site = await resolveSiteId();
      return db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('fhir.fhir_current')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!existing) return { deleted: false };
        const hi = await trx
          .selectFrom('fhir.resource_history')
          .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        const next = Number(hi?.maxv ?? 0) + 1;
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version: next, op: 'delete', resource: null })
          .execute();
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version: next, op: 'delete', content_hash: null, site_id: site })
          .execute();
        await trx.deleteFrom('fhir.fhir_current').where('resource_type', '=', resourceType).where('id', '=', id).execute();
        return { deleted: true, version: next };
      });
    },

    async applyRemote(record) {
      const { resourceType, id, version, op, siteId } = record;
      // Validate BEFORE opening the transaction: an upsert must carry a resource. Guarding here means
      // the upsert branch's content is genuinely non-null (the `content!` below is sound) and we never
      // write a self-contradictory history row (op='upsert', resource=null) or hit an opaque NOT NULL
      // violation deep inside the tx.
      if (op === 'upsert' && !record.resource) throw new Error('applyRemote: upsert requires resource');
      // Mirror-store the origin content verbatim (id normalized). Null for a tombstone. Computed ONCE,
      // before the transaction, because it is BOTH what we would store AND (sync S7) what we hash to
      // compare against the stored copy — deriving them from one expression is what keeps the incoming
      // hash apples-to-apples with the local one. Pure JS: no DB access, so no write ordering is affected.
      const normalizedBody: Record<string, unknown> | null =
        op === 'upsert' && record.resource ? { ...record.resource, id } : null;
      const content = normalizedBody ? JSON.stringify(normalizedBody) : null;

      const result = await db.transaction().execute(async (trx): Promise<ApplyResult> => {
        // Idempotency + divergence detection (sync S7). The history PK is (resource_type,id,version):
        // a matching row answers "have we already applied this exact origin version?", and its body
        // tells a genuine re-drain (identical content → skip) from a same-version DIVERGENCE (different
        // content → the incoming edit is being dropped, which must not be silent).
        //
        // We use an explicit existence SELECT rather than ON CONFLICT DO NOTHING +
        // numInsertedOrUpdatedRows because that row-count is engine-dependent (pg-mem reports 1 even on
        // a conflict no-op), so it can't discriminate a real insert from a skip. This SELECT is
        // deterministic on real pg and pg-mem alike. (It is read-only — see the safe-frontier INVARIANT
        // on the writes below.) `op` is deliberately NOT selected: `resource IS NULL` already IS the
        // tombstone marker (a delete writes resource:null, an upsert is guarded to always carry a body),
        // so reading op would add a second, redundant source of truth for the same fact.
        const already = await trx
          .selectFrom('fhir.resource_history')
          .select(['version', 'resource'])
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (already) {
          // NULL-aware: null == null means two tombstones, which AGREE (nothing was lost).
          // `already.resource` arrives as a parsed object on pg/pg-mem but as text on some drivers;
          // divergenceHash normalizes both. The incoming side is hashed from `normalizedBody` — the
          // SAME id-normalized shape the store path writes — so a wire body that merely omits the
          // redundant `id` cannot manufacture a phantom divergence.
          const localHash = divergenceHash(already.resource);
          const incomingHash = divergenceHash(normalizedBody);
          if (localHash === incomingHash) return 'skipped';

          // Same version, different content. Keep the local copy (no fhir_resources / change_log
          // writes on this path) and durably record what we dropped, in THIS transaction — the skip
          // and the record of why it happened commit together, so a crash can never leave a dropped
          // edit with no trace.
          await recordDivergence(trx, {
            resourceType,
            resourceId: id,
            version,
            localHash,
            incomingHash,
            incomingBody: normalizedBody,
            incomingSiteId: siteId,
          });
          return 'diverged';
        }

        // INVARIANT (projection safe-frontier): the change_log insert must NOT be this transaction's first
        // write — the resource_history insert here (and the fhir_resources write below) precede it, so the
        // txn's xid is assigned before nextval(seq) is drawn for change_log. Do not reorder. The existence
        // SELECT above is read-only and does not assign an xid, so it does not affect this ordering.
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version, op, resource: content })
          .execute();

        // Monotonic canonical write: only touch fhir_resources when the incoming version is the NEWEST one
        // ever applied for this resource, tombstones included. We just appended this version to
        // resource_history above, so a strictly-greater history version means a newer upsert OR delete has
        // already landed. Gating on that closes two out-of-order holes a per-statement guard alone cannot:
        //   (1) a late older DELETE arriving after a newer upsert is canonical — the delete would otherwise
        //       remove newer clinical data (there IS a row, so a plain delete succeeds); and
        //   (2) a late older UPSERT arriving after a newer delete — it would otherwise RESURRECT the row,
        //       because no conflict row exists for an ON CONFLICT guard to reject.
        // History and change_log stay unconditional (append-only): the stale op is still recorded and still
        // emits to the sync/projection stream; only the canonical read model is protected.
        const newest = await trx
          .selectFrom('fhir.resource_history')
          .select(({ fn }) => fn.max('version').as('maxVersion'))
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        const isNewest = newest?.maxVersion == null || Number(newest.maxVersion) <= version;

        if (isNewest && op === 'upsert') {
          // Atomic monotonic guard (belt-and-suspenders under concurrent same-id applies): on a first apply
          // the plain INSERT lands; on conflict we advance the canonical row ONLY when the stored version is
          // strictly less than the incoming version. The WHERE qualifies the EXISTING (target) row — Postgres
          // exposes it under the unqualified relation name in ON CONFLICT DO UPDATE, so
          // `sql.ref('fhir_current.version')` renders that reference. The document itself is the history
          // row written above: the current row only names its version (migration 130).
          await trx
            .insertInto('fhir.fhir_current')
            .values({ resource_type: resourceType, id, version, version_id: String(version) })
            .onConflict((oc) =>
              oc
                .columns(['resource_type', 'id'])
                .doUpdateSet({
                  version,
                  version_id: String(version),
                  updated_at: sql`now()`,
                })
                .where(sql.ref('fhir_current.version'), '<', version),
            )
            .execute();
        } else if (isNewest && op === 'delete') {
          await trx.deleteFrom('fhir.fhir_current').where('resource_type', '=', resourceType).where('id', '=', id).execute();
        }

        // change_log stamped with the ORIGIN site_id (ownership stamp) — NOT resolveSiteId(), which is the
        // local site. Hash mirrors save(): sha256 of the stored content; null for a tombstone.
        const contentHashHex = content ? contentHash(content) : null;
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version, op, content_hash: contentHashHex, site_id: siteId })
          .execute();
        return 'applied';
      });
      // Best-effort projection-worker wakeup; interval polling is the correctness path (matches save()).
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },

    async amend(input) {
      const { resourceType, id, status, patch, agent, reason, activity } = input;
      if (!AMENDABLE_TYPES.has(resourceType)) {
        throw new UnsupportedResourceTypeError(`${resourceType} is not amendable (allowed: ${[...AMENDABLE_TYPES].join(', ')})`);
      }
      const activityCode = activity || 'amend';
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<AmendResult> => {
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('resource')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!cur) throw new ResourceNotFoundError(`${resourceType}/${id} not found`);

        // Owning lab = the site_id on the resource's latest change_log row. A lab-owned resource
        // (pushed up from a lab via applyRemote) carries that lab's site_id; a central-owned /
        // unsynced resource (saved locally with no configured site) carries null → refuse to amend.
        const owner = await trx
          .selectFrom('fhir.change_log')
          .select('site_id')
          .where('resource_type', '=', resourceType)
          .where('resource_id', '=', id)
          .orderBy('version', 'desc')
          .limit(1)
          .executeTakeFirst();
        const siteId = owner?.site_id ?? '';
        if (!siteId) throw new NotLabOwnedError(`${resourceType}/${id} is not lab-owned`);

        const nowIso = new Date().toISOString();
        const base = cur.resource as Record<string, unknown>;

        const amendedVersion = await nextVersion(trx, resourceType, id);
        // Strip resourceType/id from the caller's patch before merging: those identify WHICH row this
        // is (the resource_type column + PK), so a patch must never change them or the stored JSON would
        // desync from the row it's filed under. id/status/meta are pinned after the merge regardless.
        const { resourceType: _pRt, id: _pId, ...safePatch } = (patch ?? {}) as Record<string, unknown>;
        const amendedBody: Record<string, unknown> = {
          ...base,
          ...safePatch,
          id,
          status,
          meta: { ...(base.meta as Record<string, unknown> | undefined), versionId: String(amendedVersion), lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType, id, version: amendedVersion, body: amendedBody, siteId });

        const provBody: Record<string, unknown> = {
          resourceType: 'Provenance',
          id: provenanceId,
          target: [{ reference: `${resourceType}/${id}` }],
          recorded: nowIso,
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: activityCode.toUpperCase(), display: activityCode.toLowerCase() }] },
          agent: [{ who: { display: agent } }],
          ...(reason ? { reason: [{ text: reason }] } : {}),
          meta: { versionId: '1', lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType: 'Provenance', id: provenanceId, version: 1, body: provBody, siteId });

        await trx
          .insertInto('sync_amendments')
          .values([
            { site_id: siteId, resource_type: resourceType, resource_id: id, version: amendedVersion },
            { site_id: siteId, resource_type: 'Provenance', resource_id: provenanceId, version: 1 },
          ])
          .execute();

        return { version: amendedVersion, provenanceId, siteId };
      });
      // Best-effort projection-worker wakeup; interval polling is the correctness path (matches save()).
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },

    async correct(input) {
      const { resourceType, id, next } = input;
      // Every check that needs no database runs first, so a refusal opens no transaction.
      if (!CORRECTABLE_TYPES.has(resourceType)) {
        throw new CorrectionError('type', `${resourceType} cannot be corrected (allowed: ${[...CORRECTABLE_TYPES].join(', ')})`);
      }
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (reason.length < 1 || reason.length > CORRECTION_REASON_MAX) {
        throw new CorrectionError('reason', `a correction needs a reason of 1 to ${CORRECTION_REASON_MAX} characters`);
      }
      const who = typeof input.who === 'string' ? input.who.trim() : '';
      if (!who) throw new CorrectionError('invalid', 'a correction needs the name of who made it');
      if (next?.resourceType !== resourceType || next?.id !== id) {
        throw new CorrectionError('invalid', `the new body must be ${resourceType}/${id}`);
      }
      const checked = validateResource(next);
      if (!checked.ok) {
        const issues = checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; ');
        throw new CorrectionError('invalid', `${resourceType}/${id} is not valid: ${issues}`);
      }

      const site = await resolveSiteId();
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<CorrectResult> => {
        const cur = await trx
          .selectFrom('fhir.fhir_current')
          .select(['source_system', 'plugin_id', 'plugin_version', 'batch_id'])
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!cur) throw new CorrectionError('not-found', `${resourceType}/${id} not found`);

        // The record keeps where it came from: writeMany sets the provenance columns on the
        // current row, so passing {} here would blank the source system and batch.
        const { refs } = await writeMany(trx, [next as FhirResource], provenanceFromRow(cur), site, false);
        const version = refs[0].version;

        const nowIso = new Date().toISOString();
        const activity = input.activity === 'amend'
          ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'UPDATE' }], text: 'amend' }
          : { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'UPDATE' }] };
        const provBody: FhirResource = {
          resourceType: 'Provenance',
          id: provenanceId,
          target: [{ reference: `${resourceType}/${id}/_history/${version}` }],
          recorded: nowIso,
          activity,
          agent: [{ who: { display: who } }],
          reason: [{ text: reason }],
        };
        // Built here, so a failure is a bug in this method. Throwing rolls the new version back.
        const provChecked = validateResource(provBody);
        if (!provChecked.ok) throw new Error(`correct built an invalid Provenance: ${JSON.stringify(provChecked.outcome.issue)}`);
        await writeMany(trx, [provBody], {}, site, false);

        const saved = await trx
          .selectFrom('fhir.fhir_resources')
          .select('resource')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        return { resource: saved.resource as Record<string, unknown>, provenanceId, version };
      });
      // Best-effort projection-worker wakeup; interval polling is the correctness path (matches saveMany).
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },

    async mergePatients(input) {
      const { survivorId, duplicateId, agent, reason, referencingRefs } = input;
      if (survivorId === duplicateId) throw new SamePatientError('survivor and duplicate are the same patient');
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<MergeResult> => {
        const dupRow = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Patient').where('id', '=', duplicateId).executeTakeFirst();
        if (!dupRow) throw new PatientNotFoundError(`Patient/${duplicateId} not found`);
        const survRow = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Patient').where('id', '=', survivorId).executeTakeFirst();
        if (!survRow) throw new PatientNotFoundError(`Patient/${survivorId} not found`);

        const site = await latestSite(trx, 'Patient', duplicateId);
        const survSite = await latestSite(trx, 'Patient', survivorId);
        if (!site || !survSite || site !== survSite) throw new CrossSiteMergeError('patients are not owned by the same site');

        const nowIso = new Date().toISOString();
        const targets: { reference: string }[] = [];
        const outboxRows: { site_id: string; resource_type: string; resource_id: string; version: number }[] = [];

        // Idempotency: a re-run (to pick up late-projected refs) must not append another identical
        // replaced-by link or re-bump the already-merged duplicate. Skip the Patient re-write when it's
        // already inactive AND already links replaced-by → this survivor.
        const dupBody = dupRow.resource as Record<string, unknown>;
        const existingLinks = Array.isArray(dupBody['link']) ? (dupBody['link'] as unknown[]) : [];
        const alreadyReplaced = dupBody['active'] === false && existingLinks.some(
          (l) => (l as Record<string, unknown> | null)?.['type'] === 'replaced-by'
            && ((l as Record<string, unknown>)?.['other'] as Record<string, unknown> | undefined)?.['reference'] === `Patient/${survivorId}`,
        );
        let patientChanged = !alreadyReplaced;
        if (!alreadyReplaced) {
          const dupVersion = await nextVersion(trx, 'Patient', duplicateId);
          const dupNew: Record<string, unknown> = {
            ...dupBody, id: duplicateId, active: false,
            link: [...existingLinks, { type: 'replaced-by', other: { reference: `Patient/${survivorId}` } }],
            meta: { ...(dupBody['meta'] as Record<string, unknown> | undefined), versionId: String(dupVersion), lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: 'Patient', id: duplicateId, version: dupVersion, body: dupNew, siteId: site });
          targets.push({ reference: `Patient/${duplicateId}` });
          outboxRows.push({ site_id: site, resource_type: 'Patient', resource_id: duplicateId, version: dupVersion });
        }

        let repointed = 0;
        // Two guards enforce the intra-lab + subject-based invariant the primitive trusts the caller for:
        // (1) only re-point subject-bearing lab-data types, (2) never re-stamp a resource owned by a
        // different site. Anything failing either is skipped (uncounted) rather than trusted blindly.
        for (const ref of referencingRefs) {
          if (!MERGE_REF_TYPES.has(ref.resourceType)) continue; // only subject-bearing lab-data types
          const row = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', ref.resourceType).where('id', '=', ref.id).executeTakeFirst();
          if (!row) continue; // stale read-model entry
          const refSite = await latestSite(trx, ref.resourceType, ref.id);
          if (refSite !== site) continue; // defense: never re-stamp a cross-site resource (intra-lab only)
          const body = row.resource as Record<string, unknown>;
          // Idempotency: a ref already pointing at the survivor was re-pointed on a prior run — don't
          // re-bump it (uncounted).
          const curSubjectRef = (body['subject'] as Record<string, unknown> | undefined)?.['reference'];
          if (curSubjectRef === `Patient/${survivorId}`) continue;
          const v = await nextVersion(trx, ref.resourceType, ref.id);
          const newBody: Record<string, unknown> = {
            ...body, id: ref.id, subject: { reference: `Patient/${survivorId}` },
            meta: { ...(body['meta'] as Record<string, unknown> | undefined), versionId: String(v), lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: ref.resourceType, id: ref.id, version: v, body: newBody, siteId: site });
          targets.push({ reference: `${ref.resourceType}/${ref.id}` });
          outboxRows.push({ site_id: site, resource_type: ref.resourceType, resource_id: ref.id, version: v });
          repointed++;
        }

        // Only author the merge Provenance (and its outbox row) when the run actually changed something.
        // A full no-op re-run writes nothing and returns an empty provenanceId.
        let writtenProvenanceId = '';
        if (patientChanged || repointed > 0) {
          const provBody: Record<string, unknown> = {
            resourceType: 'Provenance', id: provenanceId, target: targets, recorded: nowIso,
            activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'MERGE', display: 'merge' }] },
            agent: [{ who: { display: agent } }],
            ...(reason ? { reason: [{ text: reason }] } : {}),
            meta: { versionId: '1', lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: 'Provenance', id: provenanceId, version: 1, body: provBody, siteId: site });
          outboxRows.push({ site_id: site, resource_type: 'Provenance', resource_id: provenanceId, version: 1 });
          writtenProvenanceId = provenanceId;
        }

        if (outboxRows.length > 0) await trx.insertInto('sync_amendments').values(outboxRows).execute();

        return { survivorId, duplicateId, repointed, provenanceId: writtenProvenanceId, siteId: site };
      });
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },
  };
}
