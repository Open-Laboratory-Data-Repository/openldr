import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface MarketplaceInstallRow {
  artifactId: string;
  version: string;
  kind: string;
  targetFormId: string | null;
  payloadSha256: string;
  publisherName: string | null;
  sourceRef: string | null;
  installedBy: string | null;
  status: 'installed' | 'failed';
  failedStep: number | null;
  error: string | null;
  installedAt: string;
  updatedAt: string;
}

export interface MarketplaceInstallInput {
  artifactId: string;
  version: string;
  kind: string;
  targetFormId?: string | null;
  payloadSha256: string;
  publisherName?: string | null;
  sourceRef?: string | null;
  installedBy?: string | null;
  status?: 'installed' | 'failed';
  failedStep?: number | null;
  error?: string | null;
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function createMarketplaceInstallStore(db: Kysely<InternalSchema>) {
  const toRow = (r: {
    artifact_id: string; version: string; kind: string; target_form_id: string | null; payload_sha256: string;
    publisher_name: string | null; source_ref: string | null; installed_by: string | null;
    status: string; failed_step: number | null; error: string | null;
    installed_at: unknown; updated_at: unknown;
  }): MarketplaceInstallRow => ({
    artifactId: r.artifact_id, version: r.version, kind: r.kind, targetFormId: r.target_form_id,
    payloadSha256: r.payload_sha256, publisherName: r.publisher_name, sourceRef: r.source_ref,
    installedBy: r.installed_by,
    status: r.status === 'failed' ? 'failed' : 'installed', failedStep: r.failed_step, error: r.error,
    installedAt: toTimestamp(r.installed_at), updatedAt: toTimestamp(r.updated_at),
  });

  async function upsert(input: MarketplaceInstallInput): Promise<void> {
    await db.insertInto('marketplace_installs')
      .values({
        artifact_id: input.artifactId, version: input.version, kind: input.kind,
        target_form_id: input.targetFormId ?? null, payload_sha256: input.payloadSha256,
        publisher_name: input.publisherName ?? null, source_ref: input.sourceRef ?? null,
        installed_by: input.installedBy ?? null,
        status: input.status ?? 'installed', failed_step: input.failedStep ?? null, error: input.error ?? null,
      } as never)
      .onConflict((oc) => oc.column('artifact_id').doUpdateSet({
        version: input.version, target_form_id: input.targetFormId ?? null, payload_sha256: input.payloadSha256,
        publisher_name: input.publisherName ?? null, source_ref: input.sourceRef ?? null,
        status: input.status ?? 'installed', failed_step: input.failedStep ?? null, error: input.error ?? null,
        updated_at: sql`now()`,
      } as never))
      .execute();
  }

  async function get(artifactId: string): Promise<MarketplaceInstallRow | null> {
    const r = await db.selectFrom('marketplace_installs').selectAll().where('artifact_id', '=', artifactId).executeTakeFirst();
    return r ? toRow(r as never) : null;
  }

  async function list(): Promise<MarketplaceInstallRow[]> {
    const rows = await db.selectFrom('marketplace_installs').selectAll().orderBy('installed_at', 'desc').execute();
    return rows.map((r) => toRow(r as never));
  }

  async function remove(artifactId: string): Promise<void> {
    await db.deleteFrom('marketplace_installs').where('artifact_id', '=', artifactId).execute();
  }

  return { upsert, get, list, remove };
}

export type MarketplaceInstallStore = ReturnType<typeof createMarketplaceInstallStore>;
