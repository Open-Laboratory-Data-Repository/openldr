import {describe,it,expect,vi} from 'vitest';
import {waitForWebhookReceipt} from './webhook-receipt-wait';
describe('bounded webhook wait',()=>{
 it('returns at deadline even when status storage hangs',async()=>{
  vi.useFakeTimers();
  try { const initial={id:'r',status:'queued'};
   const result=waitForWebhookReceipt(initial,()=>new Promise(()=>{}),new AbortController().signal,1000);
   await vi.advanceTimersByTimeAsync(1000);expect(await result).toEqual(initial);
  }finally{vi.useRealTimers();}
 });
 it('stops waiting on disconnect without cancelling the receipt',async()=>{
  const c=new AbortController();const get=vi.fn(()=>new Promise<{id:string;status:string}>(()=>{}));
  const initial={id:'r',status:'running'};const result=waitForWebhookReceipt(initial,get,c.signal,10000);
  c.abort();expect(await result).toEqual(initial);expect(get).not.toHaveBeenCalled();
 });
});
