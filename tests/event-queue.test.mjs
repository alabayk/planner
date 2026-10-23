import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventSync} from '../public/reliable-sync.mjs';
const event={id:'event',title:'Meeting',notes:'',startsAt:'2026-10-20T10:00:00Z',durationMinutes:60,space:'shared',createdBy:'owner',done:false,deleted:false,version:1};
function fixture(remote){
  const stores={events:new Map(),outbox:new Map()},copy=x=>structuredClone(x),controls={abortWrites:false};
  const all=async name=>[...stores[name].values()].map(copy),put=async(name,rows)=>rows.forEach(row=>stores[name].set(row.id,copy(row))),remove=async(name,id)=>stores[name].delete(id);
  const database={transaction(){
    const tx={objectStore(name){return {getAll(){const request={};setTimeout(()=>{request.result=[...stores[name].values()].map(copy);request.onsuccess?.();setTimeout(()=>tx.oncomplete?.(),0);},0);return request;},get(id){const request={};setTimeout(()=>{request.result=copy(stores[name].get(id));request.onsuccess?.();setTimeout(()=>tx.oncomplete?.(),0);},0);return request;},put(row){if(controls.abortWrites){tx.error=Error('QuotaExceededError');queueMicrotask(()=>tx.onabort?.());return;}stores[name].set(row.id,copy(row));setTimeout(()=>tx.oncomplete?.(),0);},delete(id){stores[name].delete(id);}};}};return tx;
  }};
  let row=copy(remote),updates=0,beforeWrite=null,beforeRead=null;
  const client={from(){let patch,version,insert=false;return {
    select(){return this;},eq(key,value){if(key==='version')version=value;return this;},
    update(value){patch=value;return this;},insert(value){patch=value;insert=true;return this;},
    async maybeSingle(){if(!patch){if(beforeRead){const fn=beforeRead;beforeRead=null;await fn();}return {data:copy(row),error:null};}if(beforeWrite){const fn=beforeWrite;beforeWrite=null;await fn();}if(row?.version!==version)return {data:null,error:null};row=copy(patch);updates++;return {data:copy(row),error:null};},
    async single(){if(insert&&row)return {error:{code:'23505'}};row=copy(patch);updates++;return {data:copy(row),error:null};}
  };}};
  const node=()=>({append(){},after(){},replaceChildren(){},classList:{},hidden:false});
  globalThis.document={getElementById:()=>node(),createElement:()=>node()};
  const state={events:[copy(event)]};
  const engine=createEventSync({client,state,all,put,remove,dbp:Promise.resolve(database),render(){},fromRow:x=>x,toRow:x=>({...x,version:Number(x.version||0)+1})});
  return {engine,stores,state,controls,get row(){return row;},get updates(){return updates;},setRow:value=>{row=copy(value);},beforeRead:fn=>{beforeRead=fn;},beforeWrite:fn=>{beforeWrite=fn;},queue:async job=>put('outbox',[job])};
}
test('device merges its title with server time using a conditional update',async()=>{
  const f=fixture({...event,startsAt:'2026-10-20T11:00:00Z',version:2});
  const job={...event,title:'Local title',base:event,mutationId:'a'};await f.queue(job);await f.engine.post(job);
  assert.equal(f.row.title,'Local title');assert.equal(f.row.startsAt,'2026-10-20T11:00:00Z');assert.equal(f.row.version,3);assert.equal(f.stores.outbox.size,0);
});
test('a same-field conflict keeps the queue and both versions without writing',async()=>{
  const f=fixture({...event,title:'Server title',version:2}),job={...event,title:'Local title',base:event,mutationId:'a'};
  await f.queue(job);await f.engine.post(job);const saved=f.stores.outbox.get(event.id);
  assert.equal(f.updates,0);assert.equal(saved.title,'Local title');assert.equal(saved.conflict.remote.title,'Server title');
});
test('a competing server update between read and write is retried and merged',async()=>{
  const f=fixture(event),job={...event,title:'Local',base:event,mutationId:'a'};
  await f.queue(job);f.beforeWrite(()=>f.setRow({...event,done:true,version:2}));await f.engine.post(job);
  assert.equal(f.row.title,'Local');assert.equal(f.row.done,true);assert.equal(f.row.version,3);
});
test('an edit queued during an in-flight request survives acknowledgement',async()=>{
  const f=fixture(event),job={...event,title:'First edit',base:event,mutationId:'a'};
  await f.queue(job);f.beforeWrite(()=>f.queue({...job,title:'Second edit',mutationId:'b'}));await f.engine.post(job);
  assert.equal(f.row.title,'First edit');assert.equal(f.stores.outbox.get(event.id).title,'Second edit');assert.equal(f.stores.outbox.get(event.id).base.version,2);
  await f.engine.flush();assert.equal(f.row.title,'Second edit');assert.equal(f.stores.outbox.size,0);
});
test('a late sync response cannot overwrite newer or still-pending local data',async()=>{
  const f=fixture(event);
  f.stores.events.set(event.id,{...event,title:'Confirmed newer',version:3});
  await f.engine.applyRemote([{...event,title:'Stale response',version:2}]);
  assert.equal(f.state.events[0].title,'Confirmed newer');
  const job={...event,title:'Pending edit',version:3,mutationId:'a'};
  await f.queue(job);f.stores.events.set(event.id,job);
  await f.engine.applyRemote([{...event,title:'Server update',version:4}]);
  assert.equal(f.state.events[0].title,'Pending edit');
});
test('server inventory removes obsolete cached records but never erases pending edits',async()=>{
  const f=fixture(event);f.stores.events.set('revoked',{...event,id:'revoked'});f.stores.events.set('pending',{...event,id:'pending',title:'Offline edit'});await f.queue({...event,id:'pending',mutationId:'p'});
  await f.engine.applyRemote([event]);assert.equal(f.stores.events.has('revoked'),false);assert.equal(f.stores.events.get('pending').title,'Offline edit');assert.equal(f.stores.outbox.has('pending'),true);
});
test('a new offline event can be edited before its first upload without a false deletion conflict',async()=>{
 const f=fixture(null);f.state.events=[];const initial={...event,version:0};await f.engine.saveMany([initial],{flush:false});assert.equal(f.updates,0);assert.equal(f.stores.outbox.get(event.id).base,null);
 f.state.editing=initial;await f.engine.save({...initial,title:'Edited offline draft'});assert.equal(f.row.title,'Edited offline draft');assert.equal(f.stores.outbox.size,0);
});
test('a failed device transaction cannot show an unsaved edit as committed',async()=>{
  const f=fixture(event);f.controls.abortWrites=true;await assert.rejects(f.engine.save({...event,title:'Unsaved'}),/QuotaExceeded/);
  assert.equal(f.state.events[0].title,event.title);assert.equal(f.stores.outbox.size,0);assert.equal(f.updates,0);
});
test('a deletion response cannot replace a newer queued edit with an older conflict',async()=>{
  const f=fixture(null),job={...event,title:'Old edit',base:event,mutationId:'old'};await f.queue(job);
  f.beforeRead(()=>f.queue({...job,title:'New edit',mutationId:'new'}));await f.engine.post(job);
  assert.equal(f.stores.outbox.get(event.id).title,'New edit');assert.equal(f.stores.outbox.get(event.id).conflict,undefined);
});
