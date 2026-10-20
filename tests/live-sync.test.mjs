import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSync} from '../public/live-sync.mjs';
import {publicError,safeSupabaseFetch} from '../public/api.mjs';
import {checkedJson,safeError} from '../worker/api-errors.mjs';

test('automatic sync starts once, polls every 30s, and skips hidden/offline state',async()=>{
  let callback,delay,created=0,cleared=0,calls=0,active=true;
  const timers={setInterval(fn,ms){callback=fn;delay=ms;created++;return 7;},clearInterval(id){assert.equal(id,7);cleared++;}};
  const sync=createLiveSync({run:()=>++calls,isActive:()=>active,timers});sync.start();sync.start();assert.equal(created,1);assert.equal(delay,30000);
  await callback();assert.equal(calls,1);active=false;await callback();assert.equal(calls,1);active=true;await sync.tick();assert.equal(calls,2);sync.stop();assert.equal(cleared,1);
});
test('overlapping sync triggers share one request and recover after failure',async()=>{
  let release,calls=0;const sync=createLiveSync({run:()=>{calls++;return new Promise(resolve=>release=resolve);}});
  const first=sync.tick(),second=sync.tick();await Promise.resolve();assert.equal(calls,1);release(true);await Promise.all([first,second]);
  const next=sync.tick();await Promise.resolve();assert.equal(calls,2);release(false);assert.equal(await next,false);
  let attempt=0;const recovering=createLiveSync({run:()=>{if(!attempt++)throw Error('offline');return true;}});assert.equal(await recovering.tick(),false);assert.equal(await recovering.tick(),true);
});
test('permission errors are not mislabeled as offline or fixed with VPN',async()=>{
  const text=publicError({code:'42501',message:'permission denied for table planner_events'});assert.match(text,/repair-access.sql/);assert.match(text,/VPN/);
  assert.match(safeError('permission denied for table planner_events'),/repair-access.sql/);
  await assert.rejects(checkedJson(Response.json({code:'42501',message:'permission denied for table planner_events'},{status:403})),error=>error.status===403&&error.code==='42501'&&error.message.includes('repair-access.sql'));
});
test('Supabase transport honours caller cancellation and does not leave a hung request',async()=>{
  const original=globalThis.fetch;const controller=new AbortController();controller.abort();
  globalThis.fetch=async(_url,init)=>{assert.ok(init.signal.aborted);throw new DOMException('Aborted','AbortError');};
  try{assert.equal((await safeSupabaseFetch('https://example.test',{signal:controller.signal})).status,503);}finally{globalThis.fetch=original;}
});
