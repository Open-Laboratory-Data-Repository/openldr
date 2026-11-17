import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerWorkflowRoutes } from './workflows-routes';

const receipt: any = { id: 'request-1', workflowId: 'wf', status: 'queued', runId: null, createdAt: '2026-09-11T00:00:00Z', startedAt: null, finishedAt: null, reason: null, outcome: null };
async function fixture(capabilities = ['workflows.view']) {
  const receipts = { accept: vi.fn(async () => ({ receipt, created: true })), get: vi.fn(async () => receipt), list: vi.fn(async () => [receipt]) };
  const runAndRecord = vi.fn();
  const app = Fastify();
  app.addHook('onRequest', async req => { req.user = { id: 'operator', username: 'operator', roles: [], capabilities } as never; });
  const blob = {put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined)};
  registerWorkflowRoutes(app, { workflows: { receipts, webhooks: { resolve: async () => ({workflowId:'wf',secret:'token'}) }, runner: {runAndRecord} }, cfg: {WORKFLOW_FILE_MAX_BYTES:1024}, blob } as unknown as AppContext);
  return {app,receipts,runAndRecord,blob};
}
describe('durable webhook receipt HTTP contract', () => {
  it('returns accepted identity without executing in the request handler', async () => {
    const {app,receipts,runAndRecord}=await fixture();
    try {
      const r=await app.inject({method:'POST',url:'/api/workflows/hooks/path',headers:{'x-webhook-token':'token',prefer:'respond-async','idempotency-key':'sender-1'},payload:{value:1}});
      expect(r.statusCode).toBe(202);
      expect(r.json()).toMatchObject({accepted:true,requestId:'request-1',status:'queued'});
      expect(r.headers.location).toContain('requestId=request-1');
      expect(r.headers['retry-after']).toBe('2');
      expect(receipts.accept).toHaveBeenCalledWith(expect.objectContaining({workflowId:'wf',idempotencyKey:'sender-1'}));
      expect(runAndRecord).not.toHaveBeenCalled();
    } finally {await app.close();}
  });
  it('rejects malformed request identity before acceptance', async () => {
    const {app,receipts}=await fixture();
    try {
      const r=await app.inject({method:'POST',url:'/api/workflows/hooks/path',headers:{'x-webhook-token':'token','idempotency-key':'x'.repeat(201)},payload:{}});
      expect(r.statusCode).toBe(400);expect(receipts.accept).not.toHaveBeenCalled();
    } finally {await app.close();}
  });
  it('does not expose database errors when durable acceptance fails', async () => {
    const {app,receipts}=await fixture();receipts.accept.mockRejectedValue(new Error('private SQL and credentials'));
    try {
      const r=await app.inject({method:'POST',url:'/api/workflows/hooks/path',headers:{'x-webhook-token':'token',prefer:'respond-async'},payload:{}});
      expect(r.statusCode).toBe(503);expect(r.body).not.toContain('private');
    } finally {await app.close();}
  });
  it('authenticates sender polling and hides receipts from other workflows', async () => {
    const {app,receipts}=await fixture();
    try {
      expect((await app.inject({url:'/api/workflows/hooks/path?requestId=request-1'})).statusCode).toBe(401);
      receipts.get.mockResolvedValue({...receipt,workflowId:'other'});
      expect((await app.inject({url:'/api/workflows/hooks/path?requestId=request-1',headers:{'x-webhook-token':'token'}})).statusCode).toBe(404);
    } finally {await app.close();}
  });
  it('bounds operator pagination and checks receipt ownership', async () => {
    const {app,receipts}=await fixture();
    try {
      expect((await app.inject({url:'/api/workflows/wf/receipts?limit=1000000'})).statusCode).toBe(400);
      expect((await app.inject({url:'/api/workflows/wf/receipts?limit=25&offset=0'})).statusCode).toBe(200);
      expect(receipts.list).toHaveBeenCalledWith('wf',{limit:25,offset:0});
      receipts.get.mockResolvedValue({...receipt,workflowId:'other'});
      expect((await app.inject({url:'/api/workflows/wf/receipts/request-1'})).statusCode).toBe(404);
    } finally {await app.close();}
  });
  it('returns an existing completed receipt without changing the success response', async () => {
    const {app,receipts}=await fixture();
    receipts.accept.mockResolvedValue({created:false,receipt:{...receipt,status:'completed',outcome:{runId:'run-1',correlationId:null}}});
    try {
      const r=await app.inject({method:'POST',url:'/api/workflows/hooks/path',headers:{'x-webhook-token':'token'},payload:{}});
      expect(r.statusCode).toBe(200);expect(r.json()).toEqual({ok:true,runId:'run-1',correlationId:null});
    } finally {await app.close();}
  });
  it('returns conflict for an interrupted receipt without leaking internal outcomes',async()=>{
    const {app,receipts}=await fixture();
    receipts.accept.mockResolvedValue({created:false,receipt:{...receipt,status:'interrupted',reason:'private',outcome:null}});
    try {
      const r=await app.inject({method:'POST',url:'/api/workflows/hooks/path',headers:{'x-webhook-token':'token'},payload:{}});
      expect(r.statusCode).toBe(409);expect(r.json()).toMatchObject({requestId:'request-1',status:'interrupted'});expect(r.body).not.toContain('private');
    }finally{await app.close();}
  });
  it('polling exposes only identity and state',async()=>{
    const {app,receipts}=await fixture();
    receipts.get.mockResolvedValue({...receipt,status:'failed',reason:'private',outcome:{error:'private',nodeMeta:{patient:'private'}}});
    try {
      const r=await app.inject({url:'/api/workflows/hooks/path?requestId=request-1',headers:{'x-webhook-token':'token'}});
      expect(r.statusCode).toBe(200);expect(r.json()).toEqual({requestId:'request-1',status:'failed',runId:null});
    }finally{await app.close();}
  });
  it('requires operator capability for list and detail',async()=>{
    const {app,receipts}=await fixture([]);
    try {
      expect((await app.inject({url:'/api/workflows/wf/receipts'})).statusCode).toBe(403);
      expect((await app.inject({url:'/api/workflows/wf/receipts/request-1'})).statusCode).toBe(403);
      expect(receipts.list).not.toHaveBeenCalled();expect(receipts.get).not.toHaveBeenCalled();
    }finally{await app.close();}
  });
  it('removes a duplicate upload but retains bytes when database commit is uncertain',async()=>{
    const {app,receipts,blob}=await fixture();
    receipts.accept.mockResolvedValue({created:false,receipt});
    const request={method:'POST' as const,url:'/api/workflows/hooks/path',headers:{'x-webhook-token':'token','content-type':'application/octet-stream',prefer:'respond-async'},payload:Buffer.from('data')};
    try {
      expect((await app.inject(request)).statusCode).toBe(202);expect(blob.delete).toHaveBeenCalledTimes(1);
      receipts.accept.mockRejectedValue(new Error('commit connection lost'));
      expect((await app.inject(request)).statusCode).toBe(503);expect(blob.delete).toHaveBeenCalledTimes(1);
      receipts.accept.mockRejectedValue(Object.assign(new Error('disabled before acceptance'),{name:'WebhookAcceptanceError'}));
      expect((await app.inject(request)).statusCode).toBe(409);expect(blob.delete).toHaveBeenCalledTimes(2);
    }finally{await app.close();}
  });

});

