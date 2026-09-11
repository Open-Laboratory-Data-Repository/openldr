/** Bound the HTTP wait even when a status read cannot finish. Work remains durable. */
export async function waitForWebhookReceipt<T extends {id:string;status:string}>(
  initial:T, get:(id:string)=>Promise<T|undefined>, signal:AbortSignal, waitMs=10_000,
):Promise<T> {
  let receipt=initial;
  if(signal.aborted || !['queued','running'].includes(receipt.status)) return receipt;
  let release!:()=>void;
  const stopped=new Promise<undefined>(resolve=>{release=()=>resolve(undefined);});
  const deadline=setTimeout(release,waitMs);
  signal.addEventListener('abort',release,{once:true});
  try {
    while(!signal.aborted && ['queued','running'].includes(receipt.status)) {
      let timer:ReturnType<typeof setTimeout>;
      const tick=new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(true),200);});
      const ready=await Promise.race([tick,stopped]);
      clearTimeout(timer!);
      if(!ready || signal.aborted) break;
      const current=await Promise.race([get(receipt.id).catch(()=>undefined),stopped]);
      if(!current) break;
      receipt=current;
    }
    return receipt;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort',release);
  }
}
