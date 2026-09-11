import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,unlink,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Fastify, {type FastifyInstance} from 'fastify';
import {Kysely,sql} from 'kysely';
import {createInternalDb,type InternalDb,type InternalSchema} from '@openldr/db';
import type {AppContext} from '@openldr/bootstrap';
import {createEventBus,type EventBus} from '../../../packages/adapter-event-bus/src/index';
import {createWorkflowReceiptService} from '../../../packages/workflows/src/receipt-service';
import * as outbox from '../../../packages/db/src/migrations/internal/002_outbox';
import * as workflows from '../../../packages/db/src/migrations/internal/027_workflows';
import * as runs from '../../../packages/db/src/migrations/internal/028_workflow_runs';
import * as correlation from '../../../packages/db/src/migrations/internal/039_workflow_runs_correlation';
import * as token from '../../../packages/db/src/migrations/internal/094_outbox_claim_token';
import * as receipts from '../../../packages/db/src/migrations/internal/097_workflow_webhook_receipts';
import {registerWorkflowRoutes} from './workflows-routes';
const url=process.env.WEBHOOK_TEST_DATABASE_URL;
async function acceptance(response:Response) { return await response.json() as {requestId:string;statusUrl:string}; }
describe.skipIf(!url)('durable receipt HTTP on disposable PostgreSQL',()=>{
 let admin:InternalDb,internal:InternalDb,db:Kysely<InternalSchema>,bus:EventBus,app:FastifyInstance,schema:string,address:string,effects:number,blobDir:string,receivedBytes:string;
 beforeEach(async()=>{
  schema='p05_http_'+randomUUID().replaceAll('-','');
  admin=createInternalDb(url!);await sql`create schema ${sql.id(schema)}`.execute(admin.db);
  const scoped=new URL(url!);scoped.searchParams.set('options',`-c search_path=${schema}`);
  internal=createInternalDb(scoped.toString());db=internal.db;
  for(const m of [outbox,workflows,runs,correlation,token,receipts])await m.up(db as Kysely<unknown>);
  await sql`insert into workflows(id,name,definition) values ('wf','test','{"nodes":[],"edges":[]}')`.execute(db);
  effects=0;receivedBytes='';blobDir=await mkdtemp(join(tmpdir(),'p05-receipt-http-'));
  const objectPath=(key:string)=>join(blobDir,createHash('sha256').update(key).digest('hex'));
  const blob={put:async(key:string,bytes:Uint8Array)=>{await writeFile(objectPath(key),bytes);},get:async(key:string)=>readFile(objectPath(key)),delete:async(key:string)=>unlink(objectPath(key))};
  const service=createWorkflowReceiptService({db,readBinary:blob.get,execute:async(_definition,id,_workflowId,_input,files)=>{
   effects++;if(files.file)receivedBytes=(await blob.get(files.file.objectKey)).toString();
   return {id,workflowId:'wf',triggerSource:'webhook',status:'completed',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),result:{results:[]},error:null};
  }});
  bus=createEventBus({url:scoped.toString()});await service.register(bus);
  app=Fastify();app.addHook('onRequest',async req=>{req.user={id:'operator',username:'operator',roles:[],capabilities:['workflows.view']} as never;});
  registerWorkflowRoutes(app,{workflows:{receipts:service,webhooks:{resolve:async()=>({workflowId:'wf',secret:'token'})}},cfg:{WORKFLOW_FILE_MAX_BYTES:1024},blob} as unknown as AppContext);
  address=await app.listen({host:'127.0.0.1',port:0});
 });
 afterEach(async()=>{await app?.close();await bus?.close();await internal?.close();if(admin){await sql`drop schema ${sql.id(schema)} cascade`.execute(admin.db);await admin.close();}if(blobDir && resolve(blobDir).startsWith(resolve(join(tmpdir(),'p05-receipt-http-'))))await rm(blobDir,{recursive:true});});
 async function post(value:number,key='sender-key'){
  return fetch(address+'/api/workflows/hooks/path',{method:'POST',headers:{'content-type':'application/json','x-webhook-token':'token','idempotency-key':key,prefer:'respond-async'},body:JSON.stringify({value})});
 }
 it('accepts concurrent duplicates once, dispatches outside HTTP, then returns persisted completion',async()=>{
  const responses=await Promise.all(Array.from({length:6},()=>post(1)));
  expect(responses.map(r=>r.status)).toEqual(Array(6).fill(202));
  const bodies=await Promise.all(responses.map(acceptance));expect(new Set(bodies.map(r=>r.requestId)).size).toBe(1);
  expect(effects).toBe(0);expect(await db.selectFrom('outbox_events').selectAll().execute()).toHaveLength(1);
  expect((await post(2)).status).toBe(409);
  await bus.drain();expect(effects).toBe(1);
  const status=await fetch(address+bodies[0].statusUrl,{headers:{'x-webhook-token':'token'}});
  expect(await status.json()).toMatchObject({requestId:bodies[0].requestId,status:'completed'});
  const repeated=await post(1);expect(repeated.status).toBe(200);expect(effects).toBe(1);
  expect(await db.selectFrom('workflow_runs').selectAll().execute()).toHaveLength(1);
 });
 it('does not acknowledge acceptance when event insertion fails',async()=>{
  await sql`alter table outbox_events add constraint reject_webhook check(type <> 'workflow.webhook.accepted')`.execute(db);
  expect((await post(1)).status).toBe(503);
  expect(await db.selectFrom('workflow_webhook_receipts').selectAll().execute()).toEqual([]);expect(effects).toBe(0);
 });
 it('deduplicates binary bytes across upload paths and dispatches the retained object',async()=>{
  const send=(bytes:string)=>fetch(address+'/api/workflows/hooks/path',{method:'POST',headers:{'content-type':'application/octet-stream','x-webhook-token':'token','idempotency-key':'binary-key',prefer:'respond-async'},body:bytes});
  const first=await send('binary payload');expect(first.status).toBe(202);const identity=await acceptance(first);
  const duplicate=await send('binary payload');expect(duplicate.status).toBe(202);expect((await acceptance(duplicate)).requestId).toBe(identity.requestId);
  expect((await send('different payload')).status).toBe(409);
  expect(await readdir(blobDir)).toHaveLength(1);
  await bus.drain();expect(effects).toBe(1);expect(receivedBytes).toBe('binary payload');
  expect((await db.selectFrom('workflow_webhook_receipts').select('status').executeTakeFirst())?.status).toBe('completed');
 });

});