describe('FHIR XML at the webhook', () => {
  const xml = '<?xml version="1.0"?><Patient xmlns="http://hl7.org/fhir"><id value="p1"/><name><given value="Ruth"/></name><multipleBirthInteger value="2"/></Patient>';
  const post = (app: Awaited<ReturnType<typeof fixture>>['app'], contentType: string, payload: string, token = 'token') =>
    app.inject({ method: 'POST', url: '/api/workflows/hooks/path', headers: { 'x-webhook-token': token, prefer: 'respond-async', 'content-type': contentType }, payload });

  it.each(['application/fhir+xml', 'application/fhir+xml; charset=utf-8', 'application/xml'])('turns FHIR XML sent as %s into FHIR JSON before the run', async (ct) => {
    const { app, receipts, blob } = await fixture();
    try {
      const r = await post(app, ct, xml);
      expect(r.statusCode).toBe(202);
      expect(receipts.accept).toHaveBeenCalledWith(expect.objectContaining({
        files: undefined,
        input: expect.objectContaining({ body: { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ruth'] }], multipleBirthInteger: 2 } }),
      }));
      expect(blob.put).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('refuses XML that is not FHIR with 415, and runs nothing', async () => {
    const { app, receipts } = await fixture();
    try {
      const r = await post(app, 'application/xml', '<results><row pat_no="LAB-1"/></results>');
      expect(r.statusCode).toBe(415);
      expect(r.json().error).toContain('http://hl7.org/fhir');
      expect(receipts.accept).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('refuses broken XML with 400, and runs nothing', async () => {
    const { app, receipts } = await fixture();
    try {
      const r = await post(app, 'application/fhir+xml', '<Patient xmlns="http://hl7.org/fhir"><id value="p1"></Patient>');
      expect(r.statusCode).toBe(400);
      expect(receipts.accept).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('checks the webhook token before it reads the XML', async () => {
    const { app, receipts } = await fixture();
    try {
      const r = await post(app, 'application/xml', '<not-even-xml', 'wrong');
      expect(r.statusCode).toBe(401);
      expect(receipts.accept).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
