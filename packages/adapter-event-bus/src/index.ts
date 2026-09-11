import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { probe, errorMessage, redact } from '@openldr/core';
import type { EventEnvelope, EventHandler, EventingPort, PublishOptions } from '@openldr/ports';
import { backoff } from './backoff';

export interface EventBusConfig {
  url: string;
  /**
   * Lease window in ms. A row in `status='processing'` whose `updated_at` is
   * older than this is presumed orphaned (the worker crashed between the claim
   * commit and the terminal update) and is reclaimed as a retry. Default 5 min.
   */
  leaseMs?: number;
}

const DEFAULT_LEASE_MS = 300_000;

export interface EventBusDeps {
  pool?: pg.Pool;
}

export interface DrainResult {
  processed: number;
  failed: number;
}

export interface EventBus extends EventingPort {
  /** Overlapping calls share the active batch and its result. Its first caller sets the limit. */
  drain(opts?: { limit?: number }): Promise<DrainResult>;
  startWorker(opts?: { intervalMs?: number }): { stop(): Promise<void> };
  stats(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

interface ClaimedRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  claim_token: string;
}

export function createEventBus(cfg: EventBusConfig, deps: EventBusDeps = {}): EventBus {
  const leaseMs = cfg.leaseMs ?? DEFAULT_LEASE_MS;
  // Node timers overflow above a signed 32-bit delay. Renewal uses leaseMs / 3.
  if (!Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > 3 * 2_147_483_647) {
    throw new RangeError('leaseMs must be positive, finite, and at most 6442450941');
  }
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });
  const handlers = new Map<string, EventHandler>();
  let activeDrain: Promise<DrainResult> | undefined;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const workers = new Set<{ stop(): Promise<void> }>();

  async function publish(event: EventEnvelope, opts: PublishOptions = {}): Promise<void> {
    const id = randomUUID();
    const batchId = (event.payload as { batchId?: string } | null)?.batchId ?? null;
    if (opts.availableAt) {
      await pool.query(
        `insert into outbox_events (id, type, payload, batch_id, available_at) values ($1, $2, $3, $4, $5)`,
        [id, event.type, JSON.stringify(event.payload), batchId, opts.availableAt.toISOString()],
      );
    } else {
      await pool.query(
        `insert into outbox_events (id, type, payload, batch_id) values ($1, $2, $3, $4)`,
        [id, event.type, JSON.stringify(event.payload), batchId],
      );
    }
    await pool.query(`select pg_notify('openldr_events', $1)`, [event.type]);
  }

  async function subscribe(type: string, handler: EventHandler): Promise<void> {
    handlers.set(type, handler);
  }

  async function claim(limit: number): Promise<ClaimedRow[]> {
    const token = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Row locks protect claim changes until commit. Renewals protect the lease
      // after commit; the token prevents an older owner from changing a new claim.
      const res = await client.query(
        `select id, type, payload, attempts, max_attempts, status from outbox_events
         where (status='pending' and available_at <= now())
            or (status='processing' and updated_at < now() - ($2 || ' milliseconds')::interval)
         order by available_at, id limit $1 for update skip locked`,
        [limit, String(leaseMs)],
      );
      const rows = res.rows as Array<ClaimedRow & { status: string }>;
      const freshIds: string[] = [];
      const claimed: ClaimedRow[] = [];
      for (const row of rows) {
        if (row.status === 'pending') {
          freshIds.push(row.id);
          claimed.push({
            id: row.id,
            type: row.type,
            payload: row.payload,
            attempts: row.attempts,
            max_attempts: row.max_attempts,
            claim_token: token,
          });
          continue;
        }
        // Stale 'processing' row: count the crash as a failed attempt.
        const attempts = row.attempts + 1;
        if (attempts < row.max_attempts) {
          await client.query(
            `update outbox_events set status='processing', attempts=$2, claim_token=$3, updated_at=now() where id=$1`,
            [row.id, attempts, token],
          );
          claimed.push({ id: row.id, type: row.type, payload: row.payload, attempts, max_attempts: row.max_attempts, claim_token: token });
        } else {
          await client.query(
            `update outbox_events set status='failed', attempts=$2, last_error=$3, claim_token=null, updated_at=now() where id=$1`,
            [row.id, attempts, 'lease expired: worker presumed crashed while processing'],
          );
        }
      }
      if (freshIds.length > 0) {
        await client.query(`update outbox_events set status='processing', claim_token=$2, updated_at=now() where id = any($1::text[])`, [
          freshIds, token,
        ]);
      }
      await client.query('commit');
      return claimed;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  function drain(opts: { limit?: number } = {}): Promise<DrainResult> {
    if (closing) return Promise.reject(new Error('event bus is closing'));
    if (activeDrain) return activeDrain;
    activeDrain = drainBatch(opts).finally(() => {
      activeDrain = undefined;
    });
    return activeDrain;
  }

  async function drainBatch(opts: { limit?: number } = {}): Promise<DrainResult> {
    const rows = await claim(opts.limit ?? 20);
    let processed = 0;
    let failed = 0;
    // Renew the whole batch, including rows waiting behind a slow handler.
    // A failed renewal leaves reclamation possible, but cannot grant ownership back.
    let renewing: Promise<unknown> | undefined;
    const timer = rows.length === 0 ? undefined : setInterval(() => {
      if (renewing) return;
      renewing = pool.query(
        `update outbox_events set updated_at=now()
         where id = any($1::text[]) and status='processing' and claim_token=$2`,
        [rows.map((row) => row.id), rows[0].claim_token],
      ).catch(() => undefined).finally(() => { renewing = undefined; });
    }, Math.max(1, Math.floor(leaseMs / 3)));
    timer?.unref();
    try {
      for (const row of rows) {
        const ownership = await pool.query(
          `update outbox_events set updated_at=now() where id=$1 and status='processing' and claim_token=$2`,
          [row.id, row.claim_token],
        );
        if (ownership.rowCount !== 1) continue;
        const handler = handlers.get(row.type);
        if (!handler) {
          // No subscriber yet: requeue, but defer availability so a stray/misrouted
          // type can't busy-loop (re-claimed every drain + every notify) consuming a slot.
          await pool.query(
            `update outbox_events set status='pending', claim_token=null, available_at = now() + interval '60 seconds', updated_at=now() where id=$1 and status='processing' and claim_token=$2`,
            [row.id, row.claim_token],
          );
          continue;
        }
        try {
          await handler({ type: row.type, payload: row.payload, delivery: { id: row.id, claimToken: row.claim_token } });
          const result = await pool.query(`update outbox_events set status='done', claim_token=null, updated_at=now() where id=$1 and status='processing' and claim_token=$2`, [row.id, row.claim_token]);
          processed += result.rowCount ?? 0;
        } catch (err) {
          const attempts = row.attempts + 1;
          const msg = redact(errorMessage(err));
          if (attempts < row.max_attempts) {
            await pool.query(
              `update outbox_events set status='pending', claim_token=null, attempts=$2,
               available_at = now() + ($3 || ' milliseconds')::interval, last_error=$4, updated_at=now() where id=$1 and status='processing' and claim_token=$5`,
              [row.id, attempts, String(backoff(attempts)), msg, row.claim_token],
            );
          } else {
            const result = await pool.query(
              `update outbox_events set status='failed', claim_token=null, attempts=$2, last_error=$3, updated_at=now() where id=$1 and status='processing' and claim_token=$4`,
              [row.id, attempts, msg, row.claim_token],
            );
            failed += result.rowCount ?? 0;
          }
        }
      }
    } finally {
      if (timer) clearInterval(timer);
      await renewing;
    }
    return { processed, failed };
  }

  function startWorker(opts: { intervalMs?: number } = {}): { stop(): Promise<void> } {
    if (closing) throw new Error('event bus is closing');
    const intervalMs = opts.intervalMs ?? 2000;
    let stopped = false;
    let stopPromise: Promise<void> | undefined;
    let listenClient: pg.PoolClient | undefined;
    const tick = () => {
      if (stopped || closing) return;
      void drain().catch(() => undefined);
    };
    // Acquire the LISTEN client asynchronously. `.catch` prevents an unhandled
    // rejection if connect/listen fails; `ready` lets stop() await an in-flight
    // acquisition so a fast start→stop never leaks a still-connecting client.
    const ready = (async () => {
      const client = await pool.connect();
      if (stopped) {
        client.release();
        return;
      }
      listenClient = client;
      await listenClient.query('listen openldr_events');
      if (!stopped) listenClient.on('notification', tick);
    })().catch(() => undefined);
    const timer = setInterval(tick, intervalMs);
    const worker = {
      stop(): Promise<void> {
        if (stopPromise) return stopPromise;
        stopped = true;
        clearInterval(timer);
        const draining = activeDrain;
        stopPromise = (async () => {
          await ready;
          if (listenClient) {
            listenClient.removeListener('notification', tick);
            try {
              await listenClient.query('unlisten openldr_events');
              listenClient.release();
            } catch {
              listenClient.release(true);
            }
            listenClient = undefined;
          }
          await draining?.catch(() => undefined);
          workers.delete(worker);
        })();
        return stopPromise;
      },
    };
    workers.add(worker);
    return worker;
  }

  async function stats(): Promise<Record<string, number>> {
    const res = await pool.query(`select status, count(*)::int as count from outbox_events group by status`);
    const out: Record<string, number> = {};
    for (const r of res.rows as Array<{ status: string; count: number }>) out[r.status] = r.count;
    return out;
  }

  return {
    publish,
    subscribe,
    drain,
    startWorker,
    stats,
    async healthCheck() {
      return probe(async () => {
        await pool.query("select pg_notify('openldr_health', 'ping')");
        return 'pg_notify reachable';
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.all([...workers].map((worker) => worker.stop()));
        await activeDrain?.catch(() => undefined);
        await pool.end();
      })();
      return closePromise;
    },
  };
}
