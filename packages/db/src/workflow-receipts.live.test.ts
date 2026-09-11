import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { InternalSchema } from '@openldr/db';
import * as outbox from './migrations/internal/002_outbox';
import * as workflows from './migrations/internal/027_workflows';
import * as runs from './migrations/internal/028_workflow_runs';
import * as correlation from './migrations/internal/039_workflow_runs_correlation';
import * as token from './migrations/internal/094_outbox_claim_token';
import * as receipts from './migrations/internal/097_workflow_webhook_receipts';
import { createWorkflowReceiptService, WebhookIdempotencyConflictError } from '../../workflows/src/receipt-service';

const url = process.env.WEBHOOK_TEST_DATABASE_URL;
describe.skipIf(!url)('durable webhook receipts on disposable PostgreSQL', () => {
  let db: Kysely<InternalSchema>;
  let admin: pg.Pool;
  let schema: string;
  let disconnectExpected: boolean;
  let effect: number;
  let historyQuery: { sql: string; parameters: readonly unknown[] } | undefined;
  const children: ChildProcess[] = [];
  let service: ReturnType<typeof createWorkflowReceiptService>;
  let handler: () => Promise<void>;
  beforeEach(async () => {
    schema = `receipt_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    disconnectExpected = false;
    const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    const connectionError = (error: Error) => { if (!disconnectExpected || !/terminat/i.test(error.message)) throw error; };
    pool.on('error', connectionError);
    pool.on('connect', client => client.on('error', connectionError));
    db = new Kysely<InternalSchema>({ log: event => { if (event.level === 'query' && event.query.sql.startsWith('select') && event.query.sql.includes('order by') && event.query.sql.includes('workflow_webhook_receipts')) historyQuery = event.query; }, dialect: new PostgresDialect({ pool }) });
    for (const migration of [outbox, workflows, runs, correlation, token, receipts]) await migration.up(db as Kysely<unknown>);
    await sql`insert into workflows(id,name,definition) values ('w','test','{"nodes":[],"edges":[]}')`.execute(db);
    effect = 0;
    service = createWorkflowReceiptService({ db, execute: async (_wf, runId) => {
      effect++;
      return { id: runId, workflowId: 'w', triggerSource: 'webhook', status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result: { results: [{ nodeId: 'n', meta: { clinical: 'private' } }] }, error: null };
    } });
  });
  afterEach(async () => { for (const child of children.splice(0)) { if (child.exitCode === null) child.kill(); } await db?.destroy(); if (admin) { await admin.query(`drop schema ${schema} cascade`); await admin.end(); } });
  async function deliver(id: string, claim = 'owner1') {
    await sql`update outbox_events set status='processing',claim_token=${claim}`.execute(db);
    const event = await db.selectFrom('outbox_events').select('id').executeTakeFirstOrThrow();
    await service.register({ subscribe: async (_type: string, fn: any) => { handler = () => fn({ type: 'workflow.webhook.accepted', payload: { receiptId: id }, delivery: { id: event.id, claimToken: claim } }); } } as any);
    await handler();
  }
  function worker(mode: string) {
    const child = fork(fileURLToPath(new URL('./test-fixtures/receipt-worker.ts', import.meta.url)), [schema, mode], {
      execArgv: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],
      env: { ...process.env, WEBHOOK_TEST_DATABASE_URL: url }, silent: true,
    });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk; });
    const wait = (message: string) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Worker timeout ${mode}: ${stderr}`)), 25000);
      child.on('message', value => {
        if (value === message) { clearTimeout(timer); resolve(); }
        if (typeof value === 'object' && value && 'error' in value) { clearTimeout(timer); reject(new Error(String(value.error))); }
      });
      child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Worker exited ${code}: ${stderr}`)); } });
    });
    return { child, wait };
  }
  it('recovers queued receipts after process death without notification delivery', async () => {
    await sql`create table receipt_test_effects (receipt_run_id text not null)`.execute(db);
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    const first = worker('before-claim');
    await first.wait('ready');
    first.child.kill();
    const second = worker('complete');
    await second.wait('complete');
    expect((await service.get(receipt.id))?.status).toBe('completed');
    expect((await sql`select * from receipt_test_effects`.execute(db)).rows).toHaveLength(1);
  }, 60000);
  it.each(['before-effect', 'after-effect'])('does not replay after killing a process %s', async mode => {
    await sql`create table receipt_test_effects (receipt_run_id text not null)`.execute(db);
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    const first = worker(mode);
    await first.wait(mode === 'after-effect' ? 'effect' : 'started');
    const exited = new Promise<void>(resolve => first.child.once('exit', () => resolve()));
    first.child.kill(); await exited;
    await sql`update outbox_events set updated_at=now()-interval '10 seconds'`.execute(db);
    const second = worker('complete');
    await second.wait('complete');
    expect((await service.get(receipt.id))?.status).toBe('interrupted');
    expect((await sql`select * from receipt_test_effects`.execute(db)).rows).toHaveLength(mode === 'after-effect' ? 1 : 0);
    expect(await db.selectFrom('workflow_runs').selectAll().execute()).toEqual([]);
  }, 60000);
  it('lets two independent worker processes produce only one effect', async () => {
    await sql`create table receipt_test_effects (receipt_run_id text not null)`.execute(db);
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    const first = worker('complete');
    const second = worker('complete');
    await Promise.all([first.wait('complete'), second.wait('complete')]);
    expect((await service.get(receipt.id))?.status).toBe('completed');
    expect((await sql`select * from receipt_test_effects`.execute(db)).rows).toHaveLength(1);
  }, 60000);
  it('uses indexed bounded metadata reads with stable pagination for tied timestamps', async () => {
    await sql`insert into workflow_webhook_receipts(id,workflow_id,event_id,run_id,input_digest,definition_digest,input,files,status,created_at)
      select 'r' || lpad(n::text,5,'0'),'w','e' || n,'run' || n,'digest','definition','{}','{}','completed','2026-01-01'::timestamptz from generate_series(1,1200) n`.execute(db);
    await sql`analyze workflow_webhook_receipts`.execute(db);
    const first = await service.list('w', { limit: 101, offset: 0 });
    expect(first).toHaveLength(101);
    expect(first[0].id).toBe('r01200');
    expect(first[100].id).toBe('r01100');
    const query = historyQuery!;
    expect(query.sql).not.toContain('"input"');
    expect(query.sql).not.toContain('"files"');
    const plan = await db.executeQuery(CompiledQuery.raw('explain (format json) ' + query.sql, [...query.parameters]));
    expect(JSON.stringify(plan.rows)).toContain('idx_workflow_webhook_receipts_history');
    expect(JSON.stringify(plan.rows)).toContain('Limit');
    const second = await service.list('w', { limit: 101, offset: 101 });
    expect(second[0].id).toBe('r01099');
    await expect(service.list('w', { limit: 102 })).rejects.toThrow();
    await expect(service.list('w', { offset: -1 })).rejects.toThrow();
  });
  it.each(['', 'a b', 'a'.repeat(201)])('rejects malformed idempotency key %s before acceptance', async idempotencyKey => {
    await expect(service.accept({ workflowId: 'w', input: {}, idempotencyKey })).rejects.toThrow();
    expect(await service.list('w')).toEqual([]);
  });
  it('rejects unavailable binary content without accepting work', async () => {
    service = createWorkflowReceiptService({ db, readBinary: async () => { throw new Error('blob unavailable'); }, execute: async () => { throw new Error('must not run'); } });
    await expect(service.accept({ workflowId: 'w', input: {}, files: { file: { objectKey: 'absent', byteSize: 2, contentType: 'text/plain' } } })).rejects.toThrow('blob unavailable');
    expect(await service.list('w')).toEqual([]);
  });
  it.each(['disabled', 'deleted'])('cancels a queued receipt when its workflow becomes %s', async change => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    if (change === 'disabled') await sql`update workflows set enabled=false`.execute(db);
    else await sql`delete from workflows`.execute(db);
    await deliver(receipt.id);
    expect(effect).toBe(0);
    expect((await service.get(receipt.id))?.status).toBe('cancelled');
  });
  it('atomically creates one receipt and event under concurrent retries and rejects changed data', async () => {
    const all = await Promise.all(Array.from({ length: 12 }, () => service.accept({ workflowId: 'w', input: { body: { value: 1 } }, idempotencyKey: 'key' })));
    expect(new Set(all.map(a => a.receipt.id)).size).toBe(1);
    expect(all.filter(a => a.created)).toHaveLength(1);
    expect((await db.selectFrom('outbox_events').selectAll().execute())).toHaveLength(1);
    await expect(service.accept({ workflowId: 'w', input: { body: { value: 2 } }, idempotencyKey: 'key' })).rejects.toBeInstanceOf(WebhookIdempotencyConflictError);
    expect(await service.get(all[0].receipt.id)).not.toHaveProperty('input');
    await sql`delete from workflows where id='w'`.execute(db);
    expect((await service.get(all[0].receipt.id))?.status).toBe('queued');
  });
  it('does not let an old handler adopt a replacement claim', async () => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    const event = await db.selectFrom('outbox_events').select('id').executeTakeFirstOrThrow();
    await sql`update outbox_events set status='processing',claim_token='replacement'`.execute(db);
    await service.register({ subscribe: async (_type: string, fn: any) => { handler = () => fn({ type: 'workflow.webhook.accepted', payload: { receiptId: receipt.id }, delivery: { id: event.id, claimToken: 'old' } }); } } as any);
    await handler();
    expect(effect).toBe(0);
    expect((await service.get(receipt.id))?.status).toBe('queued');
  });
  it('classifies a started receipt when the outbox can no longer deliver', async () => {
    for (const terminal of ['done', 'failed']) {
      const { receipt } = await service.accept({ workflowId: 'w', input: {} });
      await sql`update workflow_webhook_receipts set status='running',started_at=now(),claim_token='dead' where id=${receipt.id}`.execute(db);
      await sql`update outbox_events set status=${terminal}`.execute(db);
      expect((await service.get(receipt.id))?.status).toBe('interrupted');
    }
  });
  it.each(['queued', 'running'])('resolves %s receipts when dispatch has ended or disappeared', async status => {
    for (const terminal of ['failed', 'done', 'missing']) {
      const { receipt } = await service.accept({ workflowId: 'w', input: {} });
      await sql`update workflow_webhook_receipts set status=${status} where id=${receipt.id}`.execute(db);
      if (terminal === 'missing') await sql`delete from outbox_events`.execute(db);
      else await sql`update outbox_events set status=${terminal}`.execute(db);
      expect((await service.get(receipt.id))?.status).toBe(status === 'queued' ? 'cancelled' : 'interrupted');
    }
  });
  it('does not accept when PostgreSQL disconnects during the acceptance transaction', async () => {
    disconnectExpected = true;
    await sql`create function receipt_test_disconnect() returns trigger language plpgsql as $$ begin perform pg_terminate_backend(pg_backend_pid()); return new; end $$`.execute(db);
    await sql`create trigger receipt_test_disconnect before insert on outbox_events for each row execute function receipt_test_disconnect()`.execute(db);
    await expect(service.accept({ workflowId: 'w', input: {} })).rejects.toThrow();
    expect(await service.list('w')).toEqual([]);
    expect(await db.selectFrom('outbox_events').select('id').execute()).toEqual([]);
  });
  it('rolls acceptance back if the outbox insertion fails', async () => {
    await sql`alter table outbox_events add constraint reject_receipts check(type <> 'workflow.webhook.accepted')`.execute(db);
    await expect(service.accept({ workflowId: 'w', input: {} })).rejects.toThrow();
    expect(await service.list('w', {})).toEqual([]);
  });
  it('records a reserved run and receipt together and never executes terminal redelivery', async () => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    await deliver(receipt.id);
    await deliver(receipt.id, 'owner2');
    expect(effect).toBe(1);
    expect(await service.get(receipt.id)).toMatchObject({ status: 'completed', runId: receipt.runId });
    expect((await db.selectFrom('workflow_runs').selectAll().execute()).map(r => r.id)).toEqual([receipt.runId]);
    expect((await service.get(receipt.id))?.outcome?.nodeMeta).toEqual({});
    expect((await db.selectFrom('workflow_runs').select('result').executeTakeFirstOrThrow()).result).toMatchObject({ results: [{ meta: { clinical: 'private' } }] });
  });
  it('cancels changed definitions before any effects', async () => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    await sql`update workflows set definition='{"nodes":[{"id":"new","type":"trigger"}],"edges":[]}'`.execute(db);
    await deliver(receipt.id);
    expect(effect).toBe(0);
    expect((await service.get(receipt.id))?.status).toBe('cancelled');
  });
  it('marks a previous start interrupted after claim replacement without replay', async () => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    await sql`update workflow_webhook_receipts set status='running',started_at=now(),claim_token='dead' where id=${receipt.id}`.execute(db);
    await deliver(receipt.id, 'replacement');
    expect(effect).toBe(0);
    expect((await service.get(receipt.id))?.status).toBe('interrupted');
  });
  it('fences late completion after ownership changes', async () => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    service = createWorkflowReceiptService({ db, execute: async (_wf, runId) => {
      effect++; entered(); await waiting;
      return { id: runId, workflowId: 'w', triggerSource: 'webhook', status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result: {}, error: null };
    } });
    const first = deliver(receipt.id);
    await started;
    await deliver(receipt.id, 'replacement');
    release(); await first;
    expect(effect).toBe(1);
    expect((await service.get(receipt.id))?.status).toBe('interrupted');
    expect(await db.selectFrom('workflow_runs').selectAll().execute()).toEqual([]);
  });
  it('keeps run and outcome absent when final transaction fails then interrupts redelivery', async () => {
    const { receipt } = await service.accept({ workflowId: 'w', input: {} });
    disconnectExpected = true;
    await sql`create function receipt_test_disconnect() returns trigger language plpgsql as $$ begin perform pg_terminate_backend(pg_backend_pid()); return new; end $$`.execute(db);
    await sql`create trigger receipt_test_disconnect before insert on workflow_runs for each row execute function receipt_test_disconnect()`.execute(db);
    await expect(deliver(receipt.id)).rejects.toThrow();
    expect((await service.get(receipt.id))?.status).toBe('running');
    expect(await db.selectFrom('workflow_runs').selectAll().execute()).toEqual([]);
    await deliver(receipt.id, 'replacement');
    expect(effect).toBe(1);
    expect((await service.get(receipt.id))?.status).toBe('interrupted');
  });
});
